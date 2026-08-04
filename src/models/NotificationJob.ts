import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { notificationChannels } from "./NotificationTemplate.js";

export const notificationJobStatuses = ["pending", "sent", "failed", "skipped"] as const;

const notificationJobSchema = new Schema(
  {
    eventType: { type: String, required: true, trim: true },
    channel: { type: String, enum: notificationChannels, required: true },
    to: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    relatedEntity: {
      type: { type: String, trim: true },
      id: { type: Schema.Types.ObjectId },
    },
    status: { type: String, enum: notificationJobStatuses, required: true, default: "pending" },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, trim: true },
    nextAttemptAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true },
);

notificationJobSchema.index({ status: 1, nextAttemptAt: 1 });

export type NotificationJobDocument = InferSchemaType<typeof notificationJobSchema>;

export const NotificationJob =
  mongoose.models.NotificationJob || mongoose.model("NotificationJob", notificationJobSchema);
