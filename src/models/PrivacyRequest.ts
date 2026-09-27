import mongoose, { Schema } from "mongoose";

/** Phase 34 data-subject requests (export / deletion). */
const privacyRequestSchema = new Schema(
  {
    requestNumber: { type: String, required: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    type: { type: String, enum: ["export", "deletion"], required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "rejected"],
      default: "pending",
      index: true,
    },
    reason: { type: String, trim: true, maxlength: 1000 },
    resolutionNote: { type: String, trim: true, maxlength: 2000 },
    exportData: { type: Schema.Types.Mixed, select: false },
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date },
    dueAt: { type: Date, required: true },
  },
  { timestamps: true },
);

privacyRequestSchema.index({ requestNumber: 1 }, { unique: true });

export const PrivacyRequest =
  mongoose.models.PrivacyRequest || mongoose.model("PrivacyRequest", privacyRequestSchema);
