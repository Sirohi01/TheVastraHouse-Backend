import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const manufacturingVendorTypes = [
  "fabric",
  "tailor",
  "printing",
  "embroidery",
  "packaging",
] as const;

const manufacturingVendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: manufacturingVendorTypes, required: true, index: true },
    contactName: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    address: { type: String, trim: true },
    leadTimeDays: { type: Number, min: 0, default: 0 },
    notes: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

manufacturingVendorSchema.index({ name: 1, type: 1 }, { unique: true });

export type ManufacturingVendorDocument = InferSchemaType<typeof manufacturingVendorSchema>;
export const ManufacturingVendor =
  mongoose.models.ManufacturingVendor ||
  mongoose.model("ManufacturingVendor", manufacturingVendorSchema);
