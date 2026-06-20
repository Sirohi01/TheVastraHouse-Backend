import { env } from "../config/env.js";
import { Order } from "../models/Order.js";
import { logger } from "../utils/logger.js";
import { sendEmail } from "./emailService.js";
import {
  buildBalancePaymentReceivedTemplate,
  buildOrderConfirmationTemplate,
} from "./emailTemplateService.js";
import { deductOrderReservedStock } from "./inventoryService.js";
import { recordOrderTimeline, type OrderActor, type OrderStatus } from "./orderLifecycleService.js";
import { createProductionTrackersForOrder } from "./preOrderService.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";

type FulfillableOrder = {
  _id: unknown;
  orderNumber: string;
  status: OrderStatus;
  paymentMode: "full" | "advance" | "balance";
  guestEmail?: string;
  shippingAddress?: { fullName?: string };
  items: Array<{
    productId: unknown;
    variantId: unknown;
    productName: string;
    quantity: number;
    sku: string;
    preOrder?: { enabled?: boolean; expectedDispatchAt?: Date; expectedDeliveryAt?: Date };
  }>;
  totals: { grandTotal: number; currencyCode: string };
  stockReservations: Array<{
    sku: string;
    quantity: number;
    warehouseId?: unknown;
    status: string;
  }>;
  balancePaymentNotifiedAt?: Date;
  save: () => Promise<unknown>;
};

const pendingOrderStatuses = new Set(["pending_payment", "payment_verification_pending"]);
export async function finalizeOrderAfterPayment(input: {
  paymentSessionId: unknown;
  paymentSessionStatus: string;
  payableNow: number;
  outstandingAmount: number;
  actor: OrderActor;
}) {
  const isCaptured =
    input.paymentSessionStatus === "confirmed" || input.paymentSessionStatus === "partially_paid";

  if (!isCaptured) {
    return null;
  }

  const order = (await Order.findOne({
    paymentSessionId: input.paymentSessionId,
  })) as unknown as FulfillableOrder | null;

  if (!order) {
    return null;
  }

  if (pendingOrderStatuses.has(order.status)) {
    return confirmOrderForFirstTime(order, input);
  }

  const isBalanceCompletion =
    order.paymentMode === "advance" &&
    input.paymentSessionStatus === "confirmed" &&
    input.outstandingAmount === 0;

  if (isBalanceCompletion) {
    return notifyBalancePaymentReceived(order, input);
  }

  return order;
}

async function confirmOrderForFirstTime(
  order: FulfillableOrder,
  input: { payableNow: number; actor: OrderActor },
) {
  const fromStatus = order.status;
  const hasPreOrderItems = order.items.some((item) => item.preOrder?.enabled);
  order.status = hasPreOrderItems ? "pre_order_confirmed" : "confirmed";
  await deductPendingReservations(order, input.actor);
  await order.save();

  await recordOrderTimeline({
    actor: input.actor,
    fromStatus,
    note: "Payment confirmed",
    order,
  });

  if (hasPreOrderItems) {
    await createProductionTrackersForOrder(order);
  }

  await sendOrderConfirmationEmail(
    { guestEmail: order.guestEmail, shippingAddress: order.shippingAddress },
    order,
    input.payableNow,
  );

  return order;
}

async function notifyBalancePaymentReceived(
  order: FulfillableOrder,
  input: { payableNow: number; actor: OrderActor },
) {
  if (order.balancePaymentNotifiedAt) {
    return order;
  }

  await deductPendingReservations(order, input.actor);
  order.balancePaymentNotifiedAt = new Date();
  await order.save();
  await sendBalancePaymentReceivedEmail(order, input.payableNow);

  return order;
}

async function deductPendingReservations(order: FulfillableOrder, actor: OrderActor) {
  const reservationsToDeduct = order.stockReservations.filter(
    (reservation) => reservation.status === "reserved",
  );

  if (!reservationsToDeduct.length) {
    return;
  }

  await deductOrderReservedStock({
    actor,
    referenceId: order.orderNumber,
    reservations: reservationsToDeduct,
  });

  for (const reservation of order.stockReservations) {
    if (reservation.status === "reserved") {
      reservation.status = "deducted";
    }
  }
}

export async function sendOrderConfirmationEmail(
  input: { guestEmail?: string; shippingAddress?: { fullName?: string } },
  order: { orderNumber: string; totals: { grandTotal: number; currencyCode: string } },
  payableNow: number,
) {
  const email = input.guestEmail;

  if (!email) {
    return;
  }

  const total = formatCheckoutMoney(order.totals.grandTotal, order.totals.currencyCode);
  const dueNow = formatCheckoutMoney(payableNow, order.totals.currencyCode);
  const balanceRemaining = formatCheckoutMoney(
    Math.max(0, order.totals.grandTotal - payableNow),
    order.totals.currencyCode,
  );

  try {
    await sendEmail(
      email,
      buildOrderConfirmationTemplate({
        balanceRemaining,
        customerName: input.shippingAddress?.fullName,
        dueNow,
        orderNumber: order.orderNumber,
        total,
        trackUrl: `${await frontendPublicUrl()}/track-order?order=${encodeURIComponent(order.orderNumber)}`,
      }),
    );
  } catch (error) {
    logger.warn(
      { error, orderNumber: order.orderNumber, to: email },
      "Order confirmation email failed after checkout",
    );
  }
}

export async function sendBalancePaymentReceivedEmail(
  order: {
    orderNumber: string;
    guestEmail?: string;
    shippingAddress?: { fullName?: string };
    totals: { currencyCode: string };
  },
  amountPaidNow: number,
) {
  const email = order.guestEmail;

  if (!email) {
    return;
  }

  try {
    await sendEmail(
      email,
      buildBalancePaymentReceivedTemplate({
        amountPaid: formatCheckoutMoney(amountPaidNow, order.totals.currencyCode),
        customerName: order.shippingAddress?.fullName,
        orderNumber: order.orderNumber,
        trackUrl: `${await frontendPublicUrl()}/track-order?order=${encodeURIComponent(order.orderNumber)}`,
      }),
    );
  } catch (error) {
    logger.warn(
      { error, orderNumber: order.orderNumber, to: email },
      "Balance payment confirmation email failed",
    );
  }
}

export function formatCheckoutMoney(value: number, currencyCode: string) {
  return new Intl.NumberFormat("en-IN", {
    currency: currencyCode,
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

export async function frontendPublicUrl() {
  return (await getRuntimeSetting("FRONTEND_PUBLIC_URL")) ?? env.FRONTEND_PUBLIC_URL;
}
