import mongoose, { Schema, type InferSchemaType } from "mongoose";

const paymentHistorySchema = new Schema(
  {
    paymentSessionId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentSession",
      required: true,
      index: true,
    },
    orderReference: { type: String, required: true, trim: true, index: true },
    method: { type: String, required: true, trim: true },
    event: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0, default: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    gatewayTransactionId: { type: String, trim: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: {
      type: String,
      enum: ["customer", "admin", "system"],
      required: true,
      default: "system",
    },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export type PaymentHistoryDocument = InferSchemaType<typeof paymentHistorySchema>;

export const PaymentHistory =
  mongoose.models.PaymentHistory || mongoose.model("PaymentHistory", paymentHistorySchema);
