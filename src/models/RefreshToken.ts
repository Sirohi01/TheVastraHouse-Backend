import mongoose, { Schema, type InferSchemaType } from "mongoose";

const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    familyId: { type: String, required: true, index: true },
    deviceId: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
    reusedAt: { type: Date },
    replacedByTokenHash: { type: String, select: false },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, familyId: 1 });

export type RefreshTokenDocument = InferSchemaType<typeof refreshTokenSchema>;

export const RefreshToken =
  mongoose.models.RefreshToken || mongoose.model("RefreshToken", refreshTokenSchema);
