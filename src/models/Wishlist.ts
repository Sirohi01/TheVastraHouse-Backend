import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

const wishlistItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    productName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    media: mediaReferenceSchema,
    priceSnapshot: { type: Number, required: true, min: 0 },
    currentPrice: { type: Number, required: true, min: 0 },
    stockSnapshot: { type: Number, required: true, min: 0 },
    currentStock: { type: Number, required: true, min: 0 },
    priceChanged: { type: Boolean, default: false },
    stockChanged: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
    checkedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const wishlistSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestSessionId: { type: String, trim: true },
    items: [wishlistItemSchema],
  },
  { timestamps: true },
);

wishlistSchema.index({ userId: 1 }, { unique: true, sparse: true });
wishlistSchema.index({ guestSessionId: 1 }, { unique: true, sparse: true });

export type WishlistDocument = InferSchemaType<typeof wishlistSchema>;

export const Wishlist = mongoose.models.Wishlist || mongoose.model("Wishlist", wishlistSchema);
