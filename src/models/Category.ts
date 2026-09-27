import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { contentFaqSchema, seoFieldsSchema } from "./shared/seo.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Category" },
    description: { type: String, trim: true },
    banner: mediaReferenceSchema,
    seo: seoFieldsSchema,
    introContent: { type: String, trim: true, maxlength: 4000 },
    bottomContent: { type: String, trim: true, maxlength: 12000 },
    faqs: [contentFaqSchema],
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(categorySchema);

export type CategoryDocument = InferSchemaType<typeof categorySchema>;

export const Category = mongoose.models.Category || mongoose.model("Category", categorySchema);
