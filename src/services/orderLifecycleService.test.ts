import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { InventoryLog } from "../models/InventoryLog.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { StockLedger } from "../models/StockLedger.js";
import { transitionOrderDocument, type OrderStatus } from "./orderLifecycleService.js";

test("order lifecycle rejects invalid status transitions", async (t) => {
  const ctx = patchLifecycleModels();
  t.after(ctx.restore);
  const order = buildOrder({ status: "pending_payment" });

  await assert.rejects(
    transitionOrderDocument(order, {
      actor: { actorType: "admin" },
      toStatus: "shipped",
    }),
    /Invalid order status transition/,
  );
  assert.equal(order.status, "pending_payment");
  assert.equal(ctx.timeline.length, 0);
});

test("order lifecycle records every accepted status transition in timeline", async (t) => {
  const ctx = patchLifecycleModels();
  t.after(ctx.restore);
  const order = buildOrder({ status: "pending_payment" });

  await transitionOrderDocument(order, {
    actor: { actorId: String(new Types.ObjectId()), actorType: "admin" },
    note: "Payment captured",
    toStatus: "confirmed",
  });

  assert.equal(order.status, "confirmed");
  assert.equal(ctx.timeline.length, 1);
  assert.equal(ctx.timeline[0].fromStatus, "pending_payment");
  assert.equal(ctx.timeline[0].toStatus, "confirmed");
  assert.equal(ctx.timeline[0].note, "Payment captured");
});

test("customers cannot directly move orders into refunded status", async (t) => {
  const ctx = patchLifecycleModels();
  t.after(ctx.restore);
  const order = buildOrder({ status: "confirmed" });

  await assert.rejects(
    transitionOrderDocument(order, {
      actor: { actorType: "customer" },
      toStatus: "refunded",
    }),
    /Customers can only cancel eligible orders/,
  );
  assert.equal(ctx.timeline.length, 0);
});

test("order cancellation releases reserved stock and records timeline", async (t) => {
  const ctx = patchLifecycleModels({ available: 0, reserved: 2 });
  t.after(ctx.restore);
  const warehouseId = ctx.warehouseId;
  const order = buildOrder({
    stockReservations: [
      {
        quantity: 2,
        sku: "TVH-CANCEL-M-0001",
        status: "reserved",
        warehouseId: new Types.ObjectId(warehouseId),
      },
    ],
    status: "confirmed",
  });

  await transitionOrderDocument(order, {
    actor: { actorType: "customer" },
    note: "Changed my mind",
    toStatus: "cancelled",
  });

  assert.equal(order.status, "cancelled");
  assert.equal(order.stockReservations[0].status, "released");
  assert.equal(ctx.ledger.available, 2);
  assert.equal(ctx.ledger.reserved, 0);
  assert.deepEqual(
    ctx.inventoryLogs.map((log) => log.eventType),
    ["release"],
  );
  assert.equal(ctx.timeline[0].toStatus, "cancelled");
});

function patchLifecycleModels(input: { available?: number; reserved?: number } = {}) {
  const originalTimelineCreate = OrderTimeline.create;
  const originalStockFindOne = StockLedger.findOne;
  const originalStockFindOneAndUpdate = StockLedger.findOneAndUpdate;
  const originalInventoryLogCreate = InventoryLog.create;
  const originalLowStockFindOne = LowStockAlert.findOne;
  const originalLowStockCreate = LowStockAlert.create;
  const originalLowStockUpdateMany = LowStockAlert.updateMany;
  const warehouseId = String(new Types.ObjectId());
  const timeline: Array<Record<string, unknown>> = [];
  const inventoryLogs: Array<Record<string, unknown>> = [];
  const ledger = {
    _id: new Types.ObjectId(),
    available: input.available ?? 0,
    damaged: 0,
    incoming: 0,
    lowStockThreshold: 0,
    reserved: input.reserved ?? 0,
    returned: 0,
    sku: "TVH-CANCEL-M-0001",
    warehouseId,
  };

  (OrderTimeline as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    timeline.push(payload);
    return Promise.resolve(payload);
  };
  (StockLedger as unknown as { findOne: unknown }).findOne = (filter: LedgerFilter) => {
    const found = matchesLedger(ledger, filter) ? ledger : null;

    return {
      lean() {
        return Promise.resolve(found ? { ...found } : null);
      },
    };
  };
  (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    filter: LedgerFilter,
    update: { $inc?: Partial<Record<"available" | "reserved", number>> },
  ) => {
    if (!matchesLedger(ledger, filter)) {
      return Promise.resolve(null);
    }

    for (const [field, amount] of Object.entries(update.$inc ?? {})) {
      ledger[field as "available" | "reserved"] += amount;
    }

    return Promise.resolve(ledger);
  };
  (InventoryLog as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    inventoryLogs.push(payload);
    return Promise.resolve(payload);
  };
  (LowStockAlert as unknown as { findOne: unknown }).findOne = () => Promise.resolve(null);
  (LowStockAlert as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve(payload);
  (LowStockAlert as unknown as { updateMany: unknown }).updateMany = () =>
    Promise.resolve({ modifiedCount: 0 });

  return {
    inventoryLogs,
    ledger,
    timeline,
    warehouseId,
    restore() {
      (OrderTimeline as unknown as { create: unknown }).create = originalTimelineCreate;
      (StockLedger as unknown as { findOne: unknown }).findOne = originalStockFindOne;
      (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
        originalStockFindOneAndUpdate;
      (InventoryLog as unknown as { create: unknown }).create = originalInventoryLogCreate;
      (LowStockAlert as unknown as { findOne: unknown }).findOne = originalLowStockFindOne;
      (LowStockAlert as unknown as { create: unknown }).create = originalLowStockCreate;
      (LowStockAlert as unknown as { updateMany: unknown }).updateMany = originalLowStockUpdateMany;
    },
  };
}

function buildOrder(input: {
  status: OrderStatus;
  stockReservations?: Array<{
    quantity: number;
    sku: string;
    status: "reserved" | "released" | "deducted";
    warehouseId?: Types.ObjectId;
  }>;
}) {
  const order = {
    _id: new Types.ObjectId(),
    orderNumber: `TVH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    save: async () => order,
    shipment: undefined,
    status: input.status,
    stockReservations: input.stockReservations ?? [],
    userId: new Types.ObjectId(),
  };

  return order as Parameters<typeof transitionOrderDocument>[0];
}

type LedgerFilter = {
  reserved?: { $gte?: number };
  sku?: string;
  warehouseId?: string;
};

function matchesLedger(
  ledger: { reserved: number; sku: string; warehouseId: string },
  filter: LedgerFilter,
) {
  if (filter.sku && filter.sku !== ledger.sku) {
    return false;
  }
  if (filter.warehouseId && String(filter.warehouseId) !== ledger.warehouseId) {
    return false;
  }
  if (filter.reserved?.$gte !== undefined && ledger.reserved < filter.reserved.$gte) {
    return false;
  }
  return true;
}
