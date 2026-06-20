import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { addressSchema } from "./shared/address.js";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

export const orderStatuses = [
  "pending_payment",
  "payment_verification_pending",
  "payment_rejected",
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
  "refunded",
] as const;

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    productName: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    media: mediaReferenceSchema,
    hsnCode: { type: String, required: true, trim: true },
    gstRate: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0, default: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineSubtotal: { type: Number, required: true, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    preOrder: {
      enabled: { type: Boolean, default: false },
      expectedDispatchAt: { type: Date },
      expectedDeliveryAt: { type: Date },
      paymentMode: { type: String, enum: ["full", "advance"] },
    },
  },
  { _id: false },
);

const adjustmentSchema = new Schema(
  {
    code: { type: String, trim: true },
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["coupon", "store_credit", "reward", "gift_card", "shipping", "gift_packaging"],
      required: true,
    },
    amount: { type: Number, required: true },
  },
  { _id: false },
);

const taxBreakdownSchema = new Schema(
  {
    gstRate: { type: Number, required: true, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const totalsSchema = new Schema(
  {
    itemSubtotal: { type: Number, required: true, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, required: true, min: 0 },
    giftPackagingFee: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0 },
    giftCardDiscount: { type: Number, required: true, min: 0 },
    storeCreditApplied: { type: Number, required: true, min: 0 },
    rewardValueApplied: { type: Number, required: true, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
  },
  { _id: false },
);

const stockReservationSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["reserved", "released", "deducted"],
      required: true,
      default: "reserved",
    },
    reservedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    carrier: { type: String, trim: true },
    trackingNumber: { type: String, trim: true },
    trackingUrl: { type: String, trim: true },
    dispatchedAt: { type: Date },
    deliveredAt: { type: Date },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    guestEmail: { type: String, lowercase: true, trim: true, index: true },
    guestSessionId: { type: String, trim: true, index: true },
    cartId: { type: Schema.Types.ObjectId, ref: "Cart" },
    paymentSessionId: { type: Schema.Types.ObjectId, ref: "PaymentSession" },
    status: { type: String, enum: orderStatuses, required: true, index: true },
    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "manual_bank_transfer", "upi"],
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ["full", "advance", "balance"],
      required: true,
      default: "full",
    },
    shippingMethod: {
      type: String,
      enum: ["standard", "express"],
      required: true,
      default: "standard",
    },
    shippingAddress: addressSchema,
    billingAddress: addressSchema,
    items: [orderItemSchema],
    adjustments: [adjustmentSchema],
    taxBreakdown: [taxBreakdownSchema],
    totals: totalsSchema,
    shipment: shipmentSchema,
    stockReservations: [stockReservationSchema],
    notes: { type: String, trim: true },
    balancePaymentNotifiedAt: { type: Date },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

export type OrderDocument = InferSchemaType<typeof orderSchema>;

export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
