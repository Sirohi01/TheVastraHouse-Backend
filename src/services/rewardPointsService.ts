import { AppError } from "../middleware/errorHandler.js";
import { User } from "../models/User.js";
import { RewardPointsLedger } from "../models/RewardPointsLedger.js";
import { env } from "../config/env.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

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

  const user = (await User.findByIdAndUpdate(
    String(order.userId),
    { $inc: { lifetimeOrderValue: order.totals.grandTotal, rewardPointsBalance: points } },
    { new: true },
  ).select("rewardPointsBalance")) as { rewardPointsBalance: number } | null;

  if (!user || points <= 0) {
    return null;
  }

  await RewardPointsLedger.create({
    balanceAfter: user.rewardPointsBalance,
    orderNumber: order.orderNumber,
    points,
    reason: "Order confirmed",
    type: "earn",
    userId: order.userId,
  });

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
