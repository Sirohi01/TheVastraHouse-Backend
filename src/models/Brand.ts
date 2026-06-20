import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const brandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    settings: {
      defaultCurrencyCode: { type: String, uppercase: true, trim: true, default: "INR" },
      supportEmail: { type: String, lowercase: true, trim: true },
      timezone: { type: String, trim: true, default: "Asia/Kolkata" },
    },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(brandSchema);

export type BrandDocument = InferSchemaType<typeof brandSchema>;

export const Brand = mongoose.models.Brand || mongoose.model("Brand", brandSchema);
