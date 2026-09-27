import mongoose, { Schema } from "mongoose";

/**
 * First-party, aggregate-only traffic counter (one row per day and source). Stores no IPs,
 * cookies or user identifiers; it exists so the dashboard can compute conversion rate and
 * traffic-source mix (FR-RPT-01/02) even when third-party analytics is declined.
 */
const siteVisitDailySchema = new Schema(
  {
    date: { type: String, required: true },
    source: { type: String, required: true, trim: true, lowercase: true, default: "direct" },
    medium: { type: String, trim: true, lowercase: true, default: "none" },
    sessions: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);

siteVisitDailySchema.index({ date: 1, source: 1, medium: 1 }, { unique: true });

export const SiteVisitDaily =
  mongoose.models.SiteVisitDaily || mongoose.model("SiteVisitDaily", siteVisitDailySchema);
