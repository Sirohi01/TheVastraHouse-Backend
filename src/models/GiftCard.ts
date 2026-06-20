import mongoose, { Schema, type InferSchemaType } from "mongoose";

const giftCardSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    balance: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    status: {
      type: String,
      enum: ["active", "disabled", "expired"],
      required: true,
      default: "active",
    },
    issuedToUserId: { type: Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

giftCardSchema.index({ code: 1, status: 1 });

export type GiftCardDocument = InferSchemaType<typeof giftCardSchema>;

export const GiftCard = mongoose.models.GiftCard || mongoose.model("GiftCard", giftCardSchema);
