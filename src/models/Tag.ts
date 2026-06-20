import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const tagSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(tagSchema);

export type TagDocument = InferSchemaType<typeof tagSchema>;

export const Tag = mongoose.models.Tag || mongoose.model("Tag", tagSchema);
