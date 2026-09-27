import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { contentFaqSchema, seoFieldsSchema } from "./shared/seo.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const collectionSchema = new Schema(
  {
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
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

applySoftDeleteFields(collectionSchema);
collectionSchema.index({ brandId: 1, slug: 1 }, { unique: true });

export type CollectionDocument = InferSchemaType<typeof collectionSchema>;

export const Collection =
  mongoose.models.Collection || mongoose.model("Collection", collectionSchema);
