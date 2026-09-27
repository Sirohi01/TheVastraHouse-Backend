import mongoose, { Schema } from "mongoose";

/** Distributed lease so a scheduled job runs on exactly one API instance at a time. */
const jobLockSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    owner: { type: String, required: true },
    lockedUntil: { type: Date, required: true },
    lastStartedAt: { type: Date },
    lastFinishedAt: { type: Date },
    lastDurationMs: { type: Number },
    lastError: { type: String },
    lastErrorAt: { type: Date },
    runCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    lastResult: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);

export const JobLock = mongoose.models.JobLock || mongoose.model("JobLock", jobLockSchema);
