import { AppError } from "../middleware/errorHandler.js";
import { User } from "../models/User.js";
import { RewardPointsLedger } from "../models/RewardPointsLedger.js";
import { env } from "../config/env.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

type LedgerBucket = {
  _id: unknown;
  remaining?: number;
};

export async function getRewardPointsBalance(userId: string): Promise<number> {
  const user = (await User.findById(userId).select("rewardPointsBalance").lean()) as {
    rewardPointsBalance?: number;
  } | null;

  return user?.rewardPointsBalance ?? 0;
}

export async function pointsToValue(points: number): Promise<number> {
  const redemptionValue = await getRuntimeNumberSetting(
    "REWARD_POINTS_REDEMPTION_VALUE",
    env.REWARD_POINTS_REDEMPTION_VALUE,
  );

  return Math.round(points * redemptionValue * 100) / 100;
}

export async function valueToPoints(value: number): Promise<number> {
  const redemptionValue = await getRuntimeNumberSetting(
    "REWARD_POINTS_REDEMPTION_VALUE",
    env.REWARD_POINTS_REDEMPTION_VALUE,
  );

  if (redemptionValue <= 0) {
    return 0;
  }

  return Math.floor(value / redemptionValue);
}

async function expiryDate(from = new Date()) {
  const days = await getRuntimeNumberSetting(
    "REWARD_POINTS_EXPIRY_DAYS",
    env.REWARD_POINTS_EXPIRY_DAYS,
  );

  return days > 0 ? new Date(from.getTime() + days * 86_400_000) : undefined;
}

/**
 * Credits purchase points once per order. The unique (userId, orderNumber, type) ledger index
 * makes a repeated confirmation a no-op instead of a second credit.
 */
export async function earnPointsForOrder(order: {
  userId?: unknown;
  orderNumber: string;
  totals: { grandTotal: number };
}) {
  if (!order.userId) {
    return null;
  }

  const earnRate = await getRuntimeNumberSetting(
    "REWARD_POINTS_EARN_RATE",
    env.REWARD_POINTS_EARN_RATE,
  );
  const points = Math.floor((order.totals.grandTotal / 100) * earnRate);

  if (points <= 0) {
    await User.updateOne(
      { _id: String(order.userId) },
      { $inc: { lifetimeOrderValue: order.totals.grandTotal } },
    );
    return null;
  }

  const existing = await RewardPointsLedger.findOne({
    orderNumber: order.orderNumber,
    type: "earn",
    userId: order.userId,
  }).lean();

  if (existing) {
    return 0;
  }

  const user = (await User.findByIdAndUpdate(
    String(order.userId),
    { $inc: { lifetimeOrderValue: order.totals.grandTotal, rewardPointsBalance: points } },
    { new: true },
  ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

  if (!user) {
    return null;
  }

  try {
    await RewardPointsLedger.create({
      balanceAfter: user.rewardPointsBalance,
      expiresAt: await expiryDate(),
      orderNumber: order.orderNumber,
      points,
      reason: "Order confirmed",
      remaining: points,
      type: "earn",
      userId: order.userId,
    });
  } catch (error) {
    // Lost a race with a concurrent confirmation: undo our balance increment.
    await User.updateOne(
      { _id: String(order.userId) },
      { $inc: { lifetimeOrderValue: -order.totals.grandTotal, rewardPointsBalance: -points } },
    );
    if ((error as { code?: number }).code === 11000) {
      return 0;
    }
    throw error;
  }

  return points;
}

export async function redeemPointsByValue(input: {
  userId: string;
  requestedValue: number;
  orderNumber: string;
}): Promise<{ pointsRedeemed: number; valueApplied: number }> {
  if (input.requestedValue <= 0) {
    return { pointsRedeemed: 0, valueApplied: 0 };
  }

  const requestedPoints = await valueToPoints(input.requestedValue);

  if (requestedPoints <= 0) {
    return { pointsRedeemed: 0, valueApplied: 0 };
  }

  const user = (await User.findOneAndUpdate(
    { _id: input.userId, rewardPointsBalance: { $gte: requestedPoints } },
    { $inc: { rewardPointsBalance: -requestedPoints } },
    { new: true },
  ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

  if (!user) {
    throw new AppError("Reward points balance is insufficient", 400);
  }

  await consumeBuckets(input.userId, requestedPoints);
  const valueApplied = await pointsToValue(requestedPoints);

  await RewardPointsLedger.create({
    balanceAfter: user.rewardPointsBalance,
    orderNumber: input.orderNumber,
    points: -requestedPoints,
    reason: "Checkout redemption",
    type: "redeem",
    userId: input.userId,
  });

  return { pointsRedeemed: requestedPoints, valueApplied };
}

/** Returns points redeemed on a cancelled order. Idempotent per order. */
export async function restoreRedeemedPoints(input: {
  userId: string;
  points: number;
  orderNumber: string;
}) {
  if (input.points <= 0) {
    return 0;
  }

  const existing = await RewardPointsLedger.findOne({
    orderNumber: input.orderNumber,
    type: "restore",
    userId: input.userId,
  }).lean();

  if (existing) {
    return 0;
  }

  const user = (await User.findByIdAndUpdate(
    input.userId,
    { $inc: { rewardPointsBalance: input.points } },
    { new: true },
  ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

  if (!user) {
    return 0;
  }

  await RewardPointsLedger.create({
    balanceAfter: user.rewardPointsBalance,
    expiresAt: await expiryDate(),
    orderNumber: input.orderNumber,
    points: input.points,
    reason: "Order cancelled: redeemed points restored",
    remaining: input.points,
    type: "restore",
    userId: input.userId,
  });

  return input.points;
}

/**
 * Takes back points earned on an order that was cancelled or refunded. Points already spent
 * cannot be clawed back below zero; the shortfall is recorded on the ledger entry.
 */
export async function reverseEarnedPoints(input: {
  userId: string;
  orderNumber: string;
  reason: string;
}) {
  const earned = (await RewardPointsLedger.findOne({
    orderNumber: input.orderNumber,
    type: "earn",
    userId: input.userId,
  }).lean()) as { points: number; remaining?: number; _id: unknown } | null;

  if (!earned) {
    return 0;
  }

  const alreadyReversed = await RewardPointsLedger.findOne({
    orderNumber: input.orderNumber,
    type: "reversal",
    userId: input.userId,
  }).lean();

  if (alreadyReversed) {
    return 0;
  }

  const balance = await getRewardPointsBalance(input.userId);
  const reversible = Math.min(earned.points, balance);
  const user = (await User.findOneAndUpdate(
    { _id: input.userId, rewardPointsBalance: { $gte: reversible } },
    { $inc: { rewardPointsBalance: -reversible } },
    { new: true },
  ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

  if (!user) {
    return 0;
  }

  await RewardPointsLedger.updateOne(
    { _id: earned._id },
    { $set: { remaining: Math.max(0, (earned.remaining ?? earned.points) - reversible) } },
  );
  await RewardPointsLedger.create({
    balanceAfter: user.rewardPointsBalance,
    orderNumber: input.orderNumber,
    points: -reversible,
    reason:
      reversible < earned.points
        ? `${input.reason} (shortfall ${earned.points - reversible} points already spent)`
        : input.reason,
    type: "reversal",
    userId: input.userId,
  });

  return reversible;
}

/** Expires unspent points whose bucket has passed its expiry date. */
export async function expireRewardPoints(now = new Date()) {
  const buckets = (await RewardPointsLedger.find({
    expiredAt: { $exists: false },
    expiresAt: { $lte: now },
    remaining: { $gt: 0 },
  })
    .limit(500)
    .lean()) as unknown as Array<LedgerBucket & { userId: unknown; remaining: number }>;
  let expired = 0;

  for (const bucket of buckets) {
    const claimed = await RewardPointsLedger.findOneAndUpdate(
      { _id: bucket._id, expiredAt: { $exists: false }, remaining: bucket.remaining },
      { $set: { expiredAt: now, remaining: 0 } },
    );

    if (!claimed) {
      continue;
    }

    const balance = await getRewardPointsBalance(String(bucket.userId));
    const points = Math.min(bucket.remaining, balance);

    if (points <= 0) {
      continue;
    }

    const user = (await User.findByIdAndUpdate(
      String(bucket.userId),
      { $inc: { rewardPointsBalance: -points } },
      { new: true },
    ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

    await RewardPointsLedger.create({
      balanceAfter: Math.max(0, user?.rewardPointsBalance ?? 0),
      points: -points,
      reason: "Points expired",
      type: "expire",
      userId: bucket.userId,
    });
    expired += points;
  }

  return { expired };
}

export async function listRewardPointsHistory(userId: string, limit = 50) {
  return RewardPointsLedger.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

async function consumeBuckets(userId: string, points: number) {
  let outstanding = points;
  const buckets = (await RewardPointsLedger.find({
    expiredAt: { $exists: false },
    remaining: { $gt: 0 },
    userId,
  })
    .sort({ expiresAt: 1, createdAt: 1 })
    .lean()) as unknown as Array<LedgerBucket & { remaining: number }>;

  for (const bucket of buckets) {
    if (outstanding <= 0) {
      break;
    }

    const used = Math.min(bucket.remaining, outstanding);
    await RewardPointsLedger.updateOne({ _id: bucket._id }, { $inc: { remaining: -used } });
    outstanding -= used;
  }
}
