import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const storeCreditTransactionTypes = ["issue", "redeem", "admin_adjust"] as const;
export const storeCreditSourceTypes = ["return", "admin", "order"] as const;

const storeCreditTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: storeCreditTransactionTypes, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    sourceType: { type: String, enum: storeCreditSourceTypes, required: true },
    sourceId: { type: Schema.Types.ObjectId },
    orderNumber: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

storeCreditTransactionSchema.index({ userId: 1, createdAt: -1 });

export type StoreCreditTransactionDocument = InferSchemaType<typeof storeCreditTransactionSchema>;

export const StoreCreditTransaction =
  mongoose.models.StoreCreditTransaction ||
  mongoose.model("StoreCreditTransaction", storeCreditTransactionSchema);
