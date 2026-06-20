import mongoose, { Schema, type InferSchemaType } from "mongoose";

const stockTransferSchema = new Schema(
  {
    transferNumber: { type: String, required: true, unique: true, trim: true, index: true },
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    sourceWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    destinationWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    status: {
      type: String,
      enum: ["in_transit", "received", "cancelled"],
      required: true,
      default: "in_transit",
      index: true,
    },
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    receivedBy: { type: Schema.Types.ObjectId, ref: "User" },
    initiatedAt: { type: Date, required: true, default: Date.now },
    receivedAt: { type: Date },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

stockTransferSchema.index({ sourceWarehouseId: 1, status: 1 });
stockTransferSchema.index({ destinationWarehouseId: 1, status: 1 });

export type StockTransferDocument = InferSchemaType<typeof stockTransferSchema>;

export const StockTransfer =
  mongoose.models.StockTransfer || mongoose.model("StockTransfer", stockTransferSchema);
