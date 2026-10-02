import crypto from "node:crypto";
import Razorpay from "razorpay";
import { Types, type HydratedDocument } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { Refund } from "../models/Refund.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { writeAuditLog } from "./auditLogService.js";
import { finalizeOrderAfterPayment } from "./orderFulfillmentService.js";
import { fulfillGiftCardPurchase } from "./giftCardService.js";
import { transitionOrderDocument } from "./orderLifecycleService.js";
import { getPaymentSettings } from "./paymentSettingsService.js";
import {
  getRuntimeBooleanSetting,
  getRuntimeNumberSetting,
  getRuntimeSetting,
} from "./runtimeSettingsService.js";

export type CreatePaymentInput = {
  userId?: string;
  guestEmail?: string;
  guestSessionId?: string;
  orderReference: string;
  amount: number;
  payableNow?: number;
  currencyCode?: string;
  paymentMode?: "full" | "advance" | "balance";
};

export type ManualPaymentInput = CreatePaymentInput & {
  manualScreenshot: {
    url: string;
    type: "image";
    aspectRatio?: string;
    altText?: string;
  };
};

export type UpiPaymentInput = CreatePaymentInput & {
  upiReference?: string;
};

type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status?: string;
};

type RazorpayRefund = {
  id: string;
  amount: number;
  currency?: string;
  payment_id: string;
  status?: string;
};

type PaymentSessionDoc = HydratedDocument<{
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  guestEmail?: string;
  guestSessionId?: string;
  orderReference: string;
  method: "razorpay" | "cod" | "manual_bank_transfer" | "upi" | "credit_terms";
  status:
    | "pending_payment"
    | "payment_verification_pending"
    | "payment_rejected"
    | "confirmed"
    | "cod_confirmed"
    | "upi_pending"
    | "partially_paid"
    | "failed";
  amount: number;
  payableNow: number;
  paidAmount: number;
  outstandingAmount: number;
  refundedAmount?: number;
  currencyCode: string;
  paymentMode: "full" | "advance" | "balance";
  razorpayOrderId?: string;
  razorpayOrderIds?: string[];
  capturedPaymentIds?: string[];
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  upiId?: string;
  upiReference?: string;
  codManualReviewRequired?: boolean;
  rejectionReason?: string;
  verifiedBy?: Types.ObjectId;
  verifiedAt?: Date;
}>;

export async function createRazorpayPayment(input: CreatePaymentInput) {
  const amounts = normalizeAmounts(input.amount, input.payableNow);
  const session = await PaymentSession.create({
    userId: input.userId,
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
    orderReference: input.orderReference,
    method: "razorpay",
    status: "pending_payment",
    amount: amounts.amount,
    payableNow: amounts.payableNow,
    paidAmount: 0,
    outstandingAmount: amounts.amount,
    currencyCode: input.currencyCode ?? "INR",
    paymentMode: input.paymentMode ?? (amounts.payableNow < amounts.amount ? "advance" : "full"),
  });
  const gatewayOrder = await createRazorpayGatewayOrder({
    amount: amounts.payableNow,
    currencyCode: session.currencyCode,
    receipt: input.orderReference,
  });

  session.razorpayOrderId = gatewayOrder.id;
  rememberGatewayOrder(session, gatewayOrder.id);
  await session.save();
  await recordPaymentHistory(session, "razorpay_order_created", "system", {
    gatewayOrder,
  });

  return { gatewayOrder, session };
}

export async function refundRazorpayPayment(input: {
  amount: number;
  paymentId: string;
  returnNumber: string;
}): Promise<RazorpayRefund> {
  if (!input.paymentId || input.amount <= 0) {
    throw new AppError("Razorpay refund details are invalid", 400);
  }

  const razorpay = await getRazorpayClient();

  if (!razorpay) {
    if (env.NODE_ENV === "production" && !isTestRuntime()) {
      throw new AppError("Razorpay gateway is not configured; refund cannot be issued", 503);
    }

    return {
      amount: Math.round(input.amount * 100),
      id: `rfnd_dev_${crypto.randomUUID()}`,
      payment_id: input.paymentId,
      status: "processed",
    };
  }

  return (await razorpay.payments.refund(input.paymentId, {
    amount: Math.round(input.amount * 100),
    notes: { returnNumber: input.returnNumber },
    speed: "normal",
  })) as RazorpayRefund;
}

/**
 * Creates a fresh Razorpay gateway order for the outstanding balance of an
 * already-placed (typically pre-order advance) order, reusing the order's
 * existing PaymentSession so paidAmount/outstandingAmount stay accurate.
 * Confirmation goes through the same verifyRazorpayPayment/webhook path as
 * the original payment.
 */
export async function createBalancePaymentForOrder(input: {
  orderNumber: string;
  userId?: string;
  guestEmail?: string;
  guestSessionId?: string;
}) {
  const order = await Order.findOne({
    orderNumber: input.orderNumber,
    ...(input.userId
      ? { userId: input.userId }
      : input.guestSessionId
        ? { guestSessionId: input.guestSessionId }
        : {}),
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (!input.userId && !input.guestSessionId) {
    const normalizedEmail = input.guestEmail?.trim().toLowerCase();
    if (!normalizedEmail || order.guestEmail !== normalizedEmail) {
      throw new AppError("Order not found", 404);
    }
  }

  if (["cancelled", "refunded", "returned"].includes(order.status)) {
    throw new AppError("This order is closed and cannot accept payments", 409);
  }

  if (!order.paymentSessionId) {
    throw new AppError("Order has no associated payment session", 409);
  }

  const session = await PaymentSession.findById(order.paymentSessionId);

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  const isCreditTerms = session.method === "credit_terms";

  if (session.paidAmount === 0 && order.status !== "pending_payment" && !isCreditTerms) {
    throw new AppError("The initial payment window for this order is closed", 409);
  }

  if (session.method !== "razorpay" && !isCreditTerms) {
    throw new AppError(
      "Online payment is only supported for Razorpay and wholesale credit orders",
      409,
    );
  }

  if (session.outstandingAmount <= 0) {
    throw new AppError("This order has no outstanding balance", 409);
  }

  const isInitialRetry = session.paidAmount === 0 && !isCreditTerms;
  const amountToCollect = isInitialRetry ? session.payableNow : session.outstandingAmount;
  const gatewayOrder = await createRazorpayGatewayOrder({
    amount: amountToCollect,
    currencyCode: session.currencyCode,
    receipt: `${order.orderNumber}-BAL`,
  });

  session.payableNow = amountToCollect;
  if (!isInitialRetry) {
    session.paymentMode = "balance";
  }
  session.razorpayOrderId = gatewayOrder.id;
  rememberGatewayOrder(session, gatewayOrder.id);
  await session.save();
  await recordPaymentHistory(
    session,
    isInitialRetry ? "razorpay_payment_retried" : "razorpay_balance_order_created",
    "customer",
    {
      gatewayOrder,
    },
  );

  return { gatewayOrder, order, session };
}

export async function verifyRazorpayPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  actorId?: string;
}) {
  const session = await findSessionByGatewayOrder(input.razorpayOrderId);

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  await assertRazorpayPaymentSignature(input);
  const applied = await captureOnce(session, session.payableNow, {
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
  });

  if (!applied) {
    // Replayed confirmation, or the webhook already credited this payment: never double count.
    return session;
  }

  await recordPaymentHistory(
    session,
    "razorpay_payment_verified",
    input.actorId ? "customer" : "system",
    {
      gatewayTransactionId: input.razorpayPaymentId,
    },
  );
  await finalizeOrderAfterPayment({
    actor: { actorId: input.actorId, actorType: input.actorId ? "customer" : "system" },
    outstandingAmount: session.outstandingAmount,
    payableNow: session.payableNow,
    paymentSessionId: session._id,
    paymentSessionStatus: session.status,
  });
  await fulfillGiftCardPurchase(session);

  return session;
}

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string | undefined) {
  const payloadText = rawBody.toString("utf8");

  if (!signature || !(await verifyRazorpayWebhookSignature(payloadText, signature))) {
    await PaymentWebhookEvent.create({
      eventId: `invalid-${crypto.randomUUID()}`,
      eventType: "invalid_signature",
      provider: "razorpay",
      signatureVerified: false,
      payload: safeJson(payloadText),
      error: "Invalid Razorpay webhook signature",
    });
    throw new AppError("Invalid webhook signature", 401);
  }

  const payload = JSON.parse(payloadText) as {
    event: string;
    id?: string;
    payload?: {
      payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string } };
      order?: { entity?: { id?: string } };
      refund?: { entity?: { id?: string; payment_id?: string; amount?: number; status?: string } };
    };
  };
  const eventId = payload.id ?? payload.payload?.payment?.entity?.id ?? crypto.randomUUID();
  const existing = await PaymentWebhookEvent.findOne({ provider: "razorpay", eventId });

  if (existing?.processedAt) {
    return { duplicate: true, event: existing };
  }

  const event =
    existing ??
    (await PaymentWebhookEvent.create({
      eventId,
      eventType: payload.event,
      provider: "razorpay",
      signatureVerified: true,
      payload,
    }));
  const payment = payload.payload?.payment?.entity;

  if (payload.event === "payment.captured" && payment?.order_id && payment.id) {
    const session = await findSessionByGatewayOrder(payment.order_id);

    if (session) {
      event.paymentSessionId = session._id;
      const applied = await captureOnce(
        session,
        (payment.amount ?? session.payableNow * 100) / 100,
        { razorpayPaymentId: payment.id },
      );

      if (applied) {
        await recordPaymentHistory(session, "razorpay_webhook_captured", "system", {
          gatewayTransactionId: payment.id,
          webhookEventId: eventId,
        });
        await finalizeOrderAfterPayment({
          actor: { actorType: "system" },
          outstandingAmount: session.outstandingAmount,
          payableNow: session.payableNow,
          paymentSessionId: session._id,
          paymentSessionStatus: session.status,
        });
        await fulfillGiftCardPurchase(session);
      }
    }
  }

  if (payload.event === "payment.failed" && payment?.order_id) {
    const session = await findSessionByGatewayOrder(payment.order_id);

    if (session) {
      event.paymentSessionId = session._id;
      await recordPaymentHistory(session, "razorpay_payment_failed", "system", {
        gatewayTransactionId: payment.id,
        webhookEventId: eventId,
      });
    }
  }

  const gatewayRefund = payload.payload?.refund?.entity;
  if (
    (payload.event === "refund.processed" || payload.event === "refund.failed") &&
    gatewayRefund?.id
  ) {
    const refund = await Refund.findOne({
      $or: [{ gatewayRefundId: gatewayRefund.id }, { gatewayRefundIds: gatewayRefund.id }],
    });
    if (refund && refund.status !== "processed") {
      const metadata = (refund.metadata ?? {}) as { processedGatewayRefundIds?: string[] };
      const processedIds = new Set(metadata.processedGatewayRefundIds ?? []);
      if (payload.event === "refund.processed") {
        processedIds.add(gatewayRefund.id);
      }
      const allIds = refund.gatewayRefundIds?.length
        ? (refund.gatewayRefundIds as string[])
        : [gatewayRefund.id];
      const allProcessed = allIds.every((id) => processedIds.has(id));
      refund.status =
        payload.event === "refund.failed" ? "rejected" : allProcessed ? "processed" : "pending";
      refund.processedAt = refund.status === "processed" ? new Date() : undefined;
      refund.metadata = {
        ...metadata,
        gatewayStatus: gatewayRefund.status,
        processedGatewayRefundIds: [...processedIds],
      };
      await refund.save();
      const returnRequest = refund.returnRequestId
        ? await ReturnRequest.findById(refund.returnRequestId)
        : null;
      if (returnRequest && refund.status === "processed") {
        returnRequest.status = "refunded";
        await returnRequest.save();
        const order = await Order.findById(refund.orderId);
        if (order?.status === "returned") {
          await transitionRefundedOrder(order);
        }
      }
    }
  }

  event.processedAt = new Date();
  await event.save();

  return { duplicate: false, event };
}

async function transitionRefundedOrder(order: Awaited<ReturnType<typeof Order.findById>>) {
  if (!order) return;
  await transitionOrderDocument(order as unknown as Parameters<typeof transitionOrderDocument>[0], {
    actor: { actorType: "system" },
    note: "Razorpay refund processed",
    toStatus: "refunded",
  });
}

/** Wholesale net-terms order: goods ship on credit; the balance is due by `dueAt`. */
export async function createCreditTermsPayment(input: CreatePaymentInput & { dueAt: Date }) {
  const amounts = normalizeAmounts(input.amount, input.amount);
  const session = await PaymentSession.create({
    amount: amounts.amount,
    currencyCode: input.currencyCode ?? "INR",
    dueAt: input.dueAt,
    guestEmail: input.guestEmail,
    method: "credit_terms",
    orderReference: input.orderReference,
    outstandingAmount: amounts.amount,
    paidAmount: 0,
    payableNow: amounts.amount,
    paymentMode: "balance",
    status: "pending_payment",
    userId: input.userId,
  });

  await recordPaymentHistory(session, "credit_terms_issued", "system", { dueAt: input.dueAt });
  return session;
}

/** Finance records money received offline (bank transfer/cheque) against a credit-terms order. */
export async function recordOfflinePayment(input: {
  paymentSessionId: string;
  amount: number;
  reference: string;
  adminUserId: string;
}) {
  const session = await PaymentSession.findById(input.paymentSessionId);

  if (!session) throw new AppError("Payment session not found", 404);
  if (session.method !== "credit_terms") {
    throw new AppError(
      "Offline payments can only be recorded against wholesale credit orders",
      409,
    );
  }
  if (input.amount <= 0 || input.amount > session.outstandingAmount) {
    throw new AppError(
      `Amount must be between 1 and the outstanding ${session.outstandingAmount}`,
      400,
    );
  }

  const applied = await captureOnce(session, input.amount, {
    captureKey: `offline:${input.reference.trim().toUpperCase()}`,
  });
  if (!applied) throw new AppError("This payment reference has already been recorded", 409);

  await recordPaymentHistory(session, "offline_payment_recorded", "admin", {
    actorId: input.adminUserId,
    reference: input.reference,
  });
  return session;
}

export async function createCodPayment(input: CreatePaymentInput) {
  const amounts = normalizeAmounts(input.amount, input.payableNow);
  const reviewThreshold = await getRuntimeNumberSetting(
    "COD_MANUAL_REVIEW_THRESHOLD",
    env.COD_MANUAL_REVIEW_THRESHOLD,
  );
  const session = await PaymentSession.create({
    userId: input.userId,
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
    orderReference: input.orderReference,
    method: "cod",
    status: "cod_confirmed",
    amount: amounts.amount,
    payableNow: 0,
    paidAmount: 0,
    outstandingAmount: amounts.amount,
    currencyCode: input.currencyCode ?? "INR",
    paymentMode: "balance",
    codManualReviewRequired: amounts.amount >= reviewThreshold,
  });

  await recordPaymentHistory(session, "cod_confirmed", "customer", {
    manualReviewRequired: session.codManualReviewRequired,
  });
  return session;
}

export async function createManualPayment(input: ManualPaymentInput) {
  const amounts = normalizeAmounts(input.amount, input.payableNow);
  const session = await PaymentSession.create({
    userId: input.userId,
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
    orderReference: input.orderReference,
    method: "manual_bank_transfer",
    status: "payment_verification_pending",
    amount: amounts.amount,
    payableNow: amounts.payableNow,
    paidAmount: 0,
    outstandingAmount: amounts.amount,
    currencyCode: input.currencyCode ?? "INR",
    paymentMode: input.paymentMode ?? (amounts.payableNow < amounts.amount ? "advance" : "full"),
    manualScreenshot: input.manualScreenshot,
  });

  await recordPaymentHistory(session, "manual_payment_submitted", "customer");
  return session;
}

export async function createUpiPayment(input: UpiPaymentInput) {
  const amounts = normalizeAmounts(input.amount, input.payableNow);
  const settings = await getPaymentSettings();
  const session = await PaymentSession.create({
    userId: input.userId,
    guestEmail: input.guestEmail,
    guestSessionId: input.guestSessionId,
    orderReference: input.orderReference,
    method: "upi",
    status: "upi_pending",
    amount: amounts.amount,
    payableNow: amounts.payableNow,
    paidAmount: 0,
    outstandingAmount: amounts.amount,
    currencyCode: input.currencyCode ?? "INR",
    paymentMode: input.paymentMode ?? (amounts.payableNow < amounts.amount ? "advance" : "full"),
    upiId: settings.upiId,
    upiReference: input.upiReference,
  });

  await recordPaymentHistory(session, "upi_payment_initiated", "customer", {
    upiId: session.upiId,
    upiReference: session.upiReference,
  });
  return session;
}

export async function approveManualPayment(input: {
  paymentSessionId: string;
  adminUserId: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const session = await PaymentSession.findById(input.paymentSessionId);

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  if (!["payment_verification_pending", "upi_pending"].includes(session.status)) {
    throw new AppError("Payment is not pending verification", 409);
  }

  const before = session.toObject();
  session.verifiedBy = new Types.ObjectId(input.adminUserId);
  session.verifiedAt = new Date();
  const applied = await captureOnce(session, session.payableNow, {
    captureKey: `manual:${String(session._id)}`,
  });

  if (!applied) {
    throw new AppError("Payment has already been approved", 409);
  }

  await recordPaymentHistory(session, "payment_approved", "admin", { actorId: input.adminUserId });
  await writeAuditLog({
    actor: {
      actorId: new Types.ObjectId(input.adminUserId),
      actorType: "admin",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    after: session.toObject(),
    before,
    entity: { id: session._id, type: "payment-session", displayId: session.orderReference },
    action: "update",
    metadata: { transition: "approve_payment" },
  });
  await finalizeOrderAfterPayment({
    actor: { actorId: input.adminUserId, actorType: "admin" },
    outstandingAmount: session.outstandingAmount,
    payableNow: session.payableNow,
    paymentSessionId: session._id,
    paymentSessionStatus: session.status,
  });
  return session;
}

export async function rejectManualPayment(input: {
  paymentSessionId: string;
  adminUserId: string;
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const session = await PaymentSession.findById(input.paymentSessionId);

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  if (!["payment_verification_pending", "upi_pending"].includes(session.status)) {
    throw new AppError("Payment is not pending verification", 409);
  }

  const before = session.toObject();
  session.status = "payment_rejected";
  session.rejectionReason = input.reason;
  session.verifiedBy = new Types.ObjectId(input.adminUserId);
  session.verifiedAt = new Date();
  await session.save();
  await recordPaymentHistory(session, "payment_rejected", "admin", {
    actorId: input.adminUserId,
    reason: input.reason,
  });
  await writeAuditLog({
    actor: {
      actorId: new Types.ObjectId(input.adminUserId),
      actorType: "admin",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    after: session.toObject(),
    before,
    entity: { id: session._id, type: "payment-session", displayId: session.orderReference },
    action: "update",
    metadata: { transition: "reject_payment", reason: input.reason },
  });
  const order = await Order.findOne({ paymentSessionId: session._id });
  if (order?.status === "payment_verification_pending") {
    await transitionOrderDocument(
      order as unknown as Parameters<typeof transitionOrderDocument>[0],
      {
        actor: { actorId: input.adminUserId, actorType: "admin" },
        note: input.reason,
        toStatus: "payment_rejected",
      },
    );
  }

  return session;
}

export async function listPaymentHistory(userId: string, orderReference?: string) {
  return PaymentHistory.find({
    ...(orderReference ? { orderReference } : {}),
    paymentSessionId: {
      $in: await PaymentSession.find({ userId }).distinct("_id"),
    },
  })
    .sort({ createdAt: -1 })
    .lean();
}

export async function assertRazorpayPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const secret = await getRazorpaySecret("RAZORPAY_KEY_SECRET");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");

  if (!safeEqual(expected, input.razorpaySignature)) {
    throw new AppError("Razorpay payment signature is invalid", 400);
  }
}

export async function verifyRazorpayWebhookSignature(payloadText: string, signature: string) {
  const secret = await getRazorpaySecret("RAZORPAY_WEBHOOK_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(payloadText).digest("hex");

  return safeEqual(expected, signature);
}

export async function getRazorpayPublicConfig() {
  const credentials = await getRazorpayCredentials();

  return {
    gatewayEnabled: credentials.enabled && Boolean(credentials.keyId && credentials.keySecret),
    keyId: credentials.keyId,
  };
}

async function createRazorpayGatewayOrder(input: {
  amount: number;
  currencyCode: string;
  receipt: string;
}): Promise<RazorpayOrder> {
  const razorpay = await getRazorpayClient();

  if (!razorpay) {
    if (env.NODE_ENV === "production" && !isTestRuntime()) {
      throw new AppError("Online payment is temporarily unavailable. Please try again later.", 503);
    }

    return {
      amount: Math.round(input.amount * 100),
      currency: input.currencyCode,
      id: `rzp_dev_${crypto.randomUUID()}`,
      receipt: input.receipt,
      status: "created",
    };
  }

  try {
    return (await razorpay.orders.create({
      amount: Math.round(input.amount * 100),
      currency: input.currencyCode,
      receipt: input.receipt.slice(0, 40),
    })) as RazorpayOrder;
  } catch (error) {
    if (env.NODE_ENV === "production") {
      throw error;
    }

    return {
      amount: Math.round(input.amount * 100),
      currency: input.currencyCode,
      id: `rzp_dev_${crypto.randomUUID()}`,
      receipt: input.receipt,
      status: "created",
    };
  }
}

function isTestRuntime() {
  return (
    env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.includes("--test") ||
    process.env.npm_lifecycle_event === "test" ||
    process.env.npm_lifecycle_script?.includes("--test") === true
  );
}

async function recordPaymentHistory(
  session: PaymentSessionDoc,
  event: string,
  actorType: "customer" | "admin" | "system",
  metadata: Record<string, unknown> = {},
) {
  return PaymentHistory.create({
    actorId: metadata.actorId,
    actorType,
    amount: session.payableNow,
    currencyCode: session.currencyCode,
    event,
    gatewayTransactionId: metadata.gatewayTransactionId,
    method: session.method,
    metadata,
    orderReference: session.orderReference,
    paymentSessionId: session._id,
  });
}

/**
 * Credits a capture to the session exactly once. The capture key (gateway payment id, or a
 * synthetic key for manual approvals) is claimed atomically in MongoDB before any amount is
 * applied, so a replayed client confirmation, a duplicate webhook, or a confirmation racing
 * a webhook can never double count the same money.
 */
async function captureOnce(
  session: PaymentSessionDoc,
  amount: number,
  gateway: { razorpayPaymentId?: string; razorpaySignature?: string; captureKey?: string },
) {
  const captureKey = gateway.captureKey ?? gateway.razorpayPaymentId;

  if (!captureKey) {
    throw new AppError("Payment capture reference is missing", 400);
  }

  const alreadyCaptured = [...((session.capturedPaymentIds ?? []) as string[])];

  if (alreadyCaptured.includes(captureKey)) {
    return false;
  }

  const creditedAmount = Math.max(0, Math.min(amount, session.amount - session.paidAmount));
  const capture = {
    amount: creditedAmount,
    capturedAt: new Date(),
    key: captureKey,
    razorpayPaymentId: gateway.razorpayPaymentId,
    refundedAmount: 0,
  };
  const claim = await PaymentSession.updateOne(
    { _id: session._id, capturedPaymentIds: { $ne: captureKey } },
    { $addToSet: { capturedPaymentIds: captureKey }, $push: { captures: capture } },
  );

  if (!claim.modifiedCount) {
    return false;
  }

  // Both arrays were persisted by the atomic claim; mirror them in memory only.
  session.set("capturedPaymentIds", [...alreadyCaptured, captureKey]);
  session.set("captures", [...((session.get("captures") ?? []) as unknown[]), capture]);
  session.unmarkModified("capturedPaymentIds");
  session.unmarkModified("captures");
  applySuccessfulCapture(session, creditedAmount, gateway);
  await session.save();
  return true;
}

function applySuccessfulCapture(
  session: PaymentSessionDoc,
  amount: number,
  gateway: { razorpayPaymentId?: string; razorpaySignature?: string },
) {
  const nextPaidAmount = Math.min(session.amount, session.paidAmount + amount);
  session.paidAmount = nextPaidAmount;
  session.outstandingAmount = Math.max(0, session.amount - nextPaidAmount);
  session.status = session.outstandingAmount > 0 ? "partially_paid" : "confirmed";
  session.razorpayPaymentId = gateway.razorpayPaymentId ?? session.razorpayPaymentId;
  session.razorpaySignature = gateway.razorpaySignature ?? session.razorpaySignature;
}

function normalizeAmounts(amount: number, payableNow = amount) {
  const normalizedAmount = Math.round(amount);
  const normalizedPayableNow = Math.round(payableNow);

  if (
    normalizedAmount <= 0 ||
    normalizedPayableNow <= 0 ||
    normalizedPayableNow > normalizedAmount
  ) {
    throw new AppError("Payment amount is invalid", 400);
  }

  return { amount: normalizedAmount, payableNow: normalizedPayableNow };
}

function rememberGatewayOrder(session: PaymentSessionDoc, gatewayOrderId: string) {
  const known = [...((session.razorpayOrderIds ?? []) as string[])];

  if (!known.includes(gatewayOrderId)) {
    session.set("razorpayOrderIds", [...known, gatewayOrderId]);
  }
}

/** Finds a session by its current or any earlier gateway order (retries create new ones). */
async function findSessionByGatewayOrder(gatewayOrderId: string) {
  return PaymentSession.findOne({
    $or: [{ razorpayOrderId: gatewayOrderId }, { razorpayOrderIds: gatewayOrderId }],
  });
}

async function getRazorpayCredentials() {
  const [keyId, keySecret, enabled] = await Promise.all([
    getRuntimeSetting("RAZORPAY_KEY_ID"),
    getRuntimeSetting("RAZORPAY_KEY_SECRET"),
    getRuntimeBooleanSetting("RAZORPAY_ENABLE_GATEWAY_CALLS", env.RAZORPAY_ENABLE_GATEWAY_CALLS),
  ]);

  return { enabled, keyId: keyId || "", keySecret: keySecret || "" };
}

async function getRazorpayClient() {
  if (isTestRuntime()) {
    return undefined;
  }

  const credentials = await getRazorpayCredentials();

  if (!credentials.enabled || !credentials.keyId || !credentials.keySecret) {
    return undefined;
  }

  return new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret });
}

async function getRazorpaySecret(name: "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET") {
  const secret = (await getRuntimeSetting(name)) || env[name];

  if (!secret) {
    throw new AppError(`${name} is not configured`, 500);
  }

  return secret;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}
