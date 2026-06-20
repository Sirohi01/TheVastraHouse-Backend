import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { Cart } from "../models/Cart.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import {
  createCodPayment,
  createManualPayment,
  createRazorpayPayment,
  createUpiPayment,
} from "./paymentService.js";
import {
  deductOrderReservedStock,
  getAvailableStockBySku,
  reserveOrderStock,
} from "./inventoryService.js";
import { sendOrderConfirmationEmail } from "./orderFulfillmentService.js";
import {
  assertPreOrderWindow,
  createProductionTrackersForOrder,
  isPreOrderActive,
  releasePreOrderSlots,
  reservePreOrderSlots,
  type PreOrderVariantSnapshot,
} from "./preOrderService.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

export type CheckoutAddress = {
  fullName?: string;
  company?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  phone?: string;
};

export type CheckoutInput = {
  userId?: string;
  guestEmail?: string;
  guestSessionId?: string;
  shippingAddress: CheckoutAddress;
  billingAddress?: CheckoutAddress;
  shippingMethod: "standard" | "express";
  paymentMethod: "razorpay" | "cod" | "manual_bank_transfer" | "upi";
  paymentMode?: "full" | "advance" | "balance";
  payableNow?: number;
  couponCode?: string;
  storeCreditRequested?: number;
  rewardValueRequested?: number;
  manualScreenshot?: {
    url: string;
    type: "image";
    aspectRatio?: string;
    altText?: string;
  };
  upiReference?: string;
  notes?: string;
};

type CartLine = {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  productName: string;
  slug: string;
  sku: string;
  media?: unknown;
  unitPrice: number;
  quantity: number;
  currencyCode: string;
  preOrder?: PreOrderVariantSnapshot;
};

type ProductLean = {
  _id: Types.ObjectId;
  hsnCode: string;
  gstRate: number;
  variants: Array<{
    _id: Types.ObjectId;
    sku: string;
    costPrice?: number;
    stockPlaceholder?: number;
    active?: boolean;
    preOrder?: PreOrderVariantSnapshot;
  }>;
};

export async function previewCheckout(input: Omit<CheckoutInput, "paymentMethod">) {
  const cart = await loadCheckoutCart(input);
  return calculateOrderTotals(cart, {
    couponCode: input.couponCode,
    rewardValueRequested: input.rewardValueRequested,
    shippingMethod: input.shippingMethod,
    storeCreditRequested: input.storeCreditRequested,
  });
}

export async function createOrderFromCheckout(input: CheckoutInput) {
  if (!input.userId && !input.guestEmail) {
    throw new AppError("Email is required for guest checkout", 400);
  }

  const cart = await loadCheckoutCart(input);
  const calculation = await calculateOrderTotals(cart, {
    couponCode: input.couponCode,
    rewardValueRequested: input.rewardValueRequested,
    shippingMethod: input.shippingMethod,
    storeCreditRequested: input.storeCreditRequested,
  });
  const orderNumber = buildOrderNumber();
  const paymentMode =
    input.paymentMode ??
    (input.payableNow && input.payableNow < calculation.totals.grandTotal ? "advance" : "full");
  const payableNow = normalizePayableNow(calculation.totals.grandTotal, input.payableNow);
  const hasPreOrderItems = calculation.items.some((item) => item.preOrder?.enabled);
  assertPreOrderPaymentMode(hasPreOrderItems, paymentMode, calculation.preOrderPaymentMode);
  const payment = await createPaymentForOrder(
    input,
    orderNumber,
    calculation.totals.grandTotal,
    payableNow,
    paymentMode,
  );
  const status = mapInitialOrderStatus(
    input.paymentMethod,
    payment.session?.status ?? payment.status,
    hasPreOrderItems,
  );
  const preOrderItems = calculation.items.filter((item) => item.preOrder?.enabled);
  const regularItems = calculation.items.filter((item) => !item.preOrder?.enabled);
  const preOrderReservations = preOrderItems.length
    ? await reservePreOrderSlots(preOrderItems)
    : [];
  let stockReservations: Awaited<ReturnType<typeof reserveOrderStock>> = [];

  try {
    stockReservations = regularItems.length
      ? await reserveOrderStock({
          actor: { actorId: checkoutActorId(input), actorType: "customer" },
          items: regularItems,
          referenceId: orderNumber,
        })
      : [];
  } catch (error) {
    await releasePreOrderSlots(preOrderReservations);
    throw error;
  }
  const order = await Order.create({
    adjustments: calculation.adjustments,
    billingAddress: input.billingAddress ?? input.shippingAddress,
    cartId: cart._id,
    items: calculation.items,
    notes: input.notes,
    orderNumber,
    paymentMethod: input.paymentMethod,
    paymentMode,
    paymentSessionId: payment.session?._id ?? payment._id,
    shippingAddress: input.shippingAddress,
    shippingMethod: input.shippingMethod,
    status,
    stockReservations,
    taxBreakdown: calculation.taxBreakdown,
    totals: calculation.totals,
    ...(input.userId ? { userId: input.userId } : {}),
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
  });

  if (
    stockReservations.length &&
    (status === "confirmed" || status === "cod_confirmed" || status === "pre_order_confirmed")
  ) {
    await deductOrderReservedStock({
      actor: { actorId: checkoutActorId(input), actorType: "customer" },
      referenceId: orderNumber,
      reservations: stockReservations,
    });
    for (const reservation of order.stockReservations) {
      if (reservation.status === "reserved") {
        reservation.status = "deducted";
      }
    }
    await order.save();
  }

  if (hasPreOrderItems && input.paymentMethod !== "razorpay") {
    await createProductionTrackersForOrder(order);
  }

  cart.items = [];
  cart.giftCardRedemptions = [];
  cart.giftPackaging = { enabled: false, fee: 0 };
  cart.totals = {
    currencyCode: calculation.totals.currencyCode,
    giftCardDiscount: 0,
    giftPackagingFee: 0,
    grandTotal: 0,
    subtotal: 0,
  };
  await cart.save();
  if (input.paymentMethod !== "razorpay") {
    await sendOrderConfirmationEmail(input, order, payableNow);
  }

  return { gatewayOrder: payment.gatewayOrder, order, paymentSession: payment.session ?? payment };
}

async function calculateOrderTotals(
  cart: Awaited<ReturnType<typeof loadCheckoutCart>>,
  input: {
    shippingMethod: "standard" | "express";
    couponCode?: string;
    storeCreditRequested?: number;
    rewardValueRequested?: number;
  },
) {
  const lines = cartLines(cart);

  if (!lines.length) {
    throw new AppError("Cart is empty", 400);
  }

  const items = [];
  const taxBreakdown = new Map<number, { taxableAmount: number; gstAmount: number }>();

  for (const line of lines) {
    if (line.preOrder?.enabled) {
      assertPreOrderWindow(line.preOrder);
    }

    const product = await loadProductForCheckout(String(line.productId), String(line.variantId));
    const variant = product.variants.find((item) => String(item._id) === String(line.variantId));
    const lineSubtotal = roundMoney(line.unitPrice * line.quantity);
    const taxableAmount = roundMoney(lineSubtotal / (1 + product.gstRate / 100));
    const gstAmount = roundMoney(lineSubtotal - taxableAmount);
    const currentBreakdown = taxBreakdown.get(product.gstRate) ?? {
      gstAmount: 0,
      taxableAmount: 0,
    };
    taxBreakdown.set(product.gstRate, {
      gstAmount: roundMoney(currentBreakdown.gstAmount + gstAmount),
      taxableAmount: roundMoney(currentBreakdown.taxableAmount + taxableAmount),
    });
    const preOrder = line.preOrder?.enabled
      ? {
          enabled: true,
          expectedDeliveryAt: line.preOrder.expectedDeliveryAt,
          expectedDispatchAt: line.preOrder.expectedDispatchAt,
          paymentMode: line.preOrder.paymentMode,
        }
      : undefined;

    items.push({
      currencyCode: line.currencyCode,
      costPrice: variant?.costPrice ?? 0,
      gstAmount,
      gstRate: product.gstRate,
      hsnCode: product.hsnCode,
      lineSubtotal,
      media: line.media,
      preOrder,
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      sku: line.sku,
      slug: line.slug,
      taxableAmount,
      unitPrice: line.unitPrice,
      variantId: line.variantId,
    });
  }

  const itemSubtotal = roundMoney(items.reduce((total, item) => total + item.lineSubtotal, 0));
  const giftPackagingFee = roundMoney(
    cart.giftPackaging?.enabled ? (cart.giftPackaging.fee ?? 0) : 0,
  );
  const shippingFee = await calculateShippingFee(itemSubtotal, input.shippingMethod);
  const couponDiscount = calculateCouponStubDiscount(input.couponCode);
  const giftCardDiscount = roundMoney(
    Math.min(
      itemSubtotal + giftPackagingFee + shippingFee,
      (cart.giftCardRedemptions as Array<{ amount: number }>).reduce(
        (total, redemption) => total + redemption.amount,
        0,
      ),
    ),
  );
  const storeCreditApplied = Math.min(input.storeCreditRequested ?? 0, 0);
  const rewardValueApplied = Math.min(input.rewardValueRequested ?? 0, 0);
  const discountTotal = roundMoney(couponDiscount);
  const taxableTotal = roundMoney(items.reduce((total, item) => total + item.taxableAmount, 0));
  const gstTotal = roundMoney(items.reduce((total, item) => total + item.gstAmount, 0));
  const grandTotal = roundMoney(
    Math.max(
      0,
      itemSubtotal +
        giftPackagingFee +
        shippingFee -
        discountTotal -
        giftCardDiscount -
        storeCreditApplied -
        rewardValueApplied,
    ),
  );

  return {
    adjustments: [
      ...(input.couponCode
        ? [
            {
              amount: couponDiscount,
              code: input.couponCode,
              label: "Coupon stub",
              type: "coupon" as const,
            },
          ]
        : []),
      { amount: shippingFee, label: `${input.shippingMethod} shipping`, type: "shipping" as const },
      { amount: giftPackagingFee, label: "Gift packaging", type: "gift_packaging" as const },
      { amount: giftCardDiscount, label: "Gift card", type: "gift_card" as const },
      { amount: storeCreditApplied, label: "Store credit stub", type: "store_credit" as const },
      { amount: rewardValueApplied, label: "Reward redemption stub", type: "reward" as const },
    ],
    items,
    preOrderPaymentMode: resolvePreOrderPaymentMode(items),
    taxBreakdown: [...taxBreakdown.entries()].map(([gstRate, value]) => ({ gstRate, ...value })),
    totals: {
      currencyCode: lines[0]?.currencyCode ?? "INR",
      discountTotal,
      giftCardDiscount,
      giftPackagingFee,
      grandTotal,
      gstAmount: gstTotal,
      itemSubtotal,
      rewardValueApplied,
      shippingFee,
      storeCreditApplied,
      taxableAmount: taxableTotal,
    },
  };
}

async function createPaymentForOrder(
  input: CheckoutInput,
  orderReference: string,
  amount: number,
  payableNow: number,
  paymentMode: "full" | "advance" | "balance",
) {
  const base = {
    amount,
    currencyCode: "INR",
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
    orderReference,
    payableNow,
    paymentMode,
    userId: input.userId,
  };

  if (input.paymentMethod === "razorpay") {
    return createRazorpayPayment(base);
  }

  if (input.paymentMethod === "cod") {
    return createCodPayment(base);
  }

  if (input.paymentMethod === "manual_bank_transfer") {
    if (!input.manualScreenshot) {
      throw new AppError("Manual payment screenshot is required", 400);
    }

    return createManualPayment({ ...base, manualScreenshot: input.manualScreenshot });
  }

  return createUpiPayment({ ...base, upiReference: input.upiReference });
}

function mapInitialOrderStatus(
  paymentMethod: CheckoutInput["paymentMethod"],
  paymentStatus: string,
  hasPreOrderItems = false,
) {
  if (hasPreOrderItems && (paymentStatus === "confirmed" || paymentMethod === "cod")) {
    return "pre_order_confirmed";
  }

  if (paymentMethod === "cod") {
    return "cod_confirmed";
  }

  if (paymentMethod === "manual_bank_transfer") {
    return "payment_verification_pending";
  }

  if (paymentMethod === "upi") {
    return "pending_payment";
  }

  if (paymentStatus === "confirmed") {
    return "confirmed";
  }

  return "pending_payment";
}

async function loadCheckoutCart(input: Pick<CheckoutInput, "guestSessionId" | "userId">) {
  if (!input.userId && !input.guestSessionId) {
    throw new AppError("Guest session or authentication is required", 401);
  }

  const cart = await Cart.findOne(
    input.userId ? { userId: input.userId } : { guestSessionId: input.guestSessionId },
  );

  if (!cart) {
    throw new AppError("Cart not found", 404);
  }

  return cart;
}

function checkoutActorId(input: Pick<CheckoutInput, "guestEmail" | "guestSessionId" | "userId">) {
  return input.userId ?? input.guestSessionId ?? input.guestEmail ?? "guest";
}

async function loadProductForCheckout(productId: string, variantId: string): Promise<ProductLean> {
  const product = (await Product.findOne({
    _id: productId,
    active: true,
    status: { $ne: "deleted" },
  }).lean()) as ProductLean | null;

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const variant = product.variants.find(
    (item) => String(item._id) === variantId && item.active !== false,
  );

  if (!variant) {
    throw new AppError("Product variant is not available", 409);
  }

  const inventoryAvailable = await getAvailableStockBySku(variant.sku);
  const preOrderActive = isPreOrderActive(variant.preOrder);

  if (preOrderActive) {
    assertPreOrderWindow(variant.preOrder);
    return product;
  }

  if ((inventoryAvailable ?? variant.stockPlaceholder ?? 0) <= 0) {
    throw new AppError("Product variant is not available", 409);
  }

  return product;
}

function resolvePreOrderPaymentMode(
  items: Array<{ preOrder?: { enabled?: boolean; paymentMode?: "full" | "advance" } }>,
) {
  const modes = new Set(items.map((item) => item.preOrder?.paymentMode).filter(Boolean));

  if (!modes.size) {
    return undefined;
  }

  if (modes.size > 1) {
    throw new AppError("Cart cannot mix advance and full pre-order payment modes", 409);
  }

  return [...modes][0];
}

function assertPreOrderPaymentMode(
  hasPreOrderItems: boolean,
  paymentMode: "full" | "advance" | "balance",
  requiredMode?: "full" | "advance",
) {
  if (paymentMode === "balance") {
    throw new AppError(
      "Balance payment mode is only available for paying an existing order's outstanding balance",
      400,
    );
  }

  if (!hasPreOrderItems) {
    return;
  }

  if (requiredMode && paymentMode !== requiredMode) {
    throw new AppError(`Pre-order requires ${requiredMode} payment mode`, 400);
  }
}

function cartLines(cart: { items: unknown }): CartLine[] {
  return cart.items as CartLine[];
}

async function calculateShippingFee(itemSubtotal: number, method: "standard" | "express") {
  const freeThreshold = await getRuntimeNumberSetting(
    "SHIPPING_FREE_THRESHOLD",
    env.SHIPPING_FREE_THRESHOLD,
  );
  const standardFee = await getRuntimeNumberSetting(
    "SHIPPING_STANDARD_FEE",
    env.SHIPPING_STANDARD_FEE,
  );
  const expressFee = await getRuntimeNumberSetting(
    "SHIPPING_EXPRESS_FEE",
    env.SHIPPING_EXPRESS_FEE,
  );

  if (method === "standard" && itemSubtotal >= freeThreshold) {
    return 0;
  }

  return method === "express" ? expressFee : standardFee;
}

function calculateCouponStubDiscount(_couponCode?: string) {
  return 0;
}

function normalizePayableNow(total: number, payableNow?: number) {
  const value = Math.round(payableNow ?? total);

  if (value <= 0 || value > total) {
    throw new AppError("Payable amount is invalid", 400);
  }

  return value;
}

function buildOrderNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

  return `TVH-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
