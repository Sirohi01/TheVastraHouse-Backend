import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { FabricInventory } from "../models/FabricInventory.js";
import { ProductionOrder } from "../models/ProductionOrder.js";
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
    return await ProductionOrder.create({
      ...input,
      expectedCompletionAt: input.expectedCompletionAt,
      fabricQuantityRequired: fabricRequired,
      history: [{ actorId: new Types.ObjectId(input.actorId), stage: "order_received" }],
      productionOrderNumber: `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      trackerIds: input.trackerIds?.map((id) => new Types.ObjectId(id)),
      vendorIds: input.vendorIds?.map((id) => new Types.ObjectId(id)),
      ...costing,
    });
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

export async function updateProductionOrderStage(input: {
  id: string;
  stage: ProductionStage;
  actorId: string;
  note?: string;
}, trackerUpdater: typeof updateProductionStage = updateProductionStage) {
  const productionOrder = await ProductionOrder.findById(input.id);
  if (!productionOrder) throw new AppError("Production order not found", 404);
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
  return productionOrder;
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
