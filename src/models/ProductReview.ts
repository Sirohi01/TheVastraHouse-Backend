import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const productReviewSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestName: { type: String, trim: true },
    guestEmail: { type: String, trim: true, lowercase: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true },
    body: { type: String, required: true, trim: true },
    photos: [mediaReferenceSchema],
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    verifiedPurchase: { type: Boolean, default: false },
    moderatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    moderatedAt: { type: Date },
    moderationNote: { type: String, trim: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(productReviewSchema);
productReviewSchema.index({ productId: 1, moderationStatus: 1, status: 1, createdAt: -1 });

export type ProductReviewDocument = InferSchemaType<typeof productReviewSchema>;

export const ProductReview =
  mongoose.models.ProductReview || mongoose.model("ProductReview", productReviewSchema);
