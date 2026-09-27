import { env } from "../config/env.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

/**
 * Phase 32 — Fraud & Risk. Deliberately conservative: signals only flag an order for the
 * Order Manager's review queue ("log, don't block" per docs/12-architect-review.md). No device
 * fingerprinting or third-party profiling is performed.
 */
export type RiskAssessment = {
  score: number;
  flags: string[];
  status: "clear" | "flagged";
};

export async function assessOrderRisk(input: {
  userId?: string;
  guestEmail?: string;
  phone?: string;
  ipAddress?: string;
  paymentMethod: string;
  grandTotal: number;
}): Promise<RiskAssessment> {
  const flags: string[] = [];
  let score = 0;
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const identity = input.userId
    ? { userId: input.userId }
    : input.guestEmail
      ? { guestEmail: input.guestEmail.toLowerCase() }
      : undefined;
  const [maxFailedPayments, maxOrders, highValueCod] = await Promise.all([
    getRuntimeNumberSetting(
      "FRAUD_MAX_FAILED_PAYMENTS_PER_HOUR",
      env.FRAUD_MAX_FAILED_PAYMENTS_PER_HOUR,
    ),
    getRuntimeNumberSetting("FRAUD_MAX_ORDERS_PER_HOUR", env.FRAUD_MAX_ORDERS_PER_HOUR),
    getRuntimeNumberSetting("FRAUD_HIGH_VALUE_COD_THRESHOLD", env.FRAUD_HIGH_VALUE_COD_THRESHOLD),
  ]);

  if (identity) {
    const recentOrders = await Order.countDocuments({ ...identity, createdAt: { $gte: since } });

    if (recentOrders >= maxOrders) {
      flags.push(`order_velocity:${recentOrders}_orders_last_hour`);
      score += 40;
    }

    const sessionIds = await PaymentSession.find({ ...identity, createdAt: { $gte: since } }).distinct("_id");
    const failedPayments = sessionIds.length
      ? await PaymentHistory.countDocuments({
          createdAt: { $gte: since },
          event: "razorpay_payment_failed",
          paymentSessionId: { $in: sessionIds },
        })
      : 0;

    if (failedPayments >= maxFailedPayments) {
      flags.push(`failed_payment_velocity:${failedPayments}_last_hour`);
      score += 40;
    }

    const cancelledRecently = await Order.countDocuments({
      ...identity,
      createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
      status: "cancelled",
    });

    if (cancelledRecently >= 3) {
      flags.push(`repeat_cancellations:${cancelledRecently}_last_7_days`);
      score += 20;
    }
  }

  if (input.paymentMethod === "cod" && input.grandTotal >= highValueCod) {
    flags.push("high_value_cod");
    score += 30;
  }

  if (input.phone) {
    const distinctAccounts = await Order.distinct("userId", {
      createdAt: { $gte: new Date(Date.now() - 24 * 3_600_000) },
      "shippingAddress.phone": input.phone,
      userId: { $exists: true },
    });

    if (distinctAccounts.length >= 3) {
      flags.push(`shared_phone_accounts:${distinctAccounts.length}`);
      score += 30;
    }
  }

  return { flags, score: Math.min(score, 100), status: score >= 40 ? "flagged" : "clear" };
}
