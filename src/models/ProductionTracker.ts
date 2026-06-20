import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { productionStages } from "./Product.js";

const productionTrackerSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    stage: { type: String, enum: productionStages, required: true, default: "order_received" },
    expectedDispatchAt: { type: Date },
    expectedDeliveryAt: { type: Date },
    history: [
      {
        stage: { type: String, enum: productionStages, required: true },
        note: { type: String, trim: true },
        actorId: { type: Schema.Types.ObjectId, ref: "User" },
        actorType: { type: String, enum: ["customer", "admin", "system"], required: true },
        createdAt: { type: Date, required: true, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

productionTrackerSchema.index({ stage: 1, createdAt: -1 });
productionTrackerSchema.index({ orderId: 1, variantId: 1 }, { unique: true });

export type ProductionTrackerDocument = InferSchemaType<typeof productionTrackerSchema>;

export const ProductionTracker =
  mongoose.models.ProductionTracker || mongoose.model("ProductionTracker", productionTrackerSchema);
