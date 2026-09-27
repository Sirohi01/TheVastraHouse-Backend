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

const attributionSchema = new Schema(
  {
    utmSource: { type: String, trim: true },
    utmMedium: { type: String, trim: true },
    utmCampaign: { type: String, trim: true },
    referrer: { type: String, trim: true },
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
    provider: { type: String, enum: ["manual", "shiprocket"], default: "manual" },
    providerShipmentId: { type: String, trim: true },
    providerOrderId: { type: String, trim: true },
    labelUrl: { type: String, trim: true },
    courierStatus: { type: String, trim: true },
    events: [
      {
        _id: false,
        status: { type: String, trim: true },
        location: { type: String, trim: true },
        occurredAt: { type: Date },
      },
    ],
  },
  { _id: false },
);

const financialsSchema = new Schema(
  {
    couponRedemptionId: { type: Schema.Types.ObjectId, ref: "CouponRedemption" },
    storeCreditRedeemed: { type: Number, min: 0, default: 0 },
    rewardPointsRedeemed: { type: Number, min: 0, default: 0 },
    rewardPointsEarned: { type: Number, min: 0, default: 0 },
    giftCardRedemptions: [
      {
        _id: false,
        code: { type: String, trim: true, uppercase: true },
        amount: { type: Number, min: 0 },
      },
    ],
    referralRewardId: { type: Schema.Types.ObjectId, ref: "Referral" },
    reversedAt: { type: Date },
    reversalSummary: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const riskSchema = new Schema(
  {
    score: { type: Number, min: 0, default: 0 },
    flags: [{ type: String, trim: true }],
    status: { type: String, enum: ["clear", "flagged", "held", "released"], default: "clear" },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    guestEmail: { type: String, lowercase: true, trim: true, index: true },
    guestSessionId: { type: String, trim: true, index: true },
    whatsappOptIn: { type: Boolean, default: false },
    cartId: { type: Schema.Types.ObjectId, ref: "Cart" },
    paymentSessionId: { type: Schema.Types.ObjectId, ref: "PaymentSession" },
    status: { type: String, enum: orderStatuses, required: true, index: true },
    paymentMethod: {
      type: String,
      enum: ["razorpay", "cod", "manual_bank_transfer", "upi", "credit_terms"],
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
    couponCode: { type: String, trim: true, uppercase: true },
    financials: { type: financialsSchema, default: () => ({}) },
    risk: { type: riskSchema, default: () => ({}) },
    priceListCode: { type: String, trim: true, uppercase: true },
    customerType: { type: String, enum: ["retail", "wholesale"], default: "retail" },
    paymentTerms: { type: String, trim: true },
    reviewRequestSentAt: { type: Date },
    attribution: attributionSchema,
    balancePaymentNotifiedAt: { type: Date },
  },
  { timestamps: true },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ "risk.status": 1, createdAt: -1 });
orderSchema.index({ guestEmail: 1, createdAt: -1 });
orderSchema.index({ "attribution.utmSource": 1, createdAt: -1 });

export type OrderDocument = InferSchemaType<typeof orderSchema>;

export const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
