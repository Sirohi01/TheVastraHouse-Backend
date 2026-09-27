import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { User } from "../models/User.js";
import {
  StoreCreditTransaction,
  type storeCreditSourceTypes,
} from "../models/StoreCreditTransaction.js";

type StoreCreditSourceType = (typeof storeCreditSourceTypes)[number];

export async function getStoreCreditBalance(userId: string): Promise<number> {
  const user = (await User.findById(userId).select("storeCreditBalance").lean()) as {
    storeCreditBalance?: number;
  } | null;

  return user?.storeCreditBalance ?? 0;
}

export async function issueStoreCredit(input: {
  userId: string;
  amount: number;
  currencyCode?: string;
  sourceType: StoreCreditSourceType;
  sourceId?: string;
  orderNumber?: string;
  notes?: string;
}): Promise<number> {
  if (input.amount <= 0) {
    throw new AppError("Store credit issuance amount must be positive", 400);
  }

  const user = (await User.findByIdAndUpdate(
    input.userId,
    { $inc: { storeCreditBalance: input.amount } },
    { new: true },
  ).select("storeCreditBalance")) as { storeCreditBalance: number } | null;

  if (!user) {
    throw new AppError("User not found", 404);
  }

  await StoreCreditTransaction.create({
    amount: input.amount,
    balanceAfter: user.storeCreditBalance,
    currencyCode: input.currencyCode ?? "INR",
    notes: input.notes,
    orderNumber: input.orderNumber,
    sourceId: input.sourceId ? new Types.ObjectId(input.sourceId) : undefined,
    sourceType: input.sourceType,
    type: "issue",
    userId: input.userId,
  });

  return user.storeCreditBalance;
}

export async function redeemStoreCredit(input: {
  userId: string;
  amount: number;
  orderNumber: string;
}): Promise<number> {
  if (input.amount <= 0) {
    return getStoreCreditBalance(input.userId);
  }

  const user = (await User.findOneAndUpdate(
    { _id: input.userId, storeCreditBalance: { $gte: input.amount } },
    { $inc: { storeCreditBalance: -input.amount } },
    { new: true },
  ).select("storeCreditBalance")) as { storeCreditBalance: number } | null;

  if (!user) {
    throw new AppError("Store credit balance is insufficient", 400);
  }

  await StoreCreditTransaction.create({
    amount: -input.amount,
    balanceAfter: user.storeCreditBalance,
    orderNumber: input.orderNumber,
    sourceType: "order",
    type: "redeem",
    userId: input.userId,
  });

  return user.storeCreditBalance;
}

/** Returns store credit spent on a cancelled order. Idempotent per order. */
export async function restoreStoreCredit(input: {
  userId: string;
  amount: number;
  orderNumber: string;
}) {
  if (input.amount <= 0) {
    return 0;
  }

  const existing = await StoreCreditTransaction.findOne({
    orderNumber: input.orderNumber,
    type: "restore",
    userId: input.userId,
  }).lean();

  if (existing) {
    return 0;
  }

  const user = (await User.findByIdAndUpdate(
    input.userId,
    { $inc: { storeCreditBalance: input.amount } },
    { new: true },
  ).select("storeCreditBalance")) as { storeCreditBalance: number } | null;

  if (!user) {
    return 0;
  }

  await StoreCreditTransaction.create({
    amount: input.amount,
    balanceAfter: user.storeCreditBalance,
    notes: "Order cancelled: store credit restored",
    orderNumber: input.orderNumber,
    sourceType: "cancellation",
    type: "restore",
    userId: input.userId,
  });

  return input.amount;
}

/**
 * Claws back previously issued credit (e.g. a referral reward whose qualifying order was
 * cancelled). Never drives the balance negative; returns the amount actually reversed.
 */
export async function reverseStoreCredit(input: {
  userId: string;
  amount: number;
  orderNumber: string;
  notes: string;
}) {
  const balance = await getStoreCreditBalance(input.userId);
  const reversible = Math.min(balance, Math.max(0, input.amount));

  if (reversible <= 0) {
    return 0;
  }

  const user = (await User.findOneAndUpdate(
    { _id: input.userId, storeCreditBalance: { $gte: reversible } },
    { $inc: { storeCreditBalance: -reversible } },
    { new: true },
  ).select("storeCreditBalance")) as { storeCreditBalance: number } | null;

  if (!user) {
    return 0;
  }

  await StoreCreditTransaction.create({
    amount: -reversible,
    balanceAfter: user.storeCreditBalance,
    notes: input.notes,
    orderNumber: input.orderNumber,
    sourceType: "referral",
    type: "reversal",
    userId: input.userId,
  });

  return reversible;
}

export async function listStoreCreditHistory(userId: string, limit = 50) {
  return StoreCreditTransaction.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}
