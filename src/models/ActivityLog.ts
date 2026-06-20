import mongoose, { Schema, type InferSchemaType } from "mongoose";

const activityLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: {
      type: String,
      enum: ["customer", "admin", "system"],
      required: true,
    },
    activity: { type: String, required: true, trim: true },
    module: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now, immutable: true, index: true },
  },
  {
    versionKey: false,
  },
);

activityLogSchema.index({ actorId: 1, createdAt: -1 });
activityLogSchema.index({ module: 1, createdAt: -1 });

export type ActivityLogDocument = InferSchemaType<typeof activityLogSchema>;

export const ActivityLog =
  mongoose.models.ActivityLog || mongoose.model("ActivityLog", activityLogSchema);
