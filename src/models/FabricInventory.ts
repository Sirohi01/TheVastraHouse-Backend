import mongoose, { Schema, type InferSchemaType } from "mongoose";

const fabricInventorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true, unique: true },
    color: { type: String, trim: true },
    unit: { type: String, enum: ["meter", "yard", "kilogram", "piece"], default: "meter" },
    onHand: { type: Number, min: 0, default: 0 },
    reserved: { type: Number, min: 0, default: 0 },
    reorderThreshold: { type: Number, min: 0, default: 0 },
    costPerUnit: { type: Number, min: 0, default: 0 },
    vendorId: { type: Schema.Types.ObjectId, ref: "ManufacturingVendor" },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

fabricInventorySchema.index({ active: 1, onHand: 1 });

export type FabricInventoryDocument = InferSchemaType<typeof fabricInventorySchema>;
export const FabricInventory =
  mongoose.models.FabricInventory || mongoose.model("FabricInventory", fabricInventorySchema);
