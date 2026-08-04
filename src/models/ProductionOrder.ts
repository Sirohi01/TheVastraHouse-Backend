import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { productionStages } from "./Product.js";

const costsSchema = new Schema(
  {
    fabric: { type: Number, min: 0, default: 0 },
    labor: { type: Number, min: 0, default: 0 },
    printing: { type: Number, min: 0, default: 0 },
    packaging: { type: Number, min: 0, default: 0 },
    courier: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const productionOrderSchema = new Schema(
  {
    productionOrderNumber: { type: String, required: true, unique: true, index: true },
    demandType: { type: String, enum: ["preorder", "restock"], required: true, index: true },
    demandReference: { type: String, required: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    trackerIds: [{ type: Schema.Types.ObjectId, ref: "ProductionTracker" }],
    vendorIds: [{ type: Schema.Types.ObjectId, ref: "ManufacturingVendor" }],
    fabricInventoryId: { type: Schema.Types.ObjectId, ref: "FabricInventory" },
    fabricQuantityRequired: { type: Number, min: 0, default: 0 },
    stage: { type: String, enum: productionStages, default: "order_received", index: true },
    costs: { type: costsSchema, default: () => ({}) },
    sellingPricePerUnit: { type: Number, min: 0, required: true },
    totalCost: { type: Number, min: 0, default: 0 },
    projectedRevenue: { type: Number, min: 0, default: 0 },
    grossMargin: { type: Number, default: 0 },
    grossMarginPercent: { type: Number, default: 0 },
    expectedCompletionAt: { type: Date },
    notes: { type: String, trim: true },
    history: [
      {
        stage: { type: String, enum: productionStages, required: true },
        note: { type: String, trim: true },
        actorId: { type: Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now, required: true },
      },
    ],
  },
  { timestamps: true },
);

export type ProductionOrderDocument = InferSchemaType<typeof productionOrderSchema>;
export const ProductionOrder =
  mongoose.models.ProductionOrder || mongoose.model("ProductionOrder", productionOrderSchema);
