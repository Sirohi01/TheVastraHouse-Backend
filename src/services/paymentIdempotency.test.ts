import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { Order } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { stubPaymentCaptureClaims, stubStatics } from "../testing/commerceStubs.js";
import {
  approveManualPayment,
  createBalancePaymentForOrder,
  handleRazorpayWebhook,
  verifyRazorpayPayment,
} from "./paymentService.js";

type Session = InstanceType<typeof PaymentSession>;

function setup(
  t: test.TestContext,
  sessionInput: Record<string, unknown>,
  orderInput: Record<string, unknown> = {},
) {
  env.RAZORPAY_KEY_SECRET = "idem_key_secret";
  env.RAZORPAY_WEBHOOK_SECRET = "idem_webhook_secret";
  const session = new PaymentSession({
    amount: 2000,
    currencyCode: "INR",
    method: "razorpay",
    orderReference: "ORDER-IDEM",
    outstandingAmount: 2000,
    paidAmount: 0,
    payableNow: 2000,
    razorpayOrderId: "order_idem_1",
    razorpayOrderIds: ["order_idem_1"],
    status: "pending_payment",
    ...sessionInput,
  }) as Session;
  session.save = async () => session;
  const timeline: unknown[] = [];
  const history: string[] = [];
  const events: InstanceType<typeof PaymentWebhookEvent>[] = [];
  const order: Record<string, unknown> & { save: () => Promise<unknown> } = {
    _id: new Types.ObjectId(),
    items: [],
    orderNumber: "ORDER-IDEM",
    paymentMethod: "razorpay",
    paymentMode: "full",
    paymentSessionId: session._id,
    status: "pending_payment",
    stockReservations: [],
    totals: { currencyCode: "INR", grandTotal: 2000 },
    save: async () => order,
    toObject: () => ({ ...order }),
    ...orderInput,
  };
  const restorers = [
    stubPaymentCaptureClaims(),
    stubStatics(PaymentSession, {
      findById: () => Promise.resolve(session),
      findOne: () => Promise.resolve(session),
    }),
    stubStatics(Order, { findOne: () => Promise.resolve(order) }),
    stubStatics(OrderTimeline, {
      create: (payload: unknown) => {
        timeline.push(payload);
        return Promise.resolve(payload);
      },
    }),
    stubStatics(PaymentHistory, {
      create: (payload: { event: string }) => {
        history.push(payload.event);
        return Promise.resolve(payload);
      },
    }),
    stubStatics(AuditLog, { create: (payload: unknown) => Promise.resolve(payload) }),
    stubStatics(PaymentWebhookEvent, {
      create: (payload: Record<string, unknown>) => {
        const event = new PaymentWebhookEvent(payload);
        event.save = async () => event;
        events.push(event);
        return Promise.resolve(event);
      },
      findOne: (filter: { eventId: string }) =>
        Promise.resolve(events.find((event) => event.eventId === filter.eventId) ?? null),
    }),
  ];
  t.after(() => restorers.forEach((restore) => restore()));

  return { events, history, order, session, timeline };
}

function sign(orderId: string, paymentId: string) {
  return crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function webhook(eventId: string, paymentId: string, orderId: string, amountRupees: number) {
  const payload = Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      id: eventId,
      payload: {
        payment: {
          entity: { amount: amountRupees * 100, currency: "INR", id: paymentId, order_id: orderId },
        },
      },
    }),
  );
  const signature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET!)
    .update(payload)
    .digest("hex");
  return { payload, signature };
}

test("client confirmation alone credits a full payment once", async (t) => {
  const ctx = setup(t, {});
  await verifyRazorpayPayment({
    razorpayOrderId: "order_idem_1",
    razorpayPaymentId: "pay_1",
    razorpaySignature: sign("order_idem_1", "pay_1"),
  });

  assert.equal(ctx.session.paidAmount, 2000);
  assert.equal(ctx.session.status, "confirmed");
  assert.equal(ctx.order.status, "confirmed");
});

test("webhook alone credits the payment, and a redelivered webhook is ignored", async (t) => {
  const ctx = setup(t, {});
  const delivery = webhook("evt_1", "pay_1", "order_idem_1", 2000);
  const first = await handleRazorpayWebhook(delivery.payload, delivery.signature);
  const second = await handleRazorpayWebhook(delivery.payload, delivery.signature);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(ctx.session.paidAmount, 2000);
  assert.equal(ctx.timeline.length, 1);
});

test("duplicate client confirmation (replay) never double counts", async (t) => {
  const ctx = setup(t, {});
  const input = {
    razorpayOrderId: "order_idem_1",
    razorpayPaymentId: "pay_1",
    razorpaySignature: sign("order_idem_1", "pay_1"),
  };
  await verifyRazorpayPayment(input);
  await verifyRazorpayPayment(input);
  await verifyRazorpayPayment(input);

  assert.equal(ctx.session.paidAmount, 2000);
  assert.equal(ctx.history.filter((event) => event === "razorpay_payment_verified").length, 1);
});

test("COD 50% advance: confirmation + webhook for the same payment never marks it fully paid", async (t) => {
  const ctx = setup(
    t,
    { amount: 3000, outstandingAmount: 3000, payableNow: 1500, paymentMode: "advance" },
    { paymentMethod: "cod", paymentMode: "advance" },
  );
  await verifyRazorpayPayment({
    razorpayOrderId: "order_idem_1",
    razorpayPaymentId: "pay_adv",
    razorpaySignature: sign("order_idem_1", "pay_adv"),
  });
  const delivery = webhook("evt_adv", "pay_adv", "order_idem_1", 1500);
  const result = await handleRazorpayWebhook(delivery.payload, delivery.signature);
  // Different webhook event id, same payment id: must be treated as already credited.
  const redelivery = webhook("evt_adv_2", "pay_adv", "order_idem_1", 1500);
  await handleRazorpayWebhook(redelivery.payload, redelivery.signature);

  assert.equal(result.duplicate, false);
  assert.equal(ctx.session.paidAmount, 1500);
  assert.equal(ctx.session.outstandingAmount, 1500);
  assert.equal(ctx.session.status, "partially_paid");
  assert.equal(ctx.order.status, "cod_confirmed");
  assert.equal(ctx.order.balancePaymentNotifiedAt, undefined);
});

test("webhook arriving first, then client confirmation, credits once", async (t) => {
  const ctx = setup(t, {});
  const delivery = webhook("evt_first", "pay_1", "order_idem_1", 2000);
  await handleRazorpayWebhook(delivery.payload, delivery.signature);
  await verifyRazorpayPayment({
    razorpayOrderId: "order_idem_1",
    razorpayPaymentId: "pay_1",
    razorpaySignature: sign("order_idem_1", "pay_1"),
  });

  assert.equal(ctx.session.paidAmount, 2000);
  assert.equal(ctx.timeline.length, 1);
});

test("forged confirmation signature is rejected without crediting", async (t) => {
  const ctx = setup(t, {});
  await assert.rejects(
    () =>
      verifyRazorpayPayment({
        razorpayOrderId: "order_idem_1",
        razorpayPaymentId: "pay_1",
        razorpaySignature: "0".repeat(64),
      }),
    /signature is invalid/,
  );
  assert.equal(ctx.session.paidAmount, 0);
});

test("balance payment after a COD advance is a distinct payment and completes the order", async (t) => {
  const ctx = setup(
    t,
    { amount: 3000, outstandingAmount: 3000, payableNow: 1500, paymentMode: "advance" },
    { paymentMethod: "cod", paymentMode: "advance" },
  );
  await verifyRazorpayPayment({
    razorpayOrderId: "order_idem_1",
    razorpayPaymentId: "pay_adv",
    razorpaySignature: sign("order_idem_1", "pay_adv"),
  });
  const balance = await createBalancePaymentForOrder({
    orderNumber: "ORDER-IDEM",
    userId: String(new Types.ObjectId()),
  });
  await verifyRazorpayPayment({
    razorpayOrderId: balance.gatewayOrder.id,
    razorpayPaymentId: "pay_bal",
    razorpaySignature: sign(balance.gatewayOrder.id, "pay_bal"),
  });
  // Replaying the balance confirmation changes nothing.
  await verifyRazorpayPayment({
    razorpayOrderId: balance.gatewayOrder.id,
    razorpayPaymentId: "pay_bal",
    razorpaySignature: sign(balance.gatewayOrder.id, "pay_bal"),
  });

  assert.equal(ctx.session.paidAmount, 3000);
  assert.equal(ctx.session.outstandingAmount, 0);
  assert.equal(ctx.session.status, "confirmed");
  assert.deepEqual([...(ctx.session.capturedPaymentIds as string[])], ["pay_adv", "pay_bal"]);
  assert.ok((ctx.session.razorpayOrderIds as string[]).includes(balance.gatewayOrder.id));
});

test("manual payment cannot be approved twice", async (t) => {
  const ctx = setup(t, {
    method: "manual_bank_transfer",
    status: "payment_verification_pending",
  });
  const adminUserId = String(new Types.ObjectId());
  await approveManualPayment({ adminUserId, paymentSessionId: String(ctx.session._id) });
  // Simulate a stale second click that loaded the session before the first approval.
  ctx.session.status = "payment_verification_pending";
  await assert.rejects(
    () => approveManualPayment({ adminUserId, paymentSessionId: String(ctx.session._id) }),
    /already been approved/,
  );
  assert.equal(ctx.session.paidAmount, 2000);
});
