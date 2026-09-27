import crypto from "node:crypto";
import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { Cart } from "../models/Cart.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { User } from "../models/User.js";
import { evaluateCoupon, redeemCoupon, reverseCouponRedemption, type CouponEvaluation } from "./couponService.js";
import { assessOrderRisk } from "./fraudService.js";
import { getGiftCardByCode, isGiftCardUsable, redeemGiftCardsForOrder, restoreGiftCardsForOrder } from "./giftCardService.js";
import {
  createCreditTermsPayment,
  createManualPayment,
  createRazorpayPayment,
  createUpiPayment,
} from "./paymentService.js";
import {
  assertWholesaleMinimums,
  creditTermsDueDate,
  getWholesaleAccount,
  outstandingCredit,
  type WholesaleAccount,
} from "./wholesaleService.js";
import {
  deductOrderReservedStock,
  getAvailableStockBySku,
  releaseOrderStock,
  reserveOrderStock,
} from "./inventoryService.js";
import {
  assertPreOrderWindow,
  isPreOrderActive,
  releasePreOrderSlots,
  reservePreOrderSlots,
  type PreOrderVariantSnapshot,
} from "./preOrderService.js";
import { qualifyReferral } from "./referralService.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";
import {
  earnPointsForOrder,
  getRewardPointsBalance,
  pointsToValue,
  redeemPointsByValue,
  restoreRedeemedPoints,
  valueToPoints,
} from "./rewardPointsService.js";
import { getStoreCreditBalance, redeemStoreCredit, restoreStoreCredit } from "./storeCreditService.js";

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
  paymentMethod: "razorpay" | "cod" | "manual_bank_transfer" | "upi" | "credit_terms";
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
  whatsappOptIn?: boolean;
  saveAddress?: boolean;
  marketingConsent?: boolean;
  ipAddress?: string;
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
  categoryIds?: Types.ObjectId[];
  variants: Array<{
    _id: Types.ObjectId;
    sku: string;
    costPrice?: number;
    active?: boolean;
    preOrder?: PreOrderVariantSnapshot;
  }>;
};

type CalculationMode = "preview" | "order";

export async function previewCheckout(input: Omit<CheckoutInput, "paymentMethod">) {
  const cart = await loadCheckoutCart(input);

  if (input.guestEmail && !input.userId && cart.contactEmail !== input.guestEmail.toLowerCase()) {
    cart.contactEmail = input.guestEmail.toLowerCase();
    cart.marketingConsent = input.marketingConsent === true;
    await cart.save();
  }

  return calculateOrderTotals(cart, {
    couponCode: input.couponCode,
    guestEmail: input.guestEmail,
    mode: "preview",
    rewardValueRequested: input.rewardValueRequested,
    shippingMethod: input.shippingMethod,
    storeCreditRequested: input.storeCreditRequested,
    userId: input.userId,
  });
}

export async function createOrderFromCheckout(input: CheckoutInput) {
  if (!input.userId && !input.guestEmail) {
    throw new AppError("Email is required for guest checkout", 400);
  }

  const cart = await loadCheckoutCart(input);
  await supersedePendingOrdersForCart(cart._id);
  const calculation = await calculateOrderTotals(cart, {
    couponCode: input.couponCode,
    guestEmail: input.guestEmail,
    mode: "order",
    rewardValueRequested: input.rewardValueRequested,
    shippingMethod: input.shippingMethod,
    storeCreditRequested: input.storeCreditRequested,
    userId: input.userId,
  });
  const orderNumber = buildOrderNumber();
  const wholesale = await getWholesaleAccount(input.userId);
  await assertPaymentMethodAllowed(input, wholesale, calculation.totals.grandTotal);

  if (wholesale) {
    await assertWholesaleMinimums(calculation.items);
  }

  // Secured COD and wholesale "advance_50" terms both collect 50% now via Razorpay.
  const halfNow =
    input.paymentMethod === "cod" ||
    (input.paymentMethod === "razorpay" && wholesale?.paymentTerms === "advance_50");
  const paymentMode = halfNow ? "advance" : "full";
  const payableNow = halfNow
    ? Math.round(calculation.totals.grandTotal * 0.5)
    : calculation.totals.grandTotal;
  const hasPreOrderItems = calculation.items.some((item) => item.preOrder?.enabled);
  assertCheckoutPaymentMode(input.paymentMode);
  const risk = await assessOrderRisk({
    grandTotal: calculation.totals.grandTotal,
    guestEmail: input.guestEmail,
    ipAddress: input.ipAddress,
    paymentMethod: input.paymentMethod,
    phone: input.shippingAddress.phone,
    userId: input.userId,
  });

  if (calculation.totals.grandTotal <= 0) {
    throw new AppError(
      "Orders fully covered by credits cannot be placed online. Please contact support.",
      400,
    );
  }

  const payment = await createPaymentForOrder(
    input,
    orderNumber,
    calculation.totals.grandTotal,
    payableNow,
    paymentMode,
    wholesale,
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

  // Money-moving redemptions. Each step is idempotent/conditional; on failure every
  // completed step is compensated so no partial debit survives a failed checkout.
  const completed = {
    couponRedemptionId: undefined as unknown,
    giftCards: [] as Array<{ code: string; amount: number }>,
    rewardPoints: 0,
    storeCredit: 0,
  };

  try {
    if (calculation.coupon) {
      const redemption = await redeemCoupon({
        evaluation: calculation.coupon,
        guestEmail: input.guestEmail,
        orderNumber,
        userId: input.userId,
      });
      completed.couponRedemptionId = redemption._id;
    }

    if (calculation.giftCardRedemptions.length) {
      completed.giftCards = await redeemGiftCardsForOrder({
        orderNumber,
        redemptions: calculation.giftCardRedemptions,
      });
    }

    if (input.userId && calculation.totals.storeCreditApplied > 0) {
      await redeemStoreCredit({
        amount: calculation.totals.storeCreditApplied,
        orderNumber,
        userId: input.userId,
      });
      completed.storeCredit = calculation.totals.storeCreditApplied;
    }

    if (input.userId && calculation.rewardPointsRedeemed > 0) {
      const redeemed = await redeemPointsByValue({
        orderNumber,
        requestedValue: calculation.totals.rewardValueApplied,
        userId: input.userId,
      });
      completed.rewardPoints = redeemed.pointsRedeemed;
    }
  } catch (error) {
    await compensateRedemptions(input, orderNumber, completed);
    await releaseOrderStock({
      actor: { actorId: checkoutActorId(input), actorType: "customer" },
      referenceId: orderNumber,
      reservations: stockReservations,
    });
    await releasePreOrderSlots(preOrderReservations);
    throw error;
  }

  const order = await Order.create({
    adjustments: calculation.adjustments,
    attribution: cart.attribution,
    billingAddress: input.billingAddress ?? input.shippingAddress,
    cartId: cart._id,
    couponCode: calculation.coupon?.code,
    customerType: calculation.customerType,
    financials: {
      couponRedemptionId: completed.couponRedemptionId,
      giftCardRedemptions: completed.giftCards,
      rewardPointsRedeemed: completed.rewardPoints,
      storeCreditRedeemed: completed.storeCredit,
    },
    items: calculation.items,
    notes: input.notes,
    orderNumber,
    paymentMethod: input.paymentMethod,
    paymentMode,
    paymentTerms: wholesale?.paymentTerms,
    paymentSessionId: payment.session?._id ?? payment._id,
    priceListCode: calculation.priceListCode,
    risk,
    shippingAddress: input.shippingAddress,
    shippingMethod: input.shippingMethod,
    status,
    stockReservations,
    taxBreakdown: calculation.taxBreakdown,
    totals: calculation.totals,
    ...(input.userId ? { userId: input.userId } : {}),
    guestEmail: input.guestEmail?.toLowerCase(),
    guestSessionId: input.guestSessionId,
    whatsappOptIn: input.whatsappOptIn === true,
  });

  if (input.userId) {
    await rememberCheckoutDetails(input);
  }

  if (input.paymentMethod === "credit_terms") {
    const { confirmOrderOnCredit } = await import("./orderFulfillmentService.js");
    await confirmOrderOnCredit(order);
    return { gatewayOrder: undefined, order, paymentSession: payment.session ?? payment };
  }

  if (stockReservations.length && (status === "confirmed" || status === "pre_order_confirmed")) {
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

  if (status === "confirmed" || status === "pre_order_confirmed") {
    const earned = await earnPointsForOrder(order);
    if (earned) {
      order.financials = { ...(order.financials ?? {}), rewardPointsEarned: earned };
      await order.save();
    }
    await qualifyReferral(order);
  }

  return { gatewayOrder: payment.gatewayOrder, order, paymentSession: payment.session ?? payment };
}

async function compensateRedemptions(
  input: Pick<CheckoutInput, "userId">,
  orderNumber: string,
  completed: { couponRedemptionId?: unknown; giftCards: Array<{ code: string; amount: number }>; rewardPoints: number; storeCredit: number },
) {
  if (completed.couponRedemptionId) {
    await reverseCouponRedemption(orderNumber);
  }
  if (completed.giftCards.length) {
    await restoreGiftCardsForOrder({ orderNumber, redemptions: completed.giftCards });
  }
  if (input.userId && completed.storeCredit > 0) {
    await restoreStoreCredit({ amount: completed.storeCredit, orderNumber, userId: input.userId });
  }
  if (input.userId && completed.rewardPoints > 0) {
    await restoreRedeemedPoints({ orderNumber, points: completed.rewardPoints, userId: input.userId });
  }
}

/**
 * A customer who abandons the Razorpay modal keeps their cart; if they check out again, the
 * previous unpaid attempt is cancelled so its stock, coupon and credits are released first.
 */
async function supersedePendingOrdersForCart(cartId: unknown) {
  const pending = (await Order.find({ cartId, status: "pending_payment" }).limit(5)) as unknown[];

  if (!Array.isArray(pending) || !pending.length) {
    return;
  }

  const { cancelSupersededOrder } = await import("./orderLifecycleService.js");

  for (const order of pending) {
    await cancelSupersededOrder(order);
  }
}

async function rememberCheckoutDetails(input: CheckoutInput) {
  if (input.whatsappOptIn === true) {
    await User.updateOne({ _id: input.userId }, { $set: { whatsappOptIn: true } });
  }

  if (input.shippingAddress.phone) {
    // Only fill the profile phone if the customer has not set one yet.
    await User.updateOne(
      { _id: input.userId, $or: [{ phone: { $exists: false } }, { phone: "" }] },
      { $set: { phone: input.shippingAddress.phone } },
    );
  }

  if (input.saveAddress) {
    const { saveCheckoutAddress } = await import("./addressService.js");
    await saveCheckoutAddress(String(input.userId), input.shippingAddress);
  }
}

async function calculateOrderTotals(
  cart: Awaited<ReturnType<typeof loadCheckoutCart>>,
  input: {
    shippingMethod: "standard" | "express";
    couponCode?: string;
    storeCreditRequested?: number;
    rewardValueRequested?: number;
    userId?: string;
    guestEmail?: string;
    mode: CalculationMode;
  },
) {
  const lines = cartLines(cart);

  if (!lines.length) {
    throw new AppError("Cart is empty", 400);
  }

  const items = [];
  const couponLines: Array<{ productId: unknown; categoryIds: unknown[]; lineSubtotal: number }> = [];
  const taxBreakdown = new Map<number, { taxableAmount: number; gstAmount: number }>();

  for (const line of lines) {
    if (line.preOrder?.enabled) {
      assertPreOrderWindow(line.preOrder);
    }

    const product = await loadProductForCheckout(
      String(line.productId),
      String(line.variantId),
      line.quantity,
      Boolean(line.preOrder?.enabled),
    );
    const variant = product.variants.find((item) => String(item._id) === String(line.variantId));
    const lineSubtotal = roundMoney(line.unitPrice * line.quantity);
    const preOrder = line.preOrder?.enabled
      ? {
          enabled: true,
          expectedDeliveryAt: line.preOrder.expectedDeliveryAt,
          expectedDispatchAt: line.preOrder.expectedDispatchAt,
          paymentMode: line.preOrder.paymentMode,
        }
      : undefined;

    couponLines.push({
      categoryIds: product.categoryIds ?? [],
      lineSubtotal,
      productId: line.productId,
    });
    items.push({
      currencyCode: line.currencyCode,
      costPrice: variant?.costPrice ?? 0,
      gstAmount: 0,
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
      taxableAmount: 0,
      unitPrice: line.unitPrice,
      variantId: line.variantId,
    });
  }

  const itemSubtotal = roundMoney(items.reduce((total, item) => total + item.lineSubtotal, 0));
  const giftPackagingFee = roundMoney(
    cart.giftPackaging?.enabled ? (cart.giftPackaging.fee ?? 0) : 0,
  );
  const baseShippingFee = await calculateShippingFee(itemSubtotal, input.shippingMethod);
  let coupon: CouponEvaluation | undefined;
  let couponError: string | undefined;

  if (input.couponCode?.trim()) {
    try {
      coupon = await evaluateCoupon({
        code: input.couponCode,
        guestEmail: input.guestEmail,
        lines: couponLines,
        shippingFee: baseShippingFee,
        userId: input.userId,
      });
    } catch (error) {
      if (input.mode === "order" || !(error instanceof AppError)) {
        throw error;
      }
      couponError = error.message;
    }
  }

  if (coupon && !coupon.combinableWithStoreCredit && (input.storeCreditRequested ?? 0) > 0) {
    throw new AppError(`Coupon ${coupon.code} cannot be combined with store credit`, 400);
  }

  if (coupon && !coupon.combinableWithRewards && (input.rewardValueRequested ?? 0) > 0) {
    throw new AppError(`Coupon ${coupon.code} cannot be combined with reward points`, 400);
  }

  const couponItemDiscount = coupon?.itemDiscount ?? 0;
  const shippingFee = roundMoney(Math.max(0, baseShippingFee - (coupon?.shippingDiscount ?? 0)));

  // GST is price-inclusive. A coupon lowers the taxable consideration, so allocate the item
  // discount across lines pro-rata and compute tax on the discounted value (CGST s.15(3)).
  for (const item of items) {
    const share = itemSubtotal > 0 ? item.lineSubtotal / itemSubtotal : 0;
    const discountedLine = Math.max(0, item.lineSubtotal - couponItemDiscount * share);
    const taxableAmount = roundMoney(discountedLine / (1 + item.gstRate / 100));
    const gstAmount = roundMoney(discountedLine - taxableAmount);
    item.taxableAmount = taxableAmount;
    item.gstAmount = gstAmount;
    const currentBreakdown = taxBreakdown.get(item.gstRate) ?? { gstAmount: 0, taxableAmount: 0 };
    taxBreakdown.set(item.gstRate, {
      gstAmount: roundMoney(currentBreakdown.gstAmount + gstAmount),
      taxableAmount: roundMoney(currentBreakdown.taxableAmount + taxableAmount),
    });
  }

  const giftCardRedemptions = await resolveGiftCardRedemptions(
    cart.giftCardRedemptions as Array<{ code: string; amount: number }>,
    Math.max(0, itemSubtotal - couponItemDiscount + giftPackagingFee + shippingFee),
    coupon,
  );
  const giftCardDiscount = roundMoney(
    giftCardRedemptions.reduce((total, redemption) => total + redemption.amount, 0),
  );
  const discountTotal = roundMoney(couponItemDiscount + (coupon?.shippingDiscount ?? 0));
  const preLoyaltyRemaining = Math.max(
    0,
    itemSubtotal + giftPackagingFee + shippingFee - couponItemDiscount - giftCardDiscount,
  );
  let storeCreditApplied = 0;
  let rewardValueApplied = 0;
  let rewardPointsRedeemed = 0;

  if (input.userId) {
    const requestedStoreCredit = Math.max(0, input.storeCreditRequested ?? 0);

    if (requestedStoreCredit > 0) {
      const storeCreditBalance = await getStoreCreditBalance(input.userId);
      storeCreditApplied = roundMoney(
        Math.min(requestedStoreCredit, storeCreditBalance, preLoyaltyRemaining),
      );
    }

    const requestedRewardValue = Math.max(0, input.rewardValueRequested ?? 0);

    if (requestedRewardValue > 0) {
      const remainingAfterStoreCredit = Math.max(0, preLoyaltyRemaining - storeCreditApplied);
      const cappedRequest = Math.min(requestedRewardValue, remainingAfterStoreCredit);
      const pointsBalance = await getRewardPointsBalance(input.userId);
      rewardPointsRedeemed = Math.min(await valueToPoints(cappedRequest), pointsBalance);
      rewardValueApplied = roundMoney(await pointsToValue(rewardPointsRedeemed));
    }
  }

  const taxableTotal = roundMoney(items.reduce((total, item) => total + item.taxableAmount, 0));
  const gstTotal = roundMoney(items.reduce((total, item) => total + item.gstAmount, 0));
  const grandTotal = roundMoney(
    Math.max(0, preLoyaltyRemaining - storeCreditApplied - rewardValueApplied),
  );
  const customer = input.userId
    ? ((await User.findById(input.userId).select("customerType priceListCode").lean()) as {
        customerType?: "retail" | "wholesale";
        priceListCode?: string;
      } | null)
    : null;

  return {
    adjustments: [
      ...(coupon
        ? [
            {
              amount: discountTotal,
              code: coupon.code,
              label: `Coupon ${coupon.code}`,
              type: "coupon" as const,
            },
          ]
        : []),
      { amount: shippingFee, label: `${input.shippingMethod} shipping`, type: "shipping" as const },
      { amount: giftPackagingFee, label: "Gift packaging", type: "gift_packaging" as const },
      { amount: giftCardDiscount, label: "Gift card", type: "gift_card" as const },
      { amount: storeCreditApplied, label: "Store credit", type: "store_credit" as const },
      { amount: rewardValueApplied, label: "Reward points", type: "reward" as const },
    ],
    coupon,
    couponError,
    customerType: customer?.customerType ?? "retail",
    giftCardRedemptions,
    items,
    preOrderPaymentMode: resolvePreOrderPaymentMode(items),
    priceListCode:
      customer?.customerType === "wholesale" ? customer.priceListCode || "WHOLESALE" : undefined,
    rewardPointsRedeemed,
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

/** Re-reads each applied gift card so a stale cart snapshot can never overspend a card. */
async function resolveGiftCardRedemptions(
  snapshots: Array<{ code: string; amount: number }> = [],
  payable: number,
  coupon?: CouponEvaluation,
) {
  if (!snapshots.length) {
    return [];
  }

  if (coupon && !coupon.combinableWithGiftCards) {
    throw new AppError(`Coupon ${coupon.code} cannot be combined with gift cards`, 400);
  }

  let remaining = payable;
  const resolved: Array<{ code: string; amount: number }> = [];

  for (const snapshot of snapshots) {
    if (remaining <= 0) {
      break;
    }

    const card = await getGiftCardByCode(snapshot.code);

    if (!isGiftCardUsable(card)) {
      throw new AppError(`Gift card ${snapshot.code} is no longer valid. Remove it to continue.`, 409);
    }

    // Never exceed the amount validated into the cart, the live balance, or what is payable.
    const amount = roundMoney(Math.min(snapshot.amount, card!.balance, remaining));
    resolved.push({ amount, code: card!.code });
    remaining -= amount;
  }

  return resolved;
}

/** Storefront payment policy: v1 retail = Razorpay or secured COD; wholesale per its terms. */
async function assertPaymentMethodAllowed(
  input: CheckoutInput,
  wholesale: WholesaleAccount | undefined,
  grandTotal: number,
) {
  if (input.paymentMethod === "credit_terms") {
    if (!wholesale || !["net_15", "net_30"].includes(wholesale.paymentTerms)) {
      throw new AppError("Credit terms are only available to approved wholesale accounts", 403);
    }

    const outstanding = await outstandingCredit(String(input.userId));
    if (outstanding + grandTotal > wholesale.creditLimit) {
      throw new AppError(
        `This order exceeds your available credit (limit ${wholesale.creditLimit}, outstanding ${outstanding}). Pay online or settle open invoices first.`,
        409,
      );
    }
  }

  if (wholesale && input.paymentMethod === "cod") {
    throw new AppError("Cash on delivery is not available for wholesale orders", 400);
  }
}

async function createPaymentForOrder(
  input: CheckoutInput,
  orderReference: string,
  amount: number,
  payableNow: number,
  paymentMode: "full" | "advance" | "balance",
  wholesale?: WholesaleAccount,
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

  if (input.paymentMethod === "razorpay" || input.paymentMethod === "cod") {
    return createRazorpayPayment(base);
  }

  if (input.paymentMethod === "credit_terms") {
    return createCreditTermsPayment({
      ...base,
      dueAt: creditTermsDueDate(wholesale?.paymentTerms ?? "net_15"),
    });
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
  if (hasPreOrderItems && paymentStatus === "confirmed") {
    return "pre_order_confirmed";
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

async function loadProductForCheckout(
  productId: string,
  variantId: string,
  quantity: number,
  purchaseAsPreOrder: boolean,
): Promise<ProductLean> {
  const product = (await Product.findOne({
    _id: productId,
    active: true,
    status: { $ne: "deleted" },
  }).lean()) as ProductLean | null;

  if (!product) {
    throw new AppError("A product in your cart is no longer available", 409);
  }

  const variant = product.variants.find(
    (item) => String(item._id) === variantId && item.active !== false,
  );

  if (!variant) {
    throw new AppError("A selected size/colour is no longer available. Please update your cart.", 409);
  }

  if (purchaseAsPreOrder || isPreOrderActive(variant.preOrder)) {
    if (purchaseAsPreOrder) {
      assertPreOrderWindow(variant.preOrder);
      return product;
    }
  }

  // The inventory ledger is the single source of truth. A SKU with no ledger row has no stock.
  const inventoryAvailable = (await getAvailableStockBySku(variant.sku)) ?? 0;

  if (inventoryAvailable < quantity) {
    if (isPreOrderActive(variant.preOrder)) {
      assertPreOrderWindow(variant.preOrder);
      return product;
    }

    throw new AppError(
      inventoryAvailable > 0
        ? `Only ${inventoryAvailable} left for ${variant.sku}. Please reduce the quantity.`
        : `${variant.sku} is out of stock. Please remove it from your cart.`,
      409,
    );
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

function assertCheckoutPaymentMode(paymentMode?: "full" | "advance" | "balance") {
  if (paymentMode === "balance") {
    throw new AppError(
      "Balance payment mode is only available for paying an existing order's outstanding balance",
      400,
    );
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

function buildOrderNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

  return `TVH-${stamp}-${crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
