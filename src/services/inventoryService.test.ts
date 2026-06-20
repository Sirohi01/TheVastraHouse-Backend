import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { InventoryLog } from "../models/InventoryLog.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { StockLedger } from "../models/StockLedger.js";
import { StockTransfer } from "../models/StockTransfer.js";
import {
  createStockTransfer,
  deductReservedStock,
  markDamagedStock,
  markReturnedStock,
  receiveStockTransfer,
  releaseReservedStock,
  reserveStock,
  restockReturnedStock,
} from "./inventoryService.js";

test("inventory service atomically reserves stock and prevents overselling", async (t) => {
  const ctx = patchInventoryModels();
  t.after(ctx.restore);
  ctx.addLedger({ available: 1, lowStockThreshold: 1, sku: "TVH-SILK-M-0001" });

  const results = await Promise.allSettled([
    reserveStock({
      actor: { actorType: "customer" },
      quantity: 1,
      referenceId: "cart-a",
      referenceType: "cart",
      sku: "tvh-silk-m-0001",
      warehouseId: ctx.warehouseId,
    }),
    reserveStock({
      actor: { actorType: "customer" },
      quantity: 1,
      referenceId: "cart-b",
      referenceType: "cart",
      sku: "tvh-silk-m-0001",
      warehouseId: ctx.warehouseId,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(ctx.ledger("TVH-SILK-M-0001").available, 0);
  assert.equal(ctx.ledger("TVH-SILK-M-0001").reserved, 1);
  assert.equal(ctx.logs.filter((log) => log.eventType === "reserve").length, 1);
  assert.equal(ctx.alerts.length, 1);
});

test("inventory lifecycle records reserve, deduct, return, restock, damage, and release events", async (t) => {
  const ctx = patchInventoryModels();
  t.after(ctx.restore);
  ctx.addLedger({ available: 4, reserved: 0, returned: 0, sku: "TVH-LIFE-M-0001" });

  await reserveStock({
    actor: { actorType: "customer" },
    quantity: 2,
    referenceId: "order-1",
    referenceType: "order",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  await deductReservedStock({
    actor: { actorType: "system" },
    quantity: 1,
    referenceId: "order-1",
    referenceType: "order",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  await releaseReservedStock({
    actor: { actorType: "admin" },
    quantity: 1,
    reasonCode: "cancelled-before-dispatch",
    referenceId: "order-1",
    referenceType: "order",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  await markReturnedStock({
    actor: { actorType: "admin" },
    quantity: 1,
    referenceId: "return-1",
    referenceType: "return",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  await restockReturnedStock({
    actor: { actorType: "admin" },
    quantity: 1,
    reasonCode: "qc-pass",
    referenceId: "return-1",
    referenceType: "return",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  await markDamagedStock({
    actor: { actorType: "admin" },
    quantity: 1,
    referenceId: "return-2",
    referenceType: "return",
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });

  assert.deepEqual(ctx.ledger("TVH-LIFE-M-0001"), {
    available: 4,
    damaged: 1,
    incoming: 0,
    lowStockThreshold: 0,
    reserved: 0,
    returned: 0,
    sku: "TVH-LIFE-M-0001",
    warehouseId: ctx.warehouseId,
  });
  assert.deepEqual(
    ctx.logs.map((log) => log.eventType),
    ["reserve", "deduct", "release", "return", "restock", "damage"],
  );
});

test("stock transfer moves source available into destination incoming then received available", async (t) => {
  const ctx = patchInventoryModels();
  t.after(ctx.restore);
  const destinationWarehouseId = String(new Types.ObjectId());
  ctx.addLedger({ available: 5, sku: "TVH-TRF-M-0001", warehouseId: ctx.warehouseId });
  ctx.addLedger({ available: 0, sku: "TVH-TRF-M-0001", warehouseId: destinationWarehouseId });

  const transfer = await createStockTransfer({
    actor: { actorType: "admin" },
    destinationWarehouseId,
    quantity: 3,
    sku: "TVH-TRF-M-0001",
    sourceWarehouseId: ctx.warehouseId,
  });
  await receiveStockTransfer({ actor: { actorType: "admin" }, transferId: String(transfer._id) });

  assert.equal(ctx.ledger("TVH-TRF-M-0001", ctx.warehouseId).available, 2);
  assert.equal(ctx.ledger("TVH-TRF-M-0001", destinationWarehouseId).incoming, 0);
  assert.equal(ctx.ledger("TVH-TRF-M-0001", destinationWarehouseId).available, 3);
  assert.deepEqual(
    ctx.logs.map((log) => log.eventType),
    ["transfer_out", "incoming", "transfer_in"],
  );
});

function patchInventoryModels() {
  const originalFindOne = StockLedger.findOne;
  const originalFindOneAndUpdate = StockLedger.findOneAndUpdate;
  const originalLogCreate = InventoryLog.create;
  const originalAlertFindOne = LowStockAlert.findOne;
  const originalAlertCreate = LowStockAlert.create;
  const originalAlertUpdateMany = LowStockAlert.updateMany;
  const originalTransferCreate = StockTransfer.create;
  const originalTransferFindById = StockTransfer.findById;
  const warehouseId = String(new Types.ObjectId());
  const ledgers = new Map<string, LedgerState>();
  const logs: Array<Record<string, unknown>> = [];
  const alerts: Array<Record<string, unknown>> = [];
  const transfers = new Map<string, Record<string, unknown> & { save: () => Promise<unknown> }>();

  (StockLedger as unknown as { findOne: unknown }).findOne = (filter: LedgerFilter) => {
    const ledger = findLedger(ledgers, filter);

    return {
      lean() {
        return Promise.resolve(ledger ? { ...ledger } : null);
      },
      sort() {
        return Promise.resolve(ledger ?? null);
      },
    };
  };
  (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    filter: LedgerFilter,
    update: {
      $inc?: Partial<Record<keyof LedgerState, number>>;
      $setOnInsert?: Partial<LedgerState>;
    },
  ) => {
    let ledger = findLedger(ledgers, filter);
    if (!ledger && update.$setOnInsert) {
      ledger = {
        available: 0,
        damaged: 0,
        incoming: 0,
        lowStockThreshold: 0,
        reserved: 0,
        returned: 0,
        sku: update.$setOnInsert.sku!,
        warehouseId: String(update.$setOnInsert.warehouseId),
      };
      ledgers.set(key(ledger.sku, ledger.warehouseId), ledger);
    }

    if (!ledger || !matchesFilter(ledger, filter)) {
      return Promise.resolve(null);
    }

    for (const [field, amount] of Object.entries(update.$inc ?? {})) {
      const stockField = field as StockNumberField;
      ledger[stockField] = ledger[stockField] + amount;
    }

    return Promise.resolve(ledger);
  };
  (InventoryLog as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    logs.push(payload);
    return Promise.resolve(payload);
  };
  (LowStockAlert as unknown as { findOne: unknown }).findOne = () => Promise.resolve(null);
  (LowStockAlert as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    alerts.push(payload);
    return Promise.resolve(payload);
  };
  (LowStockAlert as unknown as { updateMany: unknown }).updateMany = () =>
    Promise.resolve({ modifiedCount: 0 });
  (StockTransfer as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    const transfer = {
      ...payload,
      _id: new Types.ObjectId(),
      save: async () => transfer,
    };
    transfers.set(String(transfer._id), transfer);
    return Promise.resolve(transfer);
  };
  (StockTransfer as unknown as { findById: unknown }).findById = (id: string) =>
    Promise.resolve(transfers.get(id) ?? null);

  return {
    alerts,
    logs,
    warehouseId,
    addLedger(input: Partial<LedgerState> & { sku: string; warehouseId?: string }) {
      const ledger = {
        available: 0,
        damaged: 0,
        incoming: 0,
        lowStockThreshold: 0,
        reserved: 0,
        returned: 0,
        warehouseId,
        ...input,
        sku: input.sku.toUpperCase(),
      };
      ledgers.set(key(ledger.sku, ledger.warehouseId), ledger);
    },
    ledger(sku: string, nextWarehouseId = warehouseId) {
      return ledgers.get(key(sku, nextWarehouseId))!;
    },
    restore() {
      (StockLedger as unknown as { findOne: unknown }).findOne = originalFindOne;
      (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
        originalFindOneAndUpdate;
      (InventoryLog as unknown as { create: unknown }).create = originalLogCreate;
      (LowStockAlert as unknown as { findOne: unknown }).findOne = originalAlertFindOne;
      (LowStockAlert as unknown as { create: unknown }).create = originalAlertCreate;
      (LowStockAlert as unknown as { updateMany: unknown }).updateMany = originalAlertUpdateMany;
      (StockTransfer as unknown as { create: unknown }).create = originalTransferCreate;
      (StockTransfer as unknown as { findById: unknown }).findById = originalTransferFindById;
    },
  };
}

type LedgerState = {
  sku: string;
  warehouseId: string;
  available: number;
  reserved: number;
  damaged: number;
  returned: number;
  incoming: number;
  lowStockThreshold: number;
};

type StockNumberField = "available" | "reserved" | "damaged" | "returned" | "incoming";

type LedgerFilter = {
  sku?: string;
  warehouseId?: string;
  available?: { $gt?: number; $gte?: number };
  reserved?: { $gte?: number };
  returned?: { $gte?: number };
  incoming?: { $gte?: number };
};

function findLedger(ledgers: Map<string, LedgerState>, filter: LedgerFilter) {
  const candidates = [...ledgers.values()].filter((ledger) => matchesFilter(ledger, filter));
  return candidates.sort((left, right) => right.available - left.available)[0] ?? null;
}

function matchesFilter(ledger: LedgerState, filter: LedgerFilter) {
  if (filter.sku && ledger.sku !== filter.sku.toUpperCase()) {
    return false;
  }
  if (filter.warehouseId && ledger.warehouseId !== String(filter.warehouseId)) {
    return false;
  }
  return (
    matchesNumberFilter(ledger.available, filter.available) &&
    matchesNumberFilter(ledger.reserved, filter.reserved) &&
    matchesNumberFilter(ledger.returned, filter.returned) &&
    matchesNumberFilter(ledger.incoming, filter.incoming)
  );
}

function matchesNumberFilter(value: number, filter?: { $gt?: number; $gte?: number }) {
  if (!filter) {
    return true;
  }
  if (filter.$gt !== undefined && value <= filter.$gt) {
    return false;
  }
  if (filter.$gte !== undefined && value < filter.$gte) {
    return false;
  }
  return true;
}

function key(sku: string, warehouseId: string) {
  return `${sku.toUpperCase()}::${warehouseId}`;
}
