import mongoose, { Schema, type InferSchemaType } from "mongoose";

const giftCardTransactionSchema = new Schema(
  {
    giftCardId: { type: Schema.Types.ObjectId, ref: "GiftCard", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    type: { type: String, enum: ["issue", "redeem", "restore", "adjust", "expire"], required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    orderNumber: { type: String, trim: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

// One redemption and one restore per card per order keeps retries idempotent.
giftCardTransactionSchema.index(
  { giftCardId: 1, orderNumber: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: { $in: ["redeem", "restore"] } } },
);

export type GiftCardTransactionDocument = InferSchemaType<typeof giftCardTransactionSchema>;
export const GiftCardTransaction =
  mongoose.models.GiftCardTransaction ||
  mongoose.model("GiftCardTransaction", giftCardTransactionSchema);
