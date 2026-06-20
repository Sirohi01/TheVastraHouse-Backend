import mongoose, { Schema, type InferSchemaType } from "mongoose";

const authTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    type: {
      type: String,
      enum: ["email-verification", "password-reset"],
      required: true,
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

authTokenSchema.index({ userId: 1, type: 1, usedAt: 1 });

export type AuthTokenDocument = InferSchemaType<typeof authTokenSchema>;

export const AuthToken = mongoose.models.AuthToken || mongoose.model("AuthToken", authTokenSchema);
