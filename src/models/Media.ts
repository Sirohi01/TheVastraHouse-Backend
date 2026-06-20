import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { aspectRatios } from "./shared/mediaReference.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const renditionSchema = new Schema(
  {
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    url: { type: String, required: true, trim: true },
    format: { type: String, trim: true },
  },
  { _id: false },
);

const mediaSchema = new Schema(
  {
    originalUrl: { type: String, required: true, trim: true },
    secureUrl: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true, unique: true },
    resourceType: { type: String, enum: ["image", "video", "raw"], required: true },
    deliveryType: { type: String, enum: ["upload", "authenticated"], default: "upload" },
    uploadContext: {
      type: String,
      enum: ["product-media", "payment-screenshot", "review-photo", "catalog-pdf"],
      required: true,
    },
    mimeType: { type: String, required: true, trim: true },
    bytes: { type: Number, required: true },
    selectedAspectRatio: { type: String, enum: aspectRatios, required: true },
    customAspectRatio: {
      width: { type: Number, min: 1 },
      height: { type: Number, min: 1 },
    },
    objectFit: { type: String, enum: ["cover", "contain"], default: "cover" },
    altText: { type: String, required: true, trim: true },
    tags: [{ type: String, trim: true, lowercase: true }],
    renditions: [renditionSchema],
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    scanStatus: { type: String, enum: ["clean", "rejected"], required: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(mediaSchema);

mediaSchema.index({ tags: 1 });

export type MediaDocument = InferSchemaType<typeof mediaSchema>;

export const Media = mongoose.models.Media || mongoose.model("Media", mediaSchema);
