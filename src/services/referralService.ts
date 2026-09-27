import { randomBytes } from "node:crypto";
import { AppError } from "../middleware/errorHandler.js";
import { Referral } from "../models/Referral.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { issueStoreCredit, reverseStoreCredit } from "./storeCreditService.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existing = (await User.findById(userId).select("referralCode").lean()) as {
    referralCode?: string;
  } | null;

  if (existing?.referralCode) {
    return existing.referralCode;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReferralCode();

    try {
      await User.updateOne({ _id: userId }, { $set: { referralCode: code } });
      return code;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  throw new AppError("Could not generate a unique referral code", 500);
}

export async function attributeReferral(code: string, referredUserId: string) {
  const normalizedCode = code.trim().toUpperCase();
  const referrer = (await User.findOne({ referralCode: normalizedCode }).select("_id").lean()) as {
    _id: unknown;
  } | null;

  if (!referrer || String(referrer._id) === referredUserId) {
    return null;
  }

  try {
    return await Referral.create({
      code: normalizedCode,
      referredUserId,
      referrerUserId: referrer._id,
      status: "pending",
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return null;
    }

    throw error;
  }
}

export async function qualifyReferral(order: { userId?: unknown; orderNumber: string }) {
  if (!order.userId) {
    return null;
  }

  // Claim the referral atomically so concurrent confirmations cannot pay the reward twice.
  const referral = await Referral.findOneAndUpdate(
    { referredUserId: order.userId, status: "pending" },
    { $set: { status: "qualified", qualifyingOrderNumber: order.orderNumber } },
    { new: true },
  );

  if (!referral) {
    return null;
  }

  const rewardAmount = await getRuntimeNumberSetting(
    "REFERRAL_REWARD_AMOUNT",
    env.REFERRAL_REWARD_AMOUNT,
  );

  if (rewardAmount > 0) {
    await issueStoreCredit({
      amount: rewardAmount,
      notes: `Referral reward for referring ${String(order.userId)}`,
      orderNumber: order.orderNumber,
      sourceType: "referral",
      userId: String(referral.referrerUserId),
    });
  }

  referral.status = "rewarded";
  referral.rewardAmount = rewardAmount;
  referral.rewardIssuedAt = new Date();
  await referral.save();

  return referral;
}

/** Reverses a referral reward when the qualifying order is cancelled/refunded. Idempotent. */
export async function reverseReferralForOrder(orderNumber: string, reason: string) {
  const referral = await Referral.findOneAndUpdate(
    { qualifyingOrderNumber: orderNumber, status: "rewarded" },
    { $set: { reversalReason: reason, reversedAt: new Date(), status: "reversed" } },
    { new: true },
  );

  if (!referral) {
    return 0;
  }

  return reverseStoreCredit({
    amount: referral.rewardAmount ?? 0,
    notes: `Referral reward reversed: ${reason}`,
    orderNumber,
    userId: String(referral.referrerUserId),
  });
}

function generateReferralCode() {
  return randomBytes(4).toString("hex").toUpperCase();
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: number }).code === 11000);
}
