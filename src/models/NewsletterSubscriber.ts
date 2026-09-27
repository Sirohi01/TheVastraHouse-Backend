import mongoose, { Schema } from "mongoose";

const newsletterSubscriberSchema = new Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    status: {
      type: String,
      enum: ["subscribed", "unsubscribed"],
      default: "subscribed",
      index: true,
    },
    source: { type: String, trim: true, default: "footer" },
    consentText: { type: String, trim: true },
    consentAt: { type: Date, required: true },
    unsubscribedAt: { type: Date },
    unsubscribeToken: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    ipAddress: { type: String, trim: true },
  },
  { timestamps: true },
);

newsletterSubscriberSchema.index({ email: 1 }, { unique: true });
newsletterSubscriberSchema.index({ unsubscribeToken: 1 }, { unique: true });

export const NewsletterSubscriber =
  mongoose.models.NewsletterSubscriber ||
  mongoose.model("NewsletterSubscriber", newsletterSubscriberSchema);
