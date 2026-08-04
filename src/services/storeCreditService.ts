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
