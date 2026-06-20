import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { addressSchema } from "./shared/address.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const warehouseSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true, index: true },
    address: { type: addressSchema, required: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(warehouseSchema);

warehouseSchema.index({ brandId: 1, name: 1 }, { unique: true });

export type WarehouseDocument = InferSchemaType<typeof warehouseSchema>;

export const Warehouse = mongoose.models.Warehouse || mongoose.model("Warehouse", warehouseSchema);
