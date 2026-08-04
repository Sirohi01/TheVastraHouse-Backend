import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const notificationChannels = ["email", "whatsapp"] as const;

const notificationTemplateSchema = new Schema(
  {
    eventType: { type: String, required: true, trim: true, index: true },
    channel: { type: String, enum: notificationChannels, required: true },
    subject: { type: String, trim: true },
    body: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

notificationTemplateSchema.index({ eventType: 1, channel: 1 }, { unique: true });

export type NotificationTemplateDocument = InferSchemaType<typeof notificationTemplateSchema>;

export const NotificationTemplate =
  mongoose.models.NotificationTemplate ||
  mongoose.model("NotificationTemplate", notificationTemplateSchema);
