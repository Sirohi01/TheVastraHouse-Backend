import mongoose, { Schema, type InferSchemaType } from "mongoose";

const paymentSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    upiId: { type: String, required: true, trim: true },
    upiQrImageUrl: { type: String, trim: true },
    bankAccountName: { type: String, trim: true },
    bankAccountNumber: { type: String, trim: true },
    bankIfsc: { type: String, trim: true, uppercase: true },
    bankName: { type: String, trim: true },
    manualInstructions: { type: String, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type PaymentSettingsDocument = InferSchemaType<typeof paymentSettingsSchema>;

export const PaymentSettings =
  mongoose.models.PaymentSettings || mongoose.model("PaymentSettings", paymentSettingsSchema);
