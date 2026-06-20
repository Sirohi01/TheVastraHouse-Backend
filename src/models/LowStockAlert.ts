import mongoose, { Schema, type InferSchemaType } from "mongoose";

const lowStockAlertSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true, index: true },
    threshold: { type: Number, required: true, min: 0 },
    available: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["open", "resolved"],
      required: true,
      default: "open",
      index: true,
    },
    triggeredAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

lowStockAlertSchema.index({ sku: 1, warehouseId: 1, status: 1 });

export type LowStockAlertDocument = InferSchemaType<typeof lowStockAlertSchema>;

export const LowStockAlert =
  mongoose.models.LowStockAlert || mongoose.model("LowStockAlert", lowStockAlertSchema);
