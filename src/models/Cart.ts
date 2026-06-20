import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

const cartLineItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    productName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    purchaseMode: {
      type: String,
      enum: ["regular", "pre_order"],
      required: true,
      default: "regular",
      index: true,
    },
    color: { type: String, trim: true },
    size: { type: String, trim: true },
    barcode: { type: String, trim: true },
    media: mediaReferenceSchema,
    unitPrice: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    hsnCode: { type: String, trim: true, default: "" },
    gstRate: { type: Number, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    stockSnapshot: { type: Number, required: true, min: 0 },
    preOrder: {
      enabled: { type: Boolean, default: false },
      startAt: { type: Date },
      endAt: { type: Date },
      expectedDispatchAt: { type: Date },
      expectedDeliveryAt: { type: Date },
      paymentMode: { type: String, enum: ["full", "advance"] },
      advancePercent: { type: Number, min: 1, max: 99 },
      quantityCap: { type: Number, min: 0 },
      remainingQuantity: { type: Number, min: 0 },
    },
    preOrderOption: {
      enabled: { type: Boolean, default: false },
      startAt: { type: Date },
      endAt: { type: Date },
      expectedDispatchAt: { type: Date },
      expectedDeliveryAt: { type: Date },
      paymentMode: { type: String, enum: ["full", "advance"] },
      advancePercent: { type: Number, min: 1, max: 99 },
      quantityCap: { type: Number, min: 0 },
      remainingQuantity: { type: Number, min: 0 },
    },
    priceSnapshotAt: { type: Date, required: true, default: Date.now },
  },
  { _id: true },
);

const giftPackagingSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    fee: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const giftCardRedemptionSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    amount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
  },
  { _id: false },
);

const cartTotalsSchema = new Schema(
  {
    subtotal: { type: Number, min: 0, default: 0 },
    giftPackagingFee: { type: Number, min: 0, default: 0 },
    giftCardDiscount: { type: Number, min: 0, default: 0 },
    grandTotal: { type: Number, min: 0, default: 0 },
    gstAmount: { type: Number, min: 0, default: 0 },
    taxableAmount: { type: Number, min: 0, default: 0 },
    taxBreakdown: [
      {
        _id: false,
        gstRate: { type: Number, min: 0, default: 0 },
        gstAmount: { type: Number, min: 0, default: 0 },
        taxableAmount: { type: Number, min: 0, default: 0 },
      },
    ],
    currencyCode: { type: String, trim: true, uppercase: true, default: "INR" },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestSessionId: { type: String, trim: true },
    items: [cartLineItemSchema],
    giftPackaging: { type: giftPackagingSchema, default: () => ({}) },
    giftCardRedemptions: [giftCardRedemptionSchema],
    totals: { type: cartTotalsSchema, default: () => ({}) },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    abandonedCartEventEmittedAt: { type: Date },
  },
  { timestamps: true },
);

cartSchema.index({ userId: 1 }, { unique: true, sparse: true });
cartSchema.index({ guestSessionId: 1 }, { unique: true, sparse: true });
cartSchema.index({ lastActivityAt: 1, abandonedCartEventEmittedAt: 1 });

export type CartDocument = InferSchemaType<typeof cartSchema>;

export const Cart = mongoose.models.Cart || mongoose.model("Cart", cartSchema);
