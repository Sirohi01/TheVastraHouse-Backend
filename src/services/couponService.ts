import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Coupon, CouponRedemption } from "../models/Coupon.js";
import { Order } from "../models/Order.js";

export type CouponLine = {
  productId: unknown;
  categoryIds: unknown[];
  lineSubtotal: number;
};

export type CouponEvaluation = {
  couponId: string;
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  itemDiscount: number;
  shippingDiscount: number;
  combinableWithStoreCredit: boolean;
  combinableWithRewards: boolean;
  combinableWithGiftCards: boolean;
  eligibleSubtotal: number;
};

type CouponLean = {
  _id: Types.ObjectId;
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  value: number;
  minCartValue?: number;
  maxDiscount?: number;
  startsAt?: Date;
  endsAt?: Date;
  active: boolean;
  status?: string;
  usageLimit?: number;
  perUserLimit?: number;
  usedCount: number;
  applicableProductIds?: unknown[];
  applicableCategoryIds?: unknown[];
  excludedProductIds?: unknown[];
  excludedCategoryIds?: unknown[];
  firstOrderOnly?: boolean;
  allowedUserIds?: unknown[];
  combinableWithStoreCredit?: boolean;
  combinableWithRewards?: boolean;
  combinableWithGiftCards?: boolean;
};

const nonCountingOrderStatuses = ["cancelled", "pending_payment", "payment_rejected"];

export function normalizeCouponCode(code: string) {
  return code.trim().toUpperCase();
}

/**
 * Validates a coupon against the server-computed cart and returns the discount. Every rule is
 * enforced here; the client only ever sends a code.
 */
export async function evaluateCoupon(input: {
  code: string;
  lines: CouponLine[];
  shippingFee: number;
  userId?: string;
  guestEmail?: string;
  now?: Date;
}): Promise<CouponEvaluation> {
  const now = input.now ?? new Date();
  const code = normalizeCouponCode(input.code);
  const coupon = (await Coupon.findOne({
    code,
    status: { $ne: "deleted" },
  }).lean()) as CouponLean | null;

  if (!coupon || !coupon.active) {
    throw new AppError("This coupon code is not valid", 400);
  }

  if (coupon.startsAt && coupon.startsAt.getTime() > now.getTime()) {
    throw new AppError("This coupon is not active yet", 400);
  }

  if (coupon.endsAt && coupon.endsAt.getTime() < now.getTime()) {
    throw new AppError("This coupon has expired", 400);
  }

  if (
    coupon.usageLimit !== undefined &&
    coupon.usageLimit !== null &&
    coupon.usedCount >= coupon.usageLimit
  ) {
    throw new AppError("This coupon has reached its usage limit", 400);
  }

  if (coupon.allowedUserIds?.length) {
    const allowed = coupon.allowedUserIds.map(String);
    if (!input.userId || !allowed.includes(input.userId)) {
      throw new AppError("This coupon is not available for your account", 400);
    }
  }

  if ((coupon.perUserLimit || coupon.firstOrderOnly) && !input.userId && !input.guestEmail) {
    throw new AppError("Sign in or enter your email to use this coupon", 400);
  }

  const identity = input.userId
    ? { userId: new Types.ObjectId(input.userId) }
    : input.guestEmail
      ? { guestEmail: input.guestEmail.toLowerCase() }
      : undefined;

  if (identity && coupon.perUserLimit) {
    const used = await CouponRedemption.countDocuments({
      ...identity,
      couponId: coupon._id,
      status: "applied",
    });
    if (used >= coupon.perUserLimit) {
      throw new AppError("You have already used this coupon", 400);
    }
  }

  if (identity && coupon.firstOrderOnly) {
    const previousOrders = await Order.countDocuments({
      ...identity,
      status: { $nin: nonCountingOrderStatuses },
    });
    if (previousOrders > 0) {
      throw new AppError("This coupon is only valid on your first order", 400);
    }
  }

  const eligibleSubtotal = roundMoney(
    input.lines
      .filter((line) => isLineEligible(coupon, line))
      .reduce((total, line) => total + line.lineSubtotal, 0),
  );

  if (eligibleSubtotal <= 0) {
    throw new AppError("This coupon does not apply to the items in your cart", 400);
  }

  const cartSubtotal = input.lines.reduce((total, line) => total + line.lineSubtotal, 0);

  if (coupon.minCartValue && cartSubtotal < coupon.minCartValue) {
    throw new AppError(
      `Add items worth ${formatInr(coupon.minCartValue - cartSubtotal)} more to use this coupon`,
      400,
    );
  }

  let itemDiscount = 0;
  let shippingDiscount = 0;

  if (coupon.type === "percentage") {
    itemDiscount = (eligibleSubtotal * Math.min(coupon.value, 100)) / 100;
  } else if (coupon.type === "fixed") {
    itemDiscount = Math.min(coupon.value, eligibleSubtotal);
  } else {
    shippingDiscount = input.shippingFee;
  }

  if (coupon.maxDiscount && coupon.maxDiscount > 0) {
    itemDiscount = Math.min(itemDiscount, coupon.maxDiscount);
  }

  return {
    code: coupon.code,
    combinableWithGiftCards: coupon.combinableWithGiftCards !== false,
    combinableWithRewards: coupon.combinableWithRewards !== false,
    combinableWithStoreCredit: coupon.combinableWithStoreCredit !== false,
    couponId: String(coupon._id),
    eligibleSubtotal,
    itemDiscount: roundMoney(Math.min(itemDiscount, eligibleSubtotal)),
    shippingDiscount: roundMoney(shippingDiscount),
    type: coupon.type,
  };
}

/**
 * Records a redemption and consumes one global use. The conditional increment prevents the
 * usage limit from being exceeded under concurrent checkouts.
 */
export async function redeemCoupon(input: {
  evaluation: CouponEvaluation;
  orderNumber: string;
  userId?: string;
  guestEmail?: string;
}) {
  const discount = roundMoney(input.evaluation.itemDiscount + input.evaluation.shippingDiscount);
  const claimed = await Coupon.findOneAndUpdate(
    {
      _id: input.evaluation.couponId,
      active: true,
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
      ],
    },
    { $inc: { usedCount: 1 } },
    { new: true },
  );

  if (!claimed) {
    throw new AppError("This coupon has reached its usage limit", 409);
  }

  try {
    return await CouponRedemption.create({
      code: input.evaluation.code,
      couponId: input.evaluation.couponId,
      discount,
      guestEmail: input.guestEmail?.toLowerCase(),
      orderNumber: input.orderNumber,
      status: "applied",
      userId: input.userId,
    });
  } catch (error) {
    await Coupon.updateOne({ _id: input.evaluation.couponId }, { $inc: { usedCount: -1 } });
    throw error;
  }
}

/** Releases a coupon use when its order is cancelled. Idempotent. */
export async function reverseCouponRedemption(orderNumber: string) {
  const redemption = await CouponRedemption.findOneAndUpdate(
    { orderNumber, status: "applied" },
    { $set: { reversedAt: new Date(), status: "reversed" } },
    { new: true },
  );

  if (!redemption) {
    return false;
  }

  await Coupon.updateOne(
    { _id: redemption.couponId, usedCount: { $gt: 0 } },
    { $inc: { usedCount: -1 } },
  );
  return true;
}

function isLineEligible(coupon: CouponLean, line: CouponLine) {
  const productId = String(line.productId);
  const categoryIds = line.categoryIds.map(String);
  const excludedProducts = (coupon.excludedProductIds ?? []).map(String);
  const excludedCategories = (coupon.excludedCategoryIds ?? []).map(String);

  if (excludedProducts.includes(productId)) {
    return false;
  }

  if (categoryIds.some((id) => excludedCategories.includes(id))) {
    return false;
  }

  const includeProducts = (coupon.applicableProductIds ?? []).map(String);
  const includeCategories = (coupon.applicableCategoryIds ?? []).map(String);

  if (!includeProducts.length && !includeCategories.length) {
    return true;
  }

  return (
    includeProducts.includes(productId) || categoryIds.some((id) => includeCategories.includes(id))
  );
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatInr(value: number) {
  return `Rs. ${Math.ceil(value).toLocaleString("en-IN")}`;
}
