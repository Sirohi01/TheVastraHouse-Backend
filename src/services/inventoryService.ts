import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { InventoryLog, type inventoryEventTypes } from "../models/InventoryLog.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { StockLedger } from "../models/StockLedger.js";
import { StockTransfer } from "../models/StockTransfer.js";
import { writeAuditLog } from "./auditLogService.js";

type StockState = {
  available: number;
  reserved: number;
  damaged: number;
  returned: number;
  incoming: number;
};

type InventoryActor = {
  actorId?: string;
  actorType: "customer" | "admin" | "system";
  ipAddress?: string;
  userAgent?: string;
};

type StockEventInput = {
  sku: string;
  warehouseId: string;
  quantity: number;
  actor: InventoryActor;
  reasonCode?: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
};

const stockStateFields = ["available", "reserved", "damaged", "returned", "incoming"] as const;
type InventoryEventType = (typeof inventoryEventTypes)[number];

export async function upsertStockLedger(input: {
  sku: string;
  warehouseId: string;
  available?: number;
  reserved?: number;
  damaged?: number;
  returned?: number;
  incoming?: number;
  lowStockThreshold?: number;
  actor: InventoryActor;
}) {
  const sku = normalizeSku(input.sku);
  const existing = await StockLedger.findOne({ sku, warehouseId: input.warehouseId });
  const before = existing ? snapshot(existing) : zeroStock();
  const ledger =
    existing ??
    new StockLedger({
      sku,
      warehouseId: input.warehouseId,
    });

  for (const field of stockStateFields) {
    if (input[field] !== undefined) {
      ledger[field] = input[field]!;
    }
  }
  if (input.lowStockThreshold !== undefined) {
    ledger.lowStockThreshold = input.lowStockThreshold;
  }

  await ledger.save();
  await recordStockEvent("adjustment", {
    actor: input.actor,
    metadata: { after: snapshot(ledger), before },
    quantity: Object.values(snapshot(ledger)).reduce((total, value) => total + value, 0),
    reasonCode: "ledger-upsert",
    sku,
    warehouseId: input.warehouseId,
  });
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function getAvailableStockBySku(sku: string) {
  const ledgers = await StockLedger.find({ sku: normalizeSku(sku) }).lean();

  if (!ledgers.length) {
    return undefined;
  }

  return ledgers.reduce((total, ledger) => total + ledger.available, 0);
}

export async function reserveStock(input: StockEventInput) {
  const ledger = await atomicMove({
    filterField: "available",
    from: "available",
    input,
    to: "reserved",
    type: "reserve",
  });
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function releaseReservedStock(input: StockEventInput) {
  const ledger = await atomicMove({
    filterField: "reserved",
    from: "reserved",
    input,
    to: "available",
    type: "release",
  });
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function deductReservedStock(input: StockEventInput) {
  const ledger = await atomicMove({
    filterField: "reserved",
    from: "reserved",
    input,
    to: undefined,
    type: "deduct",
  });
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function restockReturnedStock(input: StockEventInput) {
  const ledger = await atomicMove({
    filterField: "returned",
    from: "returned",
    input,
    to: "available",
    type: "restock",
  });
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function markReturnedStock(input: StockEventInput) {
  const ledger = await incrementStock(input, { returned: input.quantity }, "return");
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function markDamagedStock(input: StockEventInput) {
  const ledger = await incrementStock(input, { damaged: input.quantity }, "damage");
  await evaluateLowStockAlert(ledger);
  return ledger;
}

export async function adjustStock(input: StockEventInput & { state: keyof StockState }) {
  if (!input.reasonCode) {
    throw new AppError("Stock adjustment reason code is required", 400);
  }

  const ledger = await incrementStock(input, { [input.state]: input.quantity }, "adjustment");
  await evaluateLowStockAlert(ledger);
  await writeAuditLog({
    action: "update",
    actor: {
      actorId: input.actor.actorId ? new Types.ObjectId(input.actor.actorId) : undefined,
      actorType: input.actor.actorType,
      ipAddress: input.actor.ipAddress,
      userAgent: input.actor.userAgent,
    },
    after: snapshot(ledger),
    before: undefined,
    entity: { id: ledger._id, type: "stock-ledger", displayId: normalizeSku(input.sku) },
    metadata: { reasonCode: input.reasonCode, state: input.state },
  });
  return ledger;
}

export async function createStockTransfer(input: {
  sku: string;
  quantity: number;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  actor: InventoryActor;
  notes?: string;
}) {
  if (input.sourceWarehouseId === input.destinationWarehouseId) {
    throw new AppError("Transfer warehouses must be different", 400);
  }

  const transferNumber = buildTransferNumber();
  await atomicMove({
    filterField: "available",
    from: "available",
    input: {
      actor: input.actor,
      quantity: input.quantity,
      referenceId: transferNumber,
      referenceType: "stock-transfer",
      sku: input.sku,
      warehouseId: input.sourceWarehouseId,
    },
    to: undefined,
    type: "transfer_out",
  });
  await incrementStock(
    {
      actor: input.actor,
      quantity: input.quantity,
      referenceId: transferNumber,
      referenceType: "stock-transfer",
      sku: input.sku,
      warehouseId: input.destinationWarehouseId,
    },
    { incoming: input.quantity },
    "incoming",
  );

  return StockTransfer.create({
    destinationWarehouseId: input.destinationWarehouseId,
    initiatedBy: input.actor.actorId,
    notes: input.notes,
    quantity: input.quantity,
    sku: normalizeSku(input.sku),
    sourceWarehouseId: input.sourceWarehouseId,
    status: "in_transit",
    transferNumber,
  });
}

export async function receiveStockTransfer(input: { transferId: string; actor: InventoryActor }) {
  const transfer = await StockTransfer.findById(input.transferId);

  if (!transfer) {
    throw new AppError("Stock transfer not found", 404);
  }

  if (transfer.status !== "in_transit") {
    throw new AppError("Stock transfer is not in transit", 409);
  }

  await atomicMove({
    filterField: "incoming",
    from: "incoming",
    input: {
      actor: input.actor,
      quantity: transfer.quantity,
      referenceId: transfer.transferNumber,
      referenceType: "stock-transfer",
      sku: transfer.sku,
      warehouseId: String(transfer.destinationWarehouseId),
    },
    to: "available",
    type: "transfer_in",
  });

  transfer.status = "received";
  transfer.receivedAt = new Date();
  transfer.receivedBy = input.actor.actorId ? new Types.ObjectId(input.actor.actorId) : undefined;
  await transfer.save();
  return transfer;
}

export async function reserveOrderStock(input: {
  items: Array<{ sku: string; quantity: number }>;
  actor: InventoryActor;
  referenceId: string;
}) {
  const reservations = [];

  for (const item of input.items) {
    const ledger = await findPrimaryLedger(item.sku);
    if (!ledger) {
      reservations.push({
        quantity: item.quantity,
        reservedAt: new Date(),
        sku: normalizeSku(item.sku),
        status: "reserved",
      });
      continue;
    }

    await reserveStock({
      actor: input.actor,
      quantity: item.quantity,
      referenceId: input.referenceId,
      referenceType: "order",
      sku: item.sku,
      warehouseId: String(ledger.warehouseId),
    });
    reservations.push({
      quantity: item.quantity,
      reservedAt: new Date(),
      sku: normalizeSku(item.sku),
      status: "reserved",
      warehouseId: ledger.warehouseId,
    });
  }

  return reservations;
}

export async function deductOrderReservedStock(input: {
  reservations: Array<{ sku: string; quantity: number; warehouseId?: unknown }>;
  actor: InventoryActor;
  referenceId: string;
}) {
  for (const reservation of input.reservations) {
    if (!reservation.warehouseId) {
      continue;
    }

    await deductReservedStock({
      actor: input.actor,
      quantity: reservation.quantity,
      referenceId: input.referenceId,
      referenceType: "order",
      sku: reservation.sku,
      warehouseId: String(reservation.warehouseId),
    });
  }
}

export async function releaseOrderStock(input: {
  reservations: Array<{ sku: string; quantity: number; warehouseId?: unknown; status?: string }>;
  actor: InventoryActor;
  referenceId: string;
}) {
  for (const reservation of input.reservations) {
    if (!reservation.warehouseId) {
      continue;
    }

    if (reservation.status === "deducted") {
      await adjustStock({
        actor: input.actor,
        quantity: reservation.quantity,
        reasonCode: "order-cancellation-restock",
        referenceId: input.referenceId,
        referenceType: "order",
        sku: reservation.sku,
        state: "available",
        warehouseId: String(reservation.warehouseId),
      });
      continue;
    }

    await releaseReservedStock({
      actor: input.actor,
      quantity: reservation.quantity,
      reasonCode: "order-cancellation-release",
      referenceId: input.referenceId,
      referenceType: "order",
      sku: reservation.sku,
      warehouseId: String(reservation.warehouseId),
    });
  }
}

export async function runLowStockAlertJob() {
  const ledgers = await StockLedger.find({});
  let alertsOpened = 0;
  let alertsResolved = 0;

  for (const ledger of ledgers) {
    const result = await evaluateLowStockAlert(ledger);
    if (result === "opened") {
      alertsOpened += 1;
    } else if (result === "resolved") {
      alertsResolved += 1;
    }
  }

  return { ledgersChecked: ledgers.length, alertsOpened, alertsResolved };
}

async function atomicMove(input: {
  input: StockEventInput;
  from: keyof StockState;
  to?: keyof StockState;
  filterField: keyof StockState;
  type: InventoryEventType;
}) {
  assertQuantity(input.input.quantity);
  const sku = normalizeSku(input.input.sku);
  const before = (await StockLedger.findOne({
    [input.filterField]: { $gte: input.input.quantity },
    sku,
    warehouseId: input.input.warehouseId,
  }).lean()) as StockState | null;

  if (!before) {
    throw new AppError("Insufficient inventory for stock operation", 409);
  }

  const update: Record<string, number> = { [input.from]: -input.input.quantity };
  if (input.to) {
    update[input.to] = input.input.quantity;
  }

  const after = await StockLedger.findOneAndUpdate(
    {
      [input.filterField]: { $gte: input.input.quantity },
      sku,
      warehouseId: input.input.warehouseId,
    },
    { $inc: update },
    { new: true },
  );

  if (!after) {
    throw new AppError("Insufficient inventory for stock operation", 409);
  }

  await recordStockEvent(input.type, input.input, before, after);
  return after;
}

async function incrementStock(
  input: StockEventInput,
  increment: Partial<Record<keyof StockState, number>>,
  type: InventoryEventType,
) {
  assertQuantity(input.quantity);
  const sku = normalizeSku(input.sku);
  const before =
    ((await StockLedger.findOne({
      sku,
      warehouseId: input.warehouseId,
    }).lean()) as StockState | null) ?? zeroStock();
  const after = await StockLedger.findOneAndUpdate(
    { sku, warehouseId: input.warehouseId },
    {
      $inc: increment,
      $setOnInsert: { lowStockThreshold: 0, sku, warehouseId: input.warehouseId },
    },
    { new: true, upsert: true },
  );

  await recordStockEvent(type, { ...input, sku }, before, after);
  return after;
}

async function recordStockEvent(
  eventType: InventoryEventType,
  input: StockEventInput,
  beforeOverride?: StockState,
  afterOverride?: StockState,
) {
  const before =
    beforeOverride ?? (input.metadata?.before as StockState | undefined) ?? zeroStock();
  const after = afterOverride ?? (input.metadata?.after as StockState | undefined) ?? before;

  return InventoryLog.create({
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    after: pickStockState(after),
    before: pickStockState(before),
    eventType,
    metadata: input.metadata,
    quantity: input.quantity,
    reasonCode: input.reasonCode,
    referenceId: input.referenceId,
    referenceType: input.referenceType,
    sku: normalizeSku(input.sku),
    warehouseId: input.warehouseId,
  });
}

async function evaluateLowStockAlert(ledger: {
  sku: string;
  warehouseId: unknown;
  available: number;
  lowStockThreshold: number;
}) {
  if (ledger.lowStockThreshold <= 0) {
    return "ignored";
  }

  if (ledger.available <= ledger.lowStockThreshold) {
    const existing = await LowStockAlert.findOne({
      sku: ledger.sku,
      status: "open",
      warehouseId: ledger.warehouseId,
    });

    if (existing) {
      existing.available = ledger.available;
      existing.threshold = ledger.lowStockThreshold;
      await existing.save();
      return "updated";
    }

    await LowStockAlert.create({
      available: ledger.available,
      sku: ledger.sku,
      threshold: ledger.lowStockThreshold,
      warehouseId: ledger.warehouseId,
    });
    return "opened";
  }

  const result = await LowStockAlert.updateMany(
    { sku: ledger.sku, status: "open", warehouseId: ledger.warehouseId },
    { $set: { resolvedAt: new Date(), status: "resolved" } },
  );

  return result.modifiedCount > 0 ? "resolved" : "ignored";
}

async function findPrimaryLedger(sku: string) {
  return StockLedger.findOne({ sku: normalizeSku(sku), available: { $gt: 0 } }).sort({
    available: -1,
    updatedAt: 1,
  });
}

function snapshot(value: Partial<StockState>) {
  return pickStockState(value);
}

function pickStockState(value: Partial<StockState>): StockState {
  return {
    available: value.available ?? 0,
    damaged: value.damaged ?? 0,
    incoming: value.incoming ?? 0,
    reserved: value.reserved ?? 0,
    returned: value.returned ?? 0,
  };
}

function zeroStock(): StockState {
  return {
    available: 0,
    damaged: 0,
    incoming: 0,
    reserved: 0,
    returned: 0,
  };
}

function normalizeSku(sku: string) {
  return sku.trim().toUpperCase();
}

function assertQuantity(quantity: number) {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new AppError("Inventory quantity must be a positive integer", 400);
  }
}

function buildTransferNumber() {
  const date = new Date();
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

  return `TRF-${stamp}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
