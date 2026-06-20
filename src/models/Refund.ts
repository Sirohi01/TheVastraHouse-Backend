import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const refundMethods = ["original_payment", "store_credit", "bank_transfer"] as const;
export const refundStatuses = ["pending", "processed", "rejected"] as const;

const refundSchema = new Schema(
  {
    returnRequestId: {
      type: Schema.Types.ObjectId,
      ref: "ReturnRequest",
      required: true,
      unique: true,
      index: true,
    },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    paymentSessionId: { type: Schema.Types.ObjectId, ref: "PaymentSession", required: true },
    amount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    method: { type: String, enum: refundMethods, required: true },
    status: { type: String, enum: refundStatuses, required: true, default: "pending", index: true },
    gatewayRefundId: { type: String, trim: true },
    storeCreditReference: { type: String, trim: true },
    bankTransferReference: { type: String, trim: true },
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    processedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export type RefundDocument = InferSchemaType<typeof refundSchema>;

export const Refund = mongoose.models.Refund || mongoose.model("Refund", refundSchema);
