import mongoose, { Schema, type InferSchemaType } from "mongoose";

const paymentWebhookEventSchema = new Schema(
  {
    provider: { type: String, required: true, trim: true, default: "razorpay" },
    eventId: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    signatureVerified: { type: Boolean, required: true, default: false },
    processedAt: { type: Date },
    paymentSessionId: { type: Schema.Types.ObjectId, ref: "PaymentSession" },
    payload: { type: Schema.Types.Mixed },
    error: { type: String, trim: true },
  },
  { timestamps: true },
);

paymentWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type PaymentWebhookEventDocument = InferSchemaType<typeof paymentWebhookEventSchema>;

export const PaymentWebhookEvent =
  mongoose.models.PaymentWebhookEvent ||
  mongoose.model("PaymentWebhookEvent", paymentWebhookEventSchema);
