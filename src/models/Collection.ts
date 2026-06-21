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

const collectionSchema = new Schema(
  {
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    banner: mediaReferenceSchema,
    seo: seoSchema,
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(collectionSchema);
collectionSchema.index({ brandId: 1, slug: 1 }, { unique: true });

export type CollectionDocument = InferSchemaType<typeof collectionSchema>;

export const Collection =
  mongoose.models.Collection || mongoose.model("Collection", collectionSchema);
