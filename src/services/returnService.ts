import { Types, type HydratedDocument } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Order, type orderStatuses } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Refund, type refundMethods } from "../models/Refund.js";
import { ReturnRequest, type returnStockDispositions } from "../models/ReturnRequest.js";
import { StoreCreditIssue } from "../models/StoreCreditIssue.js";
import { markDamagedStock, markReturnedStock, restockReturnedStock } from "./inventoryService.js";
import { transitionOrderDocument } from "./orderLifecycleService.js";

export const returnPolicy = {
  windowDays: 7,
} as const;

export type RefundMethod = (typeof refundMethods)[number];
type OrderStatus = (typeof orderStatuses)[number];
type StockDisposition = (typeof returnStockDispositions)[number];

type ReturnActor = {
  actorId?: string;
  actorType: "customer" | "admin" | "system";
};

type OrderDoc = HydratedDocument<{
  _id: Types.ObjectId;
  orderNumber: string;
  userId: Types.ObjectId;
  paymentSessionId?: Types.ObjectId;
  status: OrderStatus;
  shipment?: { deliveredAt?: Date };
  totals: { grandTotal: number; currencyCode: string };
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineSubtotal: number;
  }>;
  stockReservations: Array<{
    sku: string;
    quantity: number;
    warehouseId?: Types.ObjectId;
    status?: "reserved" | "released" | "deducted";
  }>;
}>;

type PaymentSessionDoc = HydratedDocument<{
  _id: Types.ObjectId;
  orderReference: string;
  method: "razorpay" | "cod" | "manual_bank_transfer" | "upi";
  amount: number;
  paidAmount: number;
  payableNow: number;
  currencyCode: string;
}>;

export async function requestReturn(input: {
  orderNumber: string;
  userId: string;
  items: Array<{ sku: string; quantity: number; reason: string }>;
}) {
  const order = (await Order.findOne({
    orderNumber: input.orderNumber,
    userId: input.userId,
  })) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  assertReturnPolicy(order);
  const items = normalizeReturnItems(order, input.items);

  return ReturnRequest.create({
    items,
    orderId: order._id,
    orderNumber: order.orderNumber,
    policyWindowDays: returnPolicy.windowDays,
    returnNumber: buildReturnNumber(),
    status: "requested",
    userId: order.userId,
  });
}

export async function approveReturn(input: {
  returnRequestId: string;
  actor: ReturnActor;
  stockDisposition: StockDisposition;
  refundMethod: RefundMethod;
  refundAmount?: number;
  note?: string;
}) {
  const returnRequest = await ReturnRequest.findById(input.returnRequestId);

  if (!returnRequest) {
    throw new AppError("Return request not found", 404);
  }

  if (returnRequest.status !== "requested") {
    throw new AppError("Return request is already processed", 409);
  }

  const existingRefund = await Refund.findOne({ returnRequestId: returnRequest._id });
  if (existingRefund) {
    throw new AppError("Refund already exists for this return", 409);
  }

  const order = (await Order.findById(returnRequest.orderId)) as OrderDoc | null;
  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const paymentSession = (await PaymentSession.findById(
    order.paymentSessionId,
  )) as PaymentSessionDoc | null;
  if (!paymentSession) {
    throw new AppError("Payment session not found", 404);
  }

  assertRefundMethodEligible(paymentSession.method, input.refundMethod);
  const requestedAmount = input.refundAmount ?? sumReturnAmount(returnRequest.items);
  const maxRefundable = refundableAmount(paymentSession);

  if (requestedAmount <= 0 || requestedAmount > maxRefundable) {
    throw new AppError("Refund amount exceeds eligible paid amount", 400);
  }

  await routeReturnedStock(returnRequest, input.stockDisposition, input.actor);

  if (order.status === "delivered") {
    await transitionOrderDocument(order as Parameters<typeof transitionOrderDocument>[0], {
      actor: input.actor,
      note: input.note ?? "Return approved",
      toStatus: "returned",
    });
  }

  const refund = await Refund.create({
    amount: requestedAmount,
    currencyCode: paymentSession.currencyCode,
    method: input.refundMethod,
    orderId: order._id,
    orderNumber: order.orderNumber,
    paymentSessionId: paymentSession._id,
    processedAt: new Date(),
    processedBy: input.actor.actorId ? new Types.ObjectId(input.actor.actorId) : undefined,
    returnRequestId: returnRequest._id,
    status: "processed",
    userId: order.userId,
  });

  if (input.refundMethod === "store_credit") {
    const credit = await StoreCreditIssue.create({
      amount: refund.amount,
      currencyCode: refund.currencyCode,
      metadata: { source: "phase-14-return-refund" },
      orderNumber: refund.orderNumber,
      reference: buildStoreCreditReference(),
      refundId: refund._id,
      returnRequestId: returnRequest._id,
      userId: order.userId,
    });
    refund.storeCreditReference = credit.reference;
    await refund.save();
  }

  await PaymentHistory.create({
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    amount: refund.amount,
    currencyCode: refund.currencyCode,
    event: "refund_processed",
    method: paymentSession.method,
    metadata: {
      refundId: String(refund._id),
      refundMethod: input.refundMethod,
      returnNumber: returnRequest.returnNumber,
    },
    orderReference: order.orderNumber,
    paymentSessionId: paymentSession._id,
  });

  returnRequest.status = "refunded";
  returnRequest.decisionNote = input.note;
  returnRequest.stockDisposition = input.stockDisposition;
  returnRequest.decidedAt = new Date();
  returnRequest.decidedBy = input.actor.actorId
    ? new Types.ObjectId(input.actor.actorId)
    : undefined;
  returnRequest.creditNoteStatus = "queued";
  await returnRequest.save();

  if (order.status === "returned") {
    await transitionOrderDocument(order as Parameters<typeof transitionOrderDocument>[0], {
      actor: input.actor,
      note: "Refund processed",
      toStatus: "refunded",
    });
  }

  return { refund, returnRequest };
}

export async function rejectReturn(input: {
  returnRequestId: string;
  actor: ReturnActor;
  note: string;
}) {
  const returnRequest = await ReturnRequest.findById(input.returnRequestId);

  if (!returnRequest) {
    throw new AppError("Return request not found", 404);
  }

  if (returnRequest.status !== "requested") {
    throw new AppError("Return request is already processed", 409);
  }

  returnRequest.status = "rejected";
  returnRequest.decisionNote = input.note;
  returnRequest.decidedAt = new Date();
  returnRequest.decidedBy = input.actor.actorId
    ? new Types.ObjectId(input.actor.actorId)
    : undefined;
  await returnRequest.save();
  return returnRequest;
}

export function eligibleRefundMethods(paymentMethod: PaymentSessionDoc["method"]): RefundMethod[] {
  if (paymentMethod === "razorpay") {
    return ["original_payment", "store_credit"];
  }

  return ["bank_transfer", "store_credit"];
}

export function assertRefundMethodEligible(
  paymentMethod: PaymentSessionDoc["method"],
  refundMethod: RefundMethod,
) {
  if (!eligibleRefundMethods(paymentMethod).includes(refundMethod)) {
    throw new AppError("Refund method is not eligible for this payment method", 400);
  }
}

function assertReturnPolicy(order: OrderDoc) {
  if (order.status !== "delivered") {
    throw new AppError("Only delivered orders can be returned", 409);
  }

  const deliveredAt = order.shipment?.deliveredAt;
  if (!deliveredAt) {
    throw new AppError("Delivery timestamp is required for return policy validation", 409);
  }

  const windowEndsAt = deliveredAt.getTime() + returnPolicy.windowDays * 24 * 60 * 60 * 1000;
  if (Date.now() > windowEndsAt) {
    throw new AppError("Return policy window has expired", 409);
  }
}

function normalizeReturnItems(
  order: OrderDoc,
  requestedItems: Array<{ sku: string; quantity: number; reason: string }>,
) {
  if (!requestedItems.length) {
    throw new AppError("At least one return item is required", 400);
  }

  return requestedItems.map((requestedItem) => {
    const sku = requestedItem.sku.trim().toUpperCase();
    const orderItem = order.items.find((item) => item.sku === sku);
    const stockReservation = order.stockReservations.find((item) => item.sku === sku);

    if (!orderItem || requestedItem.quantity > orderItem.quantity) {
      throw new AppError("Return item quantity is invalid", 400);
    }

    return {
      lineSubtotal: Math.round(orderItem.unitPrice * requestedItem.quantity * 100) / 100,
      productName: orderItem.productName,
      quantity: requestedItem.quantity,
      reason: requestedItem.reason,
      sku,
      unitPrice: orderItem.unitPrice,
      warehouseId: stockReservation?.warehouseId,
    };
  });
}

async function routeReturnedStock(
  returnRequest: {
    items: Array<{ sku: string; quantity: number; warehouseId?: unknown }>;
    orderNumber: string;
  },
  stockDisposition: StockDisposition,
  actor: ReturnActor,
) {
  for (const item of returnRequest.items) {
    if (!item.warehouseId) {
      continue;
    }

    await markReturnedStock({
      actor,
      quantity: item.quantity,
      referenceId: returnRequest.orderNumber,
      referenceType: "return",
      sku: item.sku,
      warehouseId: String(item.warehouseId),
    });

    if (stockDisposition === "restock") {
      await restockReturnedStock({
        actor,
        quantity: item.quantity,
        reasonCode: "return-approved-restock",
        referenceId: returnRequest.orderNumber,
        referenceType: "return",
        sku: item.sku,
        warehouseId: String(item.warehouseId),
      });
    } else {
      await markDamagedStock({
        actor,
        quantity: item.quantity,
        reasonCode: "return-approved-damaged",
        referenceId: returnRequest.orderNumber,
        referenceType: "return",
        sku: item.sku,
        warehouseId: String(item.warehouseId),
      });
    }
  }
}

function sumReturnAmount(items: Array<{ lineSubtotal: number }>) {
  return Math.round(items.reduce((total, item) => total + item.lineSubtotal, 0) * 100) / 100;
}

function refundableAmount(paymentSession: PaymentSessionDoc) {
  if (paymentSession.paidAmount > 0) {
    return paymentSession.paidAmount;
  }

  return paymentSession.method === "cod" ? paymentSession.amount : 0;
}

function buildReturnNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

  return `RET-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function buildStoreCreditReference() {
  return `SC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}
