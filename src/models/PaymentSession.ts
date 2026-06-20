import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

export const paymentMethods = ["razorpay", "cod", "manual_bank_transfer", "upi"] as const;
export const paymentStatuses = [
  "pending_payment",
  "payment_verification_pending",
  "payment_rejected",
  "confirmed",
  "cod_confirmed",
  "upi_pending",
  "partially_paid",
  "failed",
] as const;

const paymentSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    guestEmail: { type: String, lowercase: true, trim: true, index: true },
    guestSessionId: { type: String, trim: true, index: true },
    orderReference: { type: String, required: true, trim: true, index: true },
    method: { type: String, enum: paymentMethods, required: true, index: true },
    status: {
      type: String,
      enum: paymentStatuses,
      required: true,
      default: "pending_payment",
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    payableNow: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    paymentMode: {
      type: String,
      enum: ["full", "advance", "balance"],
      required: true,
      default: "full",
    },
    razorpayOrderId: { type: String, trim: true, index: true },
    razorpayPaymentId: { type: String, trim: true },
    razorpaySignature: { type: String, trim: true },
    manualScreenshot: mediaReferenceSchema,
    upiId: { type: String, trim: true },
    upiReference: { type: String, trim: true },
    codManualReviewRequired: { type: Boolean, default: false },
    rejectionReason: { type: String, trim: true },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date },
    failedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

paymentSessionSchema.index({ method: 1, status: 1, createdAt: -1 });
paymentSessionSchema.index({ razorpayOrderId: 1, razorpayPaymentId: 1 });

export type PaymentSessionDocument = InferSchemaType<typeof paymentSessionSchema>;

export const PaymentSession =
  mongoose.models.PaymentSession || mongoose.model("PaymentSession", paymentSessionSchema);
