import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const seoSchema = new Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
    ogImage: mediaReferenceSchema,
  },
  { _id: false },
);

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Category" },
    description: { type: String, trim: true },
    banner: mediaReferenceSchema,
    seo: seoSchema,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(categorySchema);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
