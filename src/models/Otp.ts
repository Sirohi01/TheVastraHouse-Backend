import mongoose, { Schema, type InferSchemaType } from "mongoose";

const otpSchema = new Schema(
  {
    target: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: {
      type: String,
      enum: ["registration", "login", "password-reset", "sensitive-action"],
      required: true,
      index: true,
    },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true, index: true },
    consumedAt: { type: Date },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

otpSchema.index({ target: 1, purpose: 1, consumedAt: 1 });

export type OtpDocument = InferSchemaType<typeof otpSchema>;

export const Otp = mongoose.models.Otp || mongoose.model("Otp", otpSchema);
