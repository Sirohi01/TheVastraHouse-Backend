import mongoose, { Schema, type InferSchemaType } from "mongoose";

const storeCreditIssueSchema = new Schema(
  {
    reference: { type: String, required: true, trim: true, unique: true, index: true },
    returnRequestId: { type: Schema.Types.ObjectId, ref: "ReturnRequest", required: true },
    refundId: { type: Schema.Types.ObjectId, ref: "Refund", required: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    status: { type: String, enum: ["issued"], required: true, default: "issued" },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export type StoreCreditIssueDocument = InferSchemaType<typeof storeCreditIssueSchema>;

export const StoreCreditIssue =
  mongoose.models.StoreCreditIssue || mongoose.model("StoreCreditIssue", storeCreditIssueSchema);
