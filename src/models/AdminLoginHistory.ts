import mongoose, { Schema, type InferSchemaType } from "mongoose";

const adminLoginHistorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    success: { type: Boolean, required: true, index: true },
    failureReason: { type: String, trim: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now, immutable: true, index: true },
  },
  { versionKey: false },
);

export type AdminLoginHistoryDocument = InferSchemaType<typeof adminLoginHistorySchema>;

export const AdminLoginHistory =
  mongoose.models.AdminLoginHistory || mongoose.model("AdminLoginHistory", adminLoginHistorySchema);
