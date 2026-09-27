import mongoose, { Schema } from "mongoose";

const rateLimitBucketSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// MongoDB removes buckets shortly after their window closes.
rateLimitBucketSchema.index({ resetAt: 1 }, { expireAfterSeconds: 60 });

export const RateLimitBucket =
  mongoose.models.RateLimitBucket || mongoose.model("RateLimitBucket", rateLimitBucketSchema);
