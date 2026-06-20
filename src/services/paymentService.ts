import crypto from "node:crypto";
import Razorpay from "razorpay";
import { Types, type HydratedDocument } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { writeAuditLog } from "./auditLogService.js";
import { finalizeOrderAfterPayment } from "./orderFulfillmentService.js";
import { getPaymentSettings } from "./paymentSettingsService.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

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

type PaymentSessionDoc = HydratedDocument<{
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  guestEmail?: string;
  guestSessionId?: string;
  orderReference: string;
  method: "razorpay" | "cod" | "manual_bank_transfer" | "upi";
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
  currencyCode: string;
  paymentMode: "full" | "advance" | "balance";
  razorpayOrderId?: string;
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
  await session.save();
  await recordPaymentHistory(session, "razorpay_order_created", "system", {
    gatewayOrder,
  });

  return { gatewayOrder, session };
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
}) {
  const order = await Order.findOne({
    orderNumber: input.orderNumber,
    ...(input.userId ? { userId: input.userId } : {}),
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (!input.userId) {
    const normalizedEmail = input.guestEmail?.trim().toLowerCase();
    if (!normalizedEmail || order.guestEmail !== normalizedEmail) {
      throw new AppError("Order not found", 404);
    }
  }

  if (!order.paymentSessionId) {
    throw new AppError("Order has no associated payment session", 409);
  }

  const session = await PaymentSession.findById(order.paymentSessionId);

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  if (session.method !== "razorpay") {
    throw new AppError("Balance payment is only supported for Razorpay orders", 409);
  }

  if (session.outstandingAmount <= 0) {
    throw new AppError("This order has no outstanding balance", 409);
  }

  const gatewayOrder = await createRazorpayGatewayOrder({
    amount: session.outstandingAmount,
    currencyCode: session.currencyCode,
    receipt: `${order.orderNumber}-BAL`,
  });

  session.payableNow = session.outstandingAmount;
  session.paymentMode = "balance";
  session.razorpayOrderId = gatewayOrder.id;
  await session.save();
  await recordPaymentHistory(session, "razorpay_balance_order_created", "customer", {
    gatewayOrder,
  });

  return { gatewayOrder, order, session };
}

export async function verifyRazorpayPayment(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  actorId?: string;
}) {
  const session = await PaymentSession.findOne({ razorpayOrderId: input.razorpayOrderId });

  if (!session) {
    throw new AppError("Payment session not found", 404);
  }

  assertRazorpayPaymentSignature(input);
  applySuccessfulCapture(session, session.payableNow, {
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
  });
  await session.save();
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

  return session;
}

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string | undefined) {
  const payloadText = rawBody.toString("utf8");

  if (!signature || !verifyRazorpayWebhookSignature(payloadText, signature)) {
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
    const session = await PaymentSession.findOne({ razorpayOrderId: payment.order_id });

    if (session) {
      applySuccessfulCapture(session, (payment.amount ?? session.payableNow * 100) / 100, {
        razorpayPaymentId: payment.id,
      });
      await session.save();
      event.paymentSessionId = session._id;
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
    }
  }

  event.processedAt = new Date();
  await event.save();

  return { duplicate: false, event };
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
  applySuccessfulCapture(session, session.payableNow, {});
  session.verifiedBy = new Types.ObjectId(input.adminUserId);
  session.verifiedAt = new Date();
  await session.save();
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

export function assertRazorpayPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const secret = getRazorpaySecret("RAZORPAY_KEY_SECRET");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");

  if (!safeEqual(expected, input.razorpaySignature)) {
    throw new AppError("Razorpay payment signature is invalid", 401);
  }
}

export function verifyRazorpayWebhookSignature(payloadText: string, signature: string) {
  const secret = getRazorpaySecret("RAZORPAY_WEBHOOK_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(payloadText).digest("hex");

  return safeEqual(expected, signature);
}

async function createRazorpayGatewayOrder(input: {
  amount: number;
  currencyCode: string;
  receipt: string;
}): Promise<RazorpayOrder> {
  if (
    isTestRuntime() ||
    !env.RAZORPAY_ENABLE_GATEWAY_CALLS ||
    !env.RAZORPAY_KEY_ID ||
    !env.RAZORPAY_KEY_SECRET
  ) {
    return {
      amount: Math.round(input.amount * 100),
      currency: input.currencyCode,
      id: `rzp_dev_${crypto.randomUUID()}`,
      receipt: input.receipt,
      status: "created",
    };
  }

  const razorpay = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });

  try {
    return (await razorpay.orders.create({
      amount: Math.round(input.amount * 100),
      currency: input.currencyCode,
      receipt: input.receipt,
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

function getRazorpaySecret(name: "RAZORPAY_KEY_SECRET" | "RAZORPAY_WEBHOOK_SECRET") {
  const secret = env[name];

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
