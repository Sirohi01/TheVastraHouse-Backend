import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const returnRequestStatuses = ["requested", "approved", "rejected", "refunded"] as const;

export const returnStockDispositions = ["restock", "damaged"] as const;

const returnItemSchema = new Schema(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    lineSubtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const returnRequestSchema = new Schema(
  {
    returnNumber: { type: String, required: true, trim: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: returnRequestStatuses,
      required: true,
      default: "requested",
      index: true,
    },
    items: { type: [returnItemSchema], required: true },
    requestedAt: { type: Date, required: true, default: Date.now },
    policyWindowDays: { type: Number, required: true, min: 1 },
    decisionNote: { type: String, trim: true },
    stockDisposition: { type: String, enum: returnStockDispositions },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    creditNoteStatus: {
      type: String,
      enum: ["not_required", "queued"],
      required: true,
      default: "not_required",
    },
  },
  { timestamps: true },
);

returnRequestSchema.index({ userId: 1, createdAt: -1 });
returnRequestSchema.index({ status: 1, createdAt: 1 });

export type ReturnRequestDocument = InferSchemaType<typeof returnRequestSchema>;

export const ReturnRequest =
  mongoose.models.ReturnRequest || mongoose.model("ReturnRequest", returnRequestSchema);
