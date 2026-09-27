import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const rewardPointsLedgerTypes = [
  "earn",
  "redeem",
  "expire",
  "adjust",
  "restore",
  "reversal",
] as const;

const rewardPointsLedgerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: rewardPointsLedgerTypes, required: true },
    points: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    orderNumber: { type: String, trim: true },
    reason: { type: String, trim: true },
    // FIFO bucket bookkeeping for earn/restore entries (enables expiry and reversals).
    remaining: { type: Number, min: 0 },
    expiresAt: { type: Date, index: true },
    expiredAt: { type: Date },
  },
  { timestamps: true },
);

rewardPointsLedgerSchema.index({ userId: 1, createdAt: -1 });
rewardPointsLedgerSchema.index({ userId: 1, remaining: 1, expiresAt: 1 });
rewardPointsLedgerSchema.index(
  { userId: 1, orderNumber: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderNumber: { $exists: true },
      type: { $in: ["earn", "reversal", "restore"] },
    },
  },
);

export type RewardPointsLedgerDocument = InferSchemaType<typeof rewardPointsLedgerSchema>;

export const RewardPointsLedger =
  mongoose.models.RewardPointsLedger ||
  mongoose.model("RewardPointsLedger", rewardPointsLedgerSchema);
