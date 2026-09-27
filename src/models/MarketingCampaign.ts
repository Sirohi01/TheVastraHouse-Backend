import mongoose, { Schema } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

/**
 * Email campaigns (newsletter blasts, festival campaigns, segment campaigns). A festival
 * campaign bundles a scheduled storefront banner, an email and an optional coupon.
 */
const marketingCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["newsletter", "festival", "segment"], default: "segment" },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    previewText: { type: String, trim: true, maxlength: 200 },
    bodyHtml: { type: String, required: true },
    audience: {
      type: {
        type: String,
        enum: ["segment", "newsletter", "all_consented", "custom_segment"],
        default: "segment",
      },
      segment: { type: String, trim: true },
      customSegmentId: { type: Schema.Types.ObjectId, ref: "CustomerSegment" },
    },
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon" },
    banner: {
      enabled: { type: Boolean, default: false },
      title: { type: String, trim: true },
      text: { type: String, trim: true },
      href: { type: String, trim: true },
      media: mediaReferenceSchema,
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    scheduledAt: { type: Date, index: true },
    campaignStatus: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "cancelled"],
      default: "draft",
      index: true,
    },
    utmCampaign: { type: String, trim: true, lowercase: true },
    stats: {
      recipients: { type: Number, default: 0 },
      queued: { type: Number, default: 0 },
      attributedOrders: { type: Number, default: 0 },
      attributedRevenue: { type: Number, default: 0 },
    },
    sentAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const MarketingCampaign =
  mongoose.models.MarketingCampaign || mongoose.model("MarketingCampaign", marketingCampaignSchema);

/** Settings for the always-on automations (abandoned cart, win-back, review request, welcome). */
const automationSettingSchema = new Schema(
  {
    key: {
      type: String,
      enum: ["abandoned_cart", "win_back", "review_request", "welcome", "back_in_stock"],
      required: true,
    },
    enabled: { type: Boolean, default: true },
    delayHours: { type: Number, min: 0, default: 1 },
    couponCode: { type: String, trim: true, uppercase: true },
    lastRunAt: { type: Date },
    sentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
automationSettingSchema.index({ key: 1 }, { unique: true });

export const AutomationSetting =
  mongoose.models.AutomationSetting || mongoose.model("AutomationSetting", automationSettingSchema);

/** Custom segment defined by a Marketing Manager as a combination of rules. */
const customerSegmentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    rules: {
      minOrders: { type: Number, min: 0 },
      maxOrders: { type: Number, min: 0 },
      minSpend: { type: Number, min: 0 },
      maxSpend: { type: Number, min: 0 },
      lastOrderWithinDays: { type: Number, min: 0 },
      noOrderForDays: { type: Number, min: 0 },
      customerType: { type: String, enum: ["retail", "wholesale"] },
      tags: [{ type: String, trim: true, lowercase: true }],
      marketingConsentOnly: { type: Boolean, default: true },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const CustomerSegment =
  mongoose.models.CustomerSegment || mongoose.model("CustomerSegment", customerSegmentSchema);
