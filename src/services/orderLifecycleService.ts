import { Types, type HydratedDocument } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Order, type orderStatuses } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { writeAuditLog } from "./auditLogService.js";
import { releaseOrderStock } from "./inventoryService.js";
import { releasePreOrderSlots } from "./preOrderService.js";
import { notifyOrderStatusChanged } from "./commerceNotificationService.js";
import { generateDispatchDocument } from "./invoiceService.js";
import { logger } from "../utils/logger.js";
import { refundCancelledOrder, reverseOrderFinancials } from "./orderReversalService.js";
import { reverseReferralForOrder } from "./referralService.js";
import { reverseEarnedPoints } from "./rewardPointsService.js";

export type OrderStatus = (typeof orderStatuses)[number];

type OrderDoc = HydratedDocument<{
  _id: Types.ObjectId;
  orderNumber: string;
  guestEmail?: string;
  whatsappOptIn?: boolean;
  paymentSessionId?: Types.ObjectId;
  userId: Types.ObjectId;
  status: OrderStatus;
  shippingAddress?: { fullName?: string; phone?: string };
  items: Array<{
    variantId: Types.ObjectId;
    quantity: number;
    preOrder?: { enabled?: boolean };
  }>;
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    dispatchedAt?: Date;
    deliveredAt?: Date;
  };
  stockReservations: Array<{
    sku: string;
    quantity: number;
    warehouseId?: Types.ObjectId;
    status?: "reserved" | "released" | "deducted";
  }>;
  paymentMethod: string;
  risk?: { status?: string };
  financials?: {
    storeCreditRedeemed?: number;
    rewardPointsRedeemed?: number;
    giftCardRedemptions?: Array<{ code: string; amount: number }>;
    reversedAt?: Date;
  };
  totals?: { currencyCode?: string; grandTotal?: number };
}>;

export type OrderActor = {
  actorId?: string;
  actorType: "customer" | "admin" | "system";
};

export const orderTransitionGraph: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["confirmed", "payment_verification_pending", "payment_rejected", "cancelled"],
  payment_verification_pending: ["confirmed", "payment_rejected", "cancelled"],
  payment_rejected: ["pending_payment", "cancelled"],
  confirmed: ["in_production", "packed", "ready_to_dispatch", "cancelled"],
  pre_order_confirmed: ["in_production", "cancelled"],
  cod_confirmed: ["in_production", "packed", "ready_to_dispatch", "cancelled"],
  in_production: ["packed", "cancelled"],
  packed: ["ready_to_dispatch", "cancelled"],
  ready_to_dispatch: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned", "refunded"],
  returned: ["refunded"],
  cancelled: [],
  refunded: [],
};

const pendingPaymentTimeoutMs = 30 * 60 * 1000;

export function startPendingPaymentCleanupJob(intervalMs = 5 * 60 * 1000) {
  const run = () => void cancelExpiredPendingPaymentOrders().catch(() => undefined);
  run();
  return setInterval(run, intervalMs);
}

export async function cancelExpiredPendingPaymentOrders(now = new Date()) {
  const cutoff = new Date(now.getTime() - pendingPaymentTimeoutMs);
  const orders = (await Order.find({
    createdAt: { $lte: cutoff },
    status: "pending_payment",
  }).limit(100)) as unknown as OrderDoc[];
  let cancelled = 0;

  for (const order of orders) {
    await transitionOrderDocument(order, {
      actor: { actorType: "system" },
      note: "Payment window expired",
      toStatus: "cancelled",
    });
    if (order.paymentSessionId) {
      await PaymentSession.findByIdAndUpdate(order.paymentSessionId, {
        $set: { failedAt: now, status: "failed" },
      });
    }
    cancelled += 1;
  }

  return { cancelled };
}

const customerCancelableStatuses = new Set<OrderStatus>([
  "pending_payment",
  "payment_verification_pending",
  "payment_rejected",
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
]);

export async function recordOrderTimeline(input: {
  order: { _id: unknown; orderNumber: string; status: OrderStatus };
  fromStatus?: OrderStatus;
  actor: OrderActor;
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  return OrderTimeline.create({
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    fromStatus: input.fromStatus,
    metadata: input.metadata,
    note: input.note,
    orderId: input.order._id,
    orderNumber: input.order.orderNumber,
    toStatus: input.order.status,
  });
}

export async function transitionOrderStatus(input: {
  orderId: string;
  toStatus: OrderStatus;
  actor: OrderActor;
  note?: string;
  allowAdminCancelAnyStage?: boolean;
}) {
  const order = (await Order.findById(input.orderId)) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  return transitionOrderDocument(order, input);
}

export async function transitionOrderDocument(
  order: OrderDoc,
  input: {
    toStatus: OrderStatus;
    actor: OrderActor;
    note?: string;
    allowAdminCancelAnyStage?: boolean;
  },
) {
  assertTransitionAllowed(order, input);
  const fromStatus = order.status;
  const before = order.toObject();

  if (input.toStatus === "cancelled") {
    await releaseStockForCancellation(order, input.actor);
  }

  order.status = input.toStatus;

  if (input.toStatus === "delivered") {
    order.shipment = {
      ...(order.shipment ?? {}),
      deliveredAt: order.shipment?.deliveredAt ?? new Date(),
    };
  }

  await order.save();
  await recordOrderTimeline({
    actor: input.actor,
    fromStatus,
    note: input.note,
    order,
  });
  await writeAuditLog({
    action: "update",
    actor: {
      actorId: input.actor.actorId ? toObjectId(input.actor.actorId) : undefined,
      actorType: input.actor.actorType,
    },
    after: order.toObject(),
    before,
    entity: { id: order._id, type: "order", displayId: order.orderNumber },
    metadata: { fromStatus, toStatus: input.toStatus },
  });
  if (input.toStatus === "cancelled") {
    await settleCancelledOrder(order, input.actor, input.note);
  }

  if (input.toStatus === "refunded" && order.userId) {
    await reverseEarnedPoints({
      orderNumber: order.orderNumber,
      reason: "Order refunded",
      userId: String(order.userId),
    });
    await reverseReferralForOrder(order.orderNumber, "Qualifying order refunded");
  }

  await notifyOrderStatusChanged(order, input.toStatus, input.note);
  if (input.toStatus === "shipped") {
    await generateDispatchDocument(order._id);
  }
  return order;
}

/**
 * Money side of a cancellation. The status change has already been persisted, so a gateway
 * failure here is recorded on the timeline for the finance team instead of undoing the cancel.
 */
async function settleCancelledOrder(order: OrderDoc, actor: OrderActor, note?: string) {
  const reason = note ? `Order cancelled: ${note}` : "Order cancelled";

  try {
    await reverseOrderFinancials(order, reason);
  } catch (error) {
    logger.error({ error, orderNumber: order.orderNumber }, "Order financial reversal failed");
  }

  try {
    const refund = await refundCancelledOrder(order, actor.actorId);

    if (refund) {
      await recordOrderTimeline({
        actor: { actorType: "system" },
        fromStatus: order.status,
        metadata: { refundId: refund._id, refundStatus: refund.status },
        note:
          refund.method === "bank_transfer"
            ? `Refund of ${refund.amount} queued for bank transfer`
            : `Refund of ${refund.amount} initiated to original payment method`,
        order,
      });
    }
  } catch (error) {
    logger.error({ error, orderNumber: order.orderNumber }, "Cancellation refund failed");
    await recordOrderTimeline({
      actor: { actorType: "system" },
      fromStatus: order.status,
      note: "Automatic refund failed. Finance must process the refund manually.",
      order,
    });
  }
}

/** Cancels an unpaid attempt replaced by a newer checkout from the same cart. */
export async function cancelSupersededOrder(order: unknown) {
  const doc = order as OrderDoc;

  if (doc.status !== "pending_payment") {
    return doc;
  }

  return transitionOrderDocument(doc, {
    actor: { actorType: "system" },
    note: "Superseded by a newer checkout attempt",
    toStatus: "cancelled",
  });
}

/** Places or lifts a fraud-review hold. Held orders cannot move into fulfilment. */
export async function setOrderRiskHold(input: {
  orderId: string;
  hold: boolean;
  actor: OrderActor;
  note?: string;
}) {
  const order = (await Order.findById(input.orderId)) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  order.set("risk.status", input.hold ? "held" : "released");
  order.set("risk.reviewedAt", new Date());
  order.set("risk.reviewNote", input.note);
  if (input.actor.actorId && Types.ObjectId.isValid(input.actor.actorId)) {
    order.set("risk.reviewedBy", input.actor.actorId);
  }
  await order.save();
  await recordOrderTimeline({
    actor: input.actor,
    fromStatus: order.status,
    note: input.hold
      ? `Placed on risk hold${input.note ? `: ${input.note}` : ""}`
      : `Risk hold released${input.note ? `: ${input.note}` : ""}`,
    order,
  });
  return order;
}

function toObjectId(value: string) {
  try {
    return new Types.ObjectId(value);
  } catch {
    return undefined;
  }
}

export async function cancelCustomerOrder(input: {
  orderNumber: string;
  userId: string;
  actor: OrderActor;
  note?: string;
}) {
  const order = (await Order.findOne({
    orderNumber: input.orderNumber,
    userId: input.userId,
  })) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (!customerCancelableStatuses.has(order.status)) {
    throw new AppError("Order can no longer be cancelled by customer", 409);
  }

  return transitionOrderDocument(order, {
    actor: input.actor,
    note: input.note,
    toStatus: "cancelled",
  });
}

export async function cancelAdminOrder(input: {
  orderId: string;
  actor: OrderActor;
  note?: string;
}) {
  return transitionOrderStatus({
    actor: input.actor,
    allowAdminCancelAnyStage: true,
    note: input.note,
    orderId: input.orderId,
    toStatus: "cancelled",
  });
}

export async function updateShipment(input: {
  orderId: string;
  actor: OrderActor;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchedAt?: Date;
  note?: string;
}) {
  const order = (await Order.findById(input.orderId)) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  order.shipment = {
    ...(order.shipment ?? {}),
    carrier: input.carrier,
    dispatchedAt: input.dispatchedAt ?? order.shipment?.dispatchedAt ?? new Date(),
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
  };

  if (order.status === "shipped") {
    await order.save();
    await recordOrderTimeline({
      actor: input.actor,
      fromStatus: order.status,
      metadata: { shipment: order.shipment },
      note: input.note ?? "Shipment updated",
      order,
    });
    return order;
  }

  return transitionOrderDocument(order, {
    actor: input.actor,
    note: input.note ?? "Shipment dispatched",
    toStatus: "shipped",
  });
}

export async function bulkTransitionOrders(input: {
  filter: { status?: OrderStatus; orderNumbers?: string[] };
  toStatus: OrderStatus;
  actor: OrderActor;
  note?: string;
}) {
  const orders = (await Order.find({
    ...(input.filter.status ? { status: input.filter.status } : {}),
    ...(input.filter.orderNumbers?.length
      ? { orderNumber: { $in: input.filter.orderNumbers } }
      : {}),
  })) as OrderDoc[];
  const updated: string[] = [];
  const failed: Array<{ orderNumber: string; reason: string }> = [];

  for (const order of orders) {
    try {
      await transitionOrderDocument(order, {
        actor: input.actor,
        note: input.note,
        toStatus: input.toStatus,
      });
      updated.push(order.orderNumber);
    } catch (error) {
      failed.push({
        orderNumber: order.orderNumber,
        reason: error instanceof Error ? error.message : "Transition failed",
      });
    }
  }

  return { failed, matched: orders.length, updated };
}

export async function getOrderWithTimeline(filter: { orderNumber: string; userId?: string }) {
  const order = await Order.findOne({
    orderNumber: filter.orderNumber,
    ...(filter.userId ? { userId: filter.userId } : {}),
  }).lean();

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const timeline = await OrderTimeline.find({ orderNumber: filter.orderNumber })
    .sort({ createdAt: 1 })
    .lean();

  return { order, timeline };
}

function assertTransitionAllowed(
  order: OrderDoc,
  input: {
    toStatus: OrderStatus;
    actor: OrderActor;
    allowAdminCancelAnyStage?: boolean;
  },
) {
  if (order.status === input.toStatus) {
    throw new AppError("Order is already in requested status", 409);
  }

  if (input.actor.actorType === "customer" && input.toStatus !== "cancelled") {
    throw new AppError("Customers can only cancel eligible orders", 403);
  }

  if (
    input.toStatus === "cancelled" &&
    input.actor.actorType === "admin" &&
    input.allowAdminCancelAnyStage &&
    !["cancelled", "refunded"].includes(order.status)
  ) {
    return;
  }

  if (
    order.risk?.status === "held" &&
    ["packed", "ready_to_dispatch", "shipped", "in_production"].includes(input.toStatus)
  ) {
    throw new AppError("Order is on a fraud-review hold. Release the hold before fulfilment.", 409);
  }

  const allowed = orderTransitionGraph[order.status]?.includes(input.toStatus);

  if (!allowed) {
    throw new AppError(
      `Invalid order status transition: ${order.status} -> ${input.toStatus}`,
      409,
    );
  }
}

async function releaseStockForCancellation(order: OrderDoc, actor: OrderActor) {
  await releaseOrderStock({
    actor,
    referenceId: order.orderNumber,
    reservations: order.stockReservations,
  });

  for (const reservation of order.stockReservations) {
    reservation.status = "released";
  }

  const preOrderItems = (order.items ?? [])
    .filter((item) => item.preOrder?.enabled)
    .map((item) => ({ quantity: item.quantity, variantId: item.variantId }));
  if (preOrderItems.length) {
    await releasePreOrderSlots(preOrderItems);
  }
}
