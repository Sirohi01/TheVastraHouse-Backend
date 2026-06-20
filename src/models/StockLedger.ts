import mongoose, { Schema, type InferSchemaType } from "mongoose";

const stockLedgerSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true, index: true },
    available: { type: Number, required: true, min: 0, default: 0 },
    reserved: { type: Number, required: true, min: 0, default: 0 },
    damaged: { type: Number, required: true, min: 0, default: 0 },
    returned: { type: Number, required: true, min: 0, default: 0 },
    incoming: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

stockLedgerSchema.index({ sku: 1, warehouseId: 1 }, { unique: true });

export type StockLedgerDocument = InferSchemaType<typeof stockLedgerSchema>;

export const StockLedger =
  mongoose.models.StockLedger || mongoose.model("StockLedger", stockLedgerSchema);
