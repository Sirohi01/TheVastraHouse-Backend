import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { FabricInventory } from "../models/FabricInventory.js";
import { ProductionOrder } from "../models/ProductionOrder.js";
import { StockLedger } from "../models/StockLedger.js";
import { getDefaultWarehouse } from "./catalogPublicService.js";
import { adjustStock } from "./inventoryService.js";
import type { ProductionStage } from "./preOrderService.js";
import { updateProductionStage } from "./preOrderService.js";

export type CostInputs = {
  fabric: number;
  labor: number;
  printing: number;
  packaging: number;
  courier: number;
};

export function calculateProductionCosting(input: {
  costs: CostInputs;
  quantity: number;
  sellingPricePerUnit: number;
}) {
  const totalCost = roundMoney(Object.values(input.costs).reduce((sum, value) => sum + value, 0));
  const projectedRevenue = roundMoney(input.quantity * input.sellingPricePerUnit);
  const grossMargin = roundMoney(projectedRevenue - totalCost);
  const grossMarginPercent = projectedRevenue
    ? roundMoney((grossMargin / projectedRevenue) * 100)
    : 0;
  return { grossMargin, grossMarginPercent, projectedRevenue, totalCost };
}

export async function createProductionOrder(input: {
  demandType: "preorder" | "restock";
  demandReference: string;
  productId: string;
  variantId: string;
  sku: string;
  quantity: number;
  trackerIds?: string[];
  vendorIds?: string[];
  fabricInventoryId?: string;
  fabricQuantityRequired?: number;
  costs: CostInputs;
  sellingPricePerUnit: number;
  expectedCompletionAt?: Date;
  notes?: string;
  actorId: string;
}) {
  if (input.demandType === "preorder" && !input.trackerIds?.length) {
    throw new AppError("Pre-order production requires at least one tracker", 400);
  }
  const fabricRequired = input.fabricQuantityRequired ?? 0;
  if (fabricRequired > 0) {
    if (!input.fabricInventoryId) throw new AppError("Fabric inventory is required", 400);
    const fabric = await FabricInventory.findOneAndUpdate(
      {
        _id: new Types.ObjectId(input.fabricInventoryId),
        active: true,
        $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, fabricRequired] },
      },
      { $inc: { reserved: fabricRequired } },
      { new: true },
    );
    if (!fabric) throw new AppError("Insufficient available fabric stock", 409);
  }

  try {
    const costing = calculateProductionCosting(input);
    const warehouse = input.demandType === "restock" ? await getDefaultWarehouse() : undefined;
    const created = await ProductionOrder.create({
      warehouseId: warehouse?._id,
      ...input,
      expectedCompletionAt: input.expectedCompletionAt,
      fabricQuantityRequired: fabricRequired,
      history: [{ actorId: new Types.ObjectId(input.actorId), stage: "order_received" }],
      productionOrderNumber: `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      trackerIds: input.trackerIds?.map((id) => new Types.ObjectId(id)),
      vendorIds: input.vendorIds?.map((id) => new Types.ObjectId(id)),
      ...costing,
    });

    // Restock runs show up as incoming stock so planners can see what is being made.
    if (warehouse) {
      await adjustStock({
        actor: { actorId: input.actorId, actorType: "admin" },
        quantity: input.quantity,
        reasonCode: "production-order-incoming",
        referenceId: created.productionOrderNumber,
        referenceType: "production-order",
        sku: input.sku,
        state: "incoming",
        warehouseId: String(warehouse._id),
      });
      created.incomingPostedAt = new Date();
      await created.save();
    }

    return created;
  } catch (error) {
    if (fabricRequired > 0 && input.fabricInventoryId) {
      await FabricInventory.updateOne(
        { _id: new Types.ObjectId(input.fabricInventoryId) },
        { $inc: { reserved: -fabricRequired } },
      );
    }
    throw error;
  }
}

export async function updateProductionOrderStage(
  input: {
    id: string;
    stage: ProductionStage;
    actorId: string;
    note?: string;
  },
  trackerUpdater: typeof updateProductionStage = updateProductionStage,
) {
  const productionOrder = await ProductionOrder.findById(input.id);
  if (!productionOrder) throw new AppError("Production order not found", 404);
  if (productionOrder.status === "cancelled") {
    throw new AppError("This production order was cancelled", 409);
  }
  const trackerIds = (productionOrder.trackerIds as Types.ObjectId[]).map(String);
  if (trackerIds.length) {
    await trackerUpdater({
      actor: { actorId: input.actorId, actorType: "admin" },
      note: input.note,
      stage: input.stage,
      trackerIds,
    });
  }
  productionOrder.stage = input.stage;
  productionOrder.history.push({
    actorId: new Types.ObjectId(input.actorId),
    note: input.note,
    stage: input.stage,
  });
  await productionOrder.save();

  if (input.stage === "dispatch") {
    await completeProductionOrder(String(productionOrder._id), input.actorId);
  }

  return ProductionOrder.findById(input.id);
}

/**
 * Completion (final "dispatch" stage): consumes the reserved fabric and, for restock runs,
 * converts incoming stock into sellable stock. Each side effect is claimed once so repeating
 * the stage update can never double-post inventory.
 */
export async function completeProductionOrder(id: string, actorId: string) {
  const fabricClaim = await ProductionOrder.findOneAndUpdate(
    { _id: id, fabricConsumedAt: { $exists: false } },
    { $set: { fabricConsumedAt: new Date() } },
    { new: true },
  );

  if (fabricClaim?.fabricInventoryId && fabricClaim.fabricQuantityRequired > 0) {
    await FabricInventory.updateOne(
      { _id: fabricClaim.fabricInventoryId },
      {
        $inc: {
          onHand: -fabricClaim.fabricQuantityRequired,
          reserved: -fabricClaim.fabricQuantityRequired,
        },
      },
    );
  }

  const stockClaim = await ProductionOrder.findOneAndUpdate(
    { _id: id, demandType: "restock", stockPostedAt: { $exists: false } },
    { $set: { stockPostedAt: new Date() } },
    { new: true },
  );

  if (stockClaim?.warehouseId) {
    await StockLedger.updateOne(
      {
        incoming: { $gte: stockClaim.quantity },
        sku: stockClaim.sku,
        warehouseId: stockClaim.warehouseId,
      },
      { $inc: { incoming: -stockClaim.quantity } },
    );
    await adjustStock({
      actor: { actorId, actorType: "admin" },
      quantity: stockClaim.quantity,
      reasonCode: "production-order-received",
      referenceId: stockClaim.productionOrderNumber,
      referenceType: "production-order",
      sku: stockClaim.sku,
      state: "available",
      warehouseId: String(stockClaim.warehouseId),
    });
  }

  await ProductionOrder.updateOne(
    { _id: id, status: "open" },
    { $set: { completedAt: new Date(), status: "completed" } },
  );
}

/** Cancels an open production run and releases its fabric reservation and incoming stock. */
export async function cancelProductionOrder(id: string, actorId: string, reason: string) {
  const order = await ProductionOrder.findOneAndUpdate(
    { _id: id, status: "open" },
    { $set: { cancellationReason: reason, cancelledAt: new Date(), status: "cancelled" } },
    { new: true },
  );

  if (!order) throw new AppError("Only open production orders can be cancelled", 409);

  if (order.fabricInventoryId && order.fabricQuantityRequired > 0) {
    await FabricInventory.updateOne(
      { _id: order.fabricInventoryId, reserved: { $gte: order.fabricQuantityRequired } },
      { $inc: { reserved: -order.fabricQuantityRequired } },
    );
  }

  if (order.warehouseId && order.incomingPostedAt) {
    await StockLedger.updateOne(
      { incoming: { $gte: order.quantity }, sku: order.sku, warehouseId: order.warehouseId },
      { $inc: { incoming: -order.quantity } },
    );
  }

  order.history.push({
    actorId: new Types.ObjectId(actorId),
    note: "Cancelled: " + reason,
    stage: order.stage,
  });
  await order.save();
  return order;
}

export async function listFabricAlerts() {
  return FabricInventory.aggregate([
    { $match: { active: true } },
    { $addFields: { available: { $subtract: ["$onHand", "$reserved"] } } },
    { $match: { $expr: { $lte: ["$available", "$reorderThreshold"] } } },
    { $sort: { available: 1 } },
  ]);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
