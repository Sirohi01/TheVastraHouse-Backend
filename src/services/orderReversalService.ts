import { Types } from "mongoose";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Refund } from "../models/Refund.js";
import { logger } from "../utils/logger.js";
import { reverseCouponRedemption } from "./couponService.js";
import { restoreGiftCardsForOrder } from "./giftCardService.js";
import { refundRazorpayPayment } from "./paymentService.js";
import { reverseReferralForOrder } from "./referralService.js";
import { restoreRedeemedPoints, reverseEarnedPoints } from "./rewardPointsService.js";
import { restoreStoreCredit } from "./storeCreditService.js";

type ReversibleOrder = {
  _id: unknown;
  orderNumber: string;
  userId?: unknown;
  guestEmail?: string;
  paymentMethod: string;
  paymentSessionId?: unknown;
  financials?: {
    storeCreditRedeemed?: number;
    rewardPointsRedeemed?: number;
    giftCardRedemptions?: Array<{ code: string; amount: number }>;
    reversedAt?: Date;
  };
  totals?: { currencyCode?: string };
};

type Capture = {
  key: string;
  razorpayPaymentId?: string;
  amount: number;
  refundedAmount?: number;
};

/**
 * Undoes every non-cash benefit tied to a cancelled order: coupon use, gift card debits,
 * store credit and points spent, points earned, and any referral reward the order unlocked.
 * The first caller claims `financials.reversedAt`; any retry or concurrent call is a no-op.
 */
export async function reverseOrderFinancials(order: ReversibleOrder, reason: string) {
  const claim = await Order.updateOne(
    { _id: order._id, "financials.reversedAt": { $exists: false } },
    { $set: { "financials.reversedAt": new Date() } },
  );

  if (!claim.modifiedCount) {
    return { skipped: true };
  }

  const userId = order.userId ? String(order.userId) : undefined;
  const financials = order.financials ?? {};
  const summary = {
    couponReleased: await reverseCouponRedemption(order.orderNumber),
    giftCardsRestored: await restoreGiftCardsForOrder({
      orderNumber: order.orderNumber,
      redemptions: financials.giftCardRedemptions ?? [],
    }),
    pointsEarnedReversed: userId
      ? await reverseEarnedPoints({ orderNumber: order.orderNumber, reason, userId })
      : 0,
    pointsRestored:
      userId && financials.rewardPointsRedeemed
        ? await restoreRedeemedPoints({
            orderNumber: order.orderNumber,
            points: financials.rewardPointsRedeemed,
            userId,
          })
        : 0,
    referralReversed: await reverseReferralForOrder(order.orderNumber, reason),
    storeCreditRestored:
      userId && financials.storeCreditRedeemed
        ? await restoreStoreCredit({
            amount: financials.storeCreditRedeemed,
            orderNumber: order.orderNumber,
            userId,
          })
        : 0,
  };

  await Order.updateOne({ _id: order._id }, { $set: { "financials.reversalSummary": summary } });
  return { skipped: false, summary };
}

/**
 * Refunds the cash actually collected for a cancelled order. Razorpay captures (full payment,
 * COD advance, later balance payments) are refunded per payment id through the gateway; money
 * collected offline becomes a pending bank-transfer refund for the finance team. The unique
 * (orderId, source=cancellation) index makes this safe to retry.
 */
export async function refundCancelledOrder(order: ReversibleOrder, actorId?: string) {
  if (!order.paymentSessionId) {
    return null;
  }

  const session = await PaymentSession.findById(order.paymentSessionId);

  if (!session) {
    return null;
  }

  const refundable = Math.max(0, (session.paidAmount ?? 0) - (session.refundedAmount ?? 0));

  if (refundable <= 0) {
    return null;
  }

  const existing = await Refund.findOne({ orderId: order._id, source: "cancellation" });

  if (existing) {
    return existing;
  }

  const captures = ((session.get("captures") ?? []) as Capture[]).map((capture) => ({
    ...(typeof (capture as { toObject?: () => Capture }).toObject === "function"
      ? (capture as unknown as { toObject: () => Capture }).toObject()
      : capture),
  }));
  const gatewayCaptures = captures.filter((capture) => capture.razorpayPaymentId);
  const method = gatewayCaptures.length ? "original_payment" : "bank_transfer";

  let refund;
  try {
    refund = await Refund.create({
      amount: refundable,
      currencyCode: order.totals?.currencyCode ?? "INR",
      guestEmail: order.guestEmail,
      method,
      orderId: order._id,
      orderNumber: order.orderNumber,
      paymentSessionId: session._id,
      processedBy: actorId && Types.ObjectId.isValid(actorId) ? actorId : undefined,
      source: "cancellation",
      status: "pending",
      userId: order.userId,
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      return Refund.findOne({ orderId: order._id, source: "cancellation" });
    }
    throw error;
  }

  if (method === "bank_transfer") {
    await recordRefundHistory(session, refundable, "cancellation_refund_pending_bank_transfer");
    return refund;
  }

  let outstanding = refundable;
  const gatewayRefundIds: string[] = [];
  const failures: string[] = [];
  let processedNow = 0;

  for (const capture of gatewayCaptures) {
    const available = capture.amount - (capture.refundedAmount ?? 0);
    const amount = Math.min(available, outstanding);

    if (amount <= 0) {
      continue;
    }

    try {
      const gatewayRefund = await refundRazorpayPayment({
        amount,
        paymentId: capture.razorpayPaymentId!,
        returnNumber: `${order.orderNumber}-CANCEL`,
      });
      gatewayRefundIds.push(gatewayRefund.id);
      capture.refundedAmount = (capture.refundedAmount ?? 0) + amount;
      outstanding -= amount;
      if (gatewayRefund.status === "processed") {
        processedNow += amount;
      }
    } catch (error) {
      logger.error({ error, orderNumber: order.orderNumber }, "Cancellation refund failed");
      failures.push(error instanceof Error ? error.message : "Gateway refund failed");
    }
  }

  const refundedNow = refundable - outstanding;
  session.set("captures", captures);
  session.refundedAmount = (session.refundedAmount ?? 0) + refundedNow;
  await session.save();

  refund.gatewayRefundId = gatewayRefundIds[0];
  refund.gatewayRefundIds = gatewayRefundIds;
  refund.status =
    failures.length && !gatewayRefundIds.length
      ? "pending"
      : processedNow >= refundable
        ? "processed"
        : "pending";
  refund.processedAt = refund.status === "processed" ? new Date() : undefined;
  refund.metadata = {
    ...(refund.metadata ?? {}),
    failures,
    processedGatewayRefundIds: processedNow >= refundable ? gatewayRefundIds : [],
    refundedViaGateway: refundedNow,
  };
  await refund.save();
  await recordRefundHistory(session, refundedNow, "cancellation_refund_initiated", {
    failures,
    gatewayRefundIds,
  });

  return refund;
}

async function recordRefundHistory(
  session: { _id: unknown; method: string; orderReference: string; currencyCode: string },
  amount: number,
  event: string,
  metadata: Record<string, unknown> = {},
) {
  await PaymentHistory.create({
    actorType: "system",
    amount,
    currencyCode: session.currencyCode,
    event,
    metadata,
    method: session.method,
    orderReference: session.orderReference,
    paymentSessionId: session._id,
  });
}
