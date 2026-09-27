import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const refundMethods = ["original_payment", "store_credit", "bank_transfer"] as const;
export const refundStatuses = ["pending", "processed", "rejected"] as const;

const refundSchema = new Schema(
  {
    returnRequestId: { type: Schema.Types.ObjectId, ref: "ReturnRequest" },
    source: { type: String, enum: ["return", "cancellation"], default: "return", index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    guestEmail: { type: String, trim: true, lowercase: true },
    paymentSessionId: { type: Schema.Types.ObjectId, ref: "PaymentSession" },
    amount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    method: { type: String, enum: refundMethods, required: true },
    status: { type: String, enum: refundStatuses, required: true, default: "pending", index: true },
    gatewayRefundId: { type: String, trim: true, index: true },
    gatewayRefundIds: [{ type: String, trim: true }],
    storeCreditReference: { type: String, trim: true },
    bankTransferReference: { type: String, trim: true },
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    processedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

// A return may be refunded once; a cancellation may be refunded once per order.
refundSchema.index(
  { returnRequestId: 1 },
  { unique: true, partialFilterExpression: { returnRequestId: { $exists: true } } },
);
refundSchema.index(
  { orderId: 1, source: 1 },
  { unique: true, partialFilterExpression: { source: "cancellation" } },
);

export type RefundDocument = InferSchemaType<typeof refundSchema>;

export const Refund = mongoose.models.Refund || mongoose.model("Refund", refundSchema);
