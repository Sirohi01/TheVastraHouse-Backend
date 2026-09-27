import mongoose, { Schema } from "mongoose";

const redirectSchema = new Schema(
  {
    source: { type: String, required: true, trim: true, lowercase: true },
    destination: { type: String, required: true, trim: true },
    statusCode: { type: Number, enum: [301, 302, 308], default: 301 },
    active: { type: Boolean, default: true },
    origin: { type: String, enum: ["manual", "slug-change"], default: "manual" },
    hits: { type: Number, default: 0 },
    lastHitAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

redirectSchema.index({ source: 1 }, { unique: true });
redirectSchema.index({ active: 1 });

export const Redirect = mongoose.models.Redirect || mongoose.model("Redirect", redirectSchema);
