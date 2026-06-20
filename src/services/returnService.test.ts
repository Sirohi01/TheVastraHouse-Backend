import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { InventoryLog } from "../models/InventoryLog.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { Order } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Refund } from "../models/Refund.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { StockLedger } from "../models/StockLedger.js";
import { StoreCreditIssue } from "../models/StoreCreditIssue.js";
import { approveReturn, assertRefundMethodEligible, requestReturn } from "./returnService.js";

test("customer return request is accepted inside policy window and rejected after it", async (t) => {
  const ctx = patchReturnModels();
  t.after(ctx.restore);
  const order = buildOrder({ deliveredAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
  ctx.order = order;

  const returnRequest = await requestReturn({
    items: [{ quantity: 1, reason: "Size issue", sku: "TVH-RET-M-0001" }],
    orderNumber: order.orderNumber,
    userId: String(order.userId),
  });

  assert.equal(returnRequest.status, "requested");
  assert.equal(ctx.returns.length, 1);

  ctx.order = buildOrder({ deliveredAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) });
  await assert.rejects(
    requestReturn({
      items: [{ quantity: 1, reason: "Late return", sku: "TVH-RET-M-0001" }],
      orderNumber: ctx.order.orderNumber,
      userId: String(ctx.order.userId),
    }),
    /Return policy window has expired/,
  );
});

test("refund method eligibility rejects impossible original-method refunds", () => {
  assert.doesNotThrow(() => assertRefundMethodEligible("razorpay", "original_payment"));
  assert.throws(
    () => assertRefundMethodEligible("cod", "original_payment"),
    /Refund method is not eligible/,
  );
});

test("return approval routes stock, records refund history, and queues credit note hook", async (t) => {
  const ctx = patchReturnModels();
  t.after(ctx.restore);
  const order = buildOrder({ deliveredAt: new Date(), status: "delivered" });
  const returnRequest = buildReturnRequest(order);
  ctx.order = order;
  ctx.returnRequest = returnRequest;
  ctx.paymentSession = buildPaymentSession(order, { method: "razorpay", paidAmount: 1999 });

  const result = await approveReturn({
    actor: { actorId: String(new Types.ObjectId()), actorType: "admin" },
    refundMethod: "store_credit",
    returnRequestId: String(returnRequest._id),
    stockDisposition: "restock",
  });

  assert.equal(result.returnRequest.status, "refunded");
  assert.equal(result.returnRequest.creditNoteStatus, "queued");
  assert.equal(result.refund.status, "processed");
  assert.equal(ctx.ledger.available, 1);
  assert.equal(ctx.ledger.returned, 0);
  assert.deepEqual(
    ctx.inventoryLogs.map((log) => log.eventType),
    ["return", "restock"],
  );
  assert.equal(ctx.paymentHistory[0].event, "refund_processed");
  assert.equal(ctx.storeCredits.length, 1);
});

test("second refund attempt and excessive refund amount are rejected", async (t) => {
  const ctx = patchReturnModels();
  t.after(ctx.restore);
  const order = buildOrder({ deliveredAt: new Date(), status: "delivered" });
  const returnRequest = buildReturnRequest(order);
  ctx.order = order;
  ctx.returnRequest = returnRequest;
  ctx.paymentSession = buildPaymentSession(order, { method: "upi", paidAmount: 500 });

  await assert.rejects(
    approveReturn({
      actor: { actorType: "admin" },
      refundAmount: 999,
      refundMethod: "bank_transfer",
      returnRequestId: String(returnRequest._id),
      stockDisposition: "damaged",
    }),
    /Refund amount exceeds eligible paid amount/,
  );

  ctx.existingRefund = { _id: new Types.ObjectId() };
  await assert.rejects(
    approveReturn({
      actor: { actorType: "admin" },
      refundMethod: "bank_transfer",
      returnRequestId: String(returnRequest._id),
      stockDisposition: "damaged",
    }),
    /Refund already exists/,
  );
});

function patchReturnModels() {
  const originalOrderFindOne = Order.findOne;
  const originalOrderFindById = Order.findById;
  const originalReturnCreate = ReturnRequest.create;
  const originalReturnFindById = ReturnRequest.findById;
  const originalRefundCreate = Refund.create;
  const originalRefundFindOne = Refund.findOne;
  const originalPaymentFindById = PaymentSession.findById;
  const originalPaymentHistoryCreate = PaymentHistory.create;
  const originalStoreCreditCreate = StoreCreditIssue.create;
  const originalStockFindOne = StockLedger.findOne;
  const originalStockFindOneAndUpdate = StockLedger.findOneAndUpdate;
  const originalInventoryLogCreate = InventoryLog.create;
  const originalLowStockFindOne = LowStockAlert.findOne;
  const originalLowStockCreate = LowStockAlert.create;
  const originalLowStockUpdateMany = LowStockAlert.updateMany;
  const originalTimelineCreate = OrderTimeline.create;
  const ctx: {
    existingRefund?: unknown;
    inventoryLogs: Array<Record<string, unknown>>;
    ledger: { available: number; returned: number; sku: string; warehouseId: string };
    order?: ReturnType<typeof buildOrder>;
    paymentHistory: Array<Record<string, unknown>>;
    paymentSession?: ReturnType<typeof buildPaymentSession>;
    returnRequest?: ReturnType<typeof buildReturnRequest>;
    returns: unknown[];
    storeCredits: Array<Record<string, unknown>>;
  } = {
    inventoryLogs: [],
    ledger: { available: 0, returned: 0, sku: "TVH-RET-M-0001", warehouseId: "" },
    paymentHistory: [],
    returns: [],
    storeCredits: [],
  };

  (Order as unknown as { findOne: unknown }).findOne = () => Promise.resolve(ctx.order ?? null);
  (Order as unknown as { findById: unknown }).findById = () => Promise.resolve(ctx.order ?? null);
  (ReturnRequest as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    const returnRequest = buildReturnRequest(ctx.order!, payload);
    ctx.returns.push(returnRequest);
    ctx.returnRequest = returnRequest;
    return Promise.resolve(returnRequest);
  };
  (ReturnRequest as unknown as { findById: unknown }).findById = () =>
    Promise.resolve(ctx.returnRequest ?? null);
  (Refund as unknown as { findOne: unknown }).findOne = () =>
    Promise.resolve(ctx.existingRefund ?? null);
  (Refund as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    const refund = { ...payload, _id: new Types.ObjectId(), save: async () => refund };
    return Promise.resolve(refund);
  };
  (PaymentSession as unknown as { findById: unknown }).findById = () =>
    Promise.resolve(ctx.paymentSession ?? null);
  (PaymentHistory as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    ctx.paymentHistory.push(payload);
    return Promise.resolve(payload);
  };
  (StoreCreditIssue as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    ctx.storeCredits.push(payload);
    return Promise.resolve(payload);
  };
  (StockLedger as unknown as { findOne: unknown }).findOne = () => ({
    lean() {
      return Promise.resolve({ ...ctx.ledger });
    },
  });
  (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    _filter: unknown,
    update: { $inc?: { available?: number; returned?: number; damaged?: number } },
  ) => {
    ctx.ledger.available += update.$inc?.available ?? 0;
    ctx.ledger.returned += update.$inc?.returned ?? 0;
    return Promise.resolve(ctx.ledger);
  };
  (InventoryLog as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    ctx.inventoryLogs.push(payload);
    return Promise.resolve(payload);
  };
  (LowStockAlert as unknown as { findOne: unknown }).findOne = () => Promise.resolve(null);
  (LowStockAlert as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve(payload);
  (LowStockAlert as unknown as { updateMany: unknown }).updateMany = () =>
    Promise.resolve({ modifiedCount: 0 });
  (OrderTimeline as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve(payload);

  return Object.assign(ctx, {
    restore() {
      (Order as unknown as { findOne: unknown }).findOne = originalOrderFindOne;
      (Order as unknown as { findById: unknown }).findById = originalOrderFindById;
      (ReturnRequest as unknown as { create: unknown }).create = originalReturnCreate;
      (ReturnRequest as unknown as { findById: unknown }).findById = originalReturnFindById;
      (Refund as unknown as { create: unknown }).create = originalRefundCreate;
      (Refund as unknown as { findOne: unknown }).findOne = originalRefundFindOne;
      (PaymentSession as unknown as { findById: unknown }).findById = originalPaymentFindById;
      (PaymentHistory as unknown as { create: unknown }).create = originalPaymentHistoryCreate;
      (StoreCreditIssue as unknown as { create: unknown }).create = originalStoreCreditCreate;
      (StockLedger as unknown as { findOne: unknown }).findOne = originalStockFindOne;
      (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
        originalStockFindOneAndUpdate;
      (InventoryLog as unknown as { create: unknown }).create = originalInventoryLogCreate;
      (LowStockAlert as unknown as { findOne: unknown }).findOne = originalLowStockFindOne;
      (LowStockAlert as unknown as { create: unknown }).create = originalLowStockCreate;
      (LowStockAlert as unknown as { updateMany: unknown }).updateMany = originalLowStockUpdateMany;
      (OrderTimeline as unknown as { create: unknown }).create = originalTimelineCreate;
    },
  });
}

function buildOrder(input: { deliveredAt?: Date; status?: "delivered" | "returned" }) {
  const warehouseId = new Types.ObjectId();
  const order = {
    _id: new Types.ObjectId(),
    items: [
      {
        lineSubtotal: 1999,
        productName: "Silk Kurti",
        quantity: 1,
        sku: "TVH-RET-M-0001",
        unitPrice: 1999,
      },
    ],
    orderNumber: "TVH-RETURN-1",
    paymentSessionId: new Types.ObjectId(),
    save: async () => order,
    shipment: { deliveredAt: input.deliveredAt },
    status: input.status ?? "delivered",
    stockReservations: [{ quantity: 1, sku: "TVH-RET-M-0001", status: "deducted", warehouseId }],
    totals: { currencyCode: "INR", grandTotal: 1999 },
    userId: new Types.ObjectId(),
  };
  return order;
}

function buildReturnRequest(
  order: ReturnType<typeof buildOrder>,
  overrides: Record<string, unknown> = {},
) {
  const returnRequest = {
    _id: new Types.ObjectId(),
    creditNoteStatus: "not_required",
    items: [
      {
        lineSubtotal: 1999,
        productName: "Silk Kurti",
        quantity: 1,
        reason: "Size issue",
        sku: "TVH-RET-M-0001",
        unitPrice: 1999,
        warehouseId: order.stockReservations[0].warehouseId,
      },
    ],
    orderId: order._id,
    orderNumber: order.orderNumber,
    returnNumber: "RET-TEST-1",
    save: async () => returnRequest,
    status: "requested",
    userId: order.userId,
    ...overrides,
  };
  return returnRequest;
}

function buildPaymentSession(
  order: ReturnType<typeof buildOrder>,
  input: { method: "razorpay" | "cod" | "manual_bank_transfer" | "upi"; paidAmount: number },
) {
  return {
    _id: order.paymentSessionId,
    amount: 1999,
    currencyCode: "INR",
    method: input.method,
    orderReference: order.orderNumber,
    paidAmount: input.paidAmount,
    payableNow: 1999,
  };
}
