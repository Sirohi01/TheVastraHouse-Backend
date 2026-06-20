import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const inventoryEventTypes = [
  "reserve",
  "release",
  "deduct",
  "restock",
  "return",
  "damage",
  "adjustment",
  "transfer_out",
  "transfer_in",
  "incoming",
] as const;

const inventoryLogSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true, index: true },
    eventType: { type: String, enum: inventoryEventTypes, required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    before: {
      available: { type: Number, required: true, min: 0 },
      reserved: { type: Number, required: true, min: 0 },
      damaged: { type: Number, required: true, min: 0 },
      returned: { type: Number, required: true, min: 0 },
      incoming: { type: Number, required: true, min: 0 },
    },
    after: {
      available: { type: Number, required: true, min: 0 },
      reserved: { type: Number, required: true, min: 0 },
      damaged: { type: Number, required: true, min: 0 },
      returned: { type: Number, required: true, min: 0 },
      incoming: { type: Number, required: true, min: 0 },
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: { type: String, enum: ["customer", "admin", "system"], required: true },
    reasonCode: { type: String, trim: true },
    referenceType: { type: String, trim: true },
    referenceId: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

inventoryLogSchema.index({ sku: 1, warehouseId: 1, createdAt: -1 });

export type InventoryLogDocument = InferSchemaType<typeof inventoryLogSchema>;

export const InventoryLog =
  mongoose.models.InventoryLog || mongoose.model("InventoryLog", inventoryLogSchema);
