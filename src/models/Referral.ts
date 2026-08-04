import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const referralStatuses = ["pending", "qualified", "rewarded"] as const;

const referralSchema = new Schema(
  {
    referrerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    referredUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: referralStatuses, required: true, default: "pending" },
    qualifyingOrderNumber: { type: String, trim: true },
    rewardIssuedAt: { type: Date },
  },
  { timestamps: true },
);

referralSchema.index({ referredUserId: 1 }, { unique: true });

export type ReferralDocument = InferSchemaType<typeof referralSchema>;

export const Referral = mongoose.models.Referral || mongoose.model("Referral", referralSchema);
