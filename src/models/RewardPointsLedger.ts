import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const rewardPointsLedgerTypes = ["earn", "redeem", "expire", "adjust"] as const;

const rewardPointsLedgerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: rewardPointsLedgerTypes, required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    orderNumber: { type: String, trim: true },
    reason: { type: String, trim: true },
  },
  { timestamps: true },
);

rewardPointsLedgerSchema.index({ userId: 1, createdAt: -1 });

export type RewardPointsLedgerDocument = InferSchemaType<typeof rewardPointsLedgerSchema>;

export const RewardPointsLedger =
  mongoose.models.RewardPointsLedger ||
  mongoose.model("RewardPointsLedger", rewardPointsLedgerSchema);
