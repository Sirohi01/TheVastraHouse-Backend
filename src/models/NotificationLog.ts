import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { notificationChannels } from "./NotificationTemplate.js";

export const notificationLogStatuses = ["sent", "failed", "skipped"] as const;

const notificationLogSchema = new Schema(
  {
    eventType: { type: String, required: true, trim: true, index: true },
    channel: { type: String, enum: notificationChannels, required: true },
    to: { type: String, required: true, trim: true, index: true },
    subject: { type: String, trim: true },
    status: { type: String, enum: notificationLogStatuses, required: true },
    error: { type: String, trim: true },
    relatedEntity: {
      type: { type: String, trim: true },
      id: { type: Schema.Types.ObjectId },
    },
  },
  { timestamps: true },
);

notificationLogSchema.index({ createdAt: -1 });

export type NotificationLogDocument = InferSchemaType<typeof notificationLogSchema>;

export const NotificationLog =
  mongoose.models.NotificationLog || mongoose.model("NotificationLog", notificationLogSchema);
