import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const orderDocumentTypes = [
  "tax_invoice",
  "proforma_invoice",
  "receipt",
  "credit_note",
  "debit_note",
  "delivery_challan",
  "return_invoice",
] as const;

const documentLineSchema = new Schema(
  {
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    hsnCode: { type: String, trim: true },
    gstRate: { type: Number, min: 0, required: true },
    quantity: { type: Number, min: 1, required: true },
    unitPrice: { type: Number, min: 0, required: true },
    taxableAmount: { type: Number, min: 0, required: true },
    gstAmount: { type: Number, min: 0, required: true },
    lineTotal: { type: Number, min: 0, required: true },
  },
  { _id: false },
);

const orderDocumentSchema = new Schema(
  {
    documentNumber: { type: String, required: true, unique: true, trim: true, index: true },
    type: { type: String, enum: orderDocumentTypes, required: true, index: true },
    financialYear: { type: String, required: true, trim: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    returnRequestId: { type: Schema.Types.ObjectId, ref: "ReturnRequest", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    customerEmail: { type: String, lowercase: true, trim: true },
    currencyCode: { type: String, required: true, uppercase: true, trim: true },
    issuedAt: { type: Date, required: true },
    company: { type: Schema.Types.Mixed, required: true },
    billingAddress: { type: Schema.Types.Mixed },
    shippingAddress: { type: Schema.Types.Mixed },
    lines: { type: [documentLineSchema], required: true },
    taxBreakdown: { type: [Schema.Types.Mixed], default: [] },
    totals: { type: Schema.Types.Mixed, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    pdf: {
      data: { type: Buffer, required: true, select: false },
      mimeType: { type: String, required: true, default: "application/pdf" },
      size: { type: Number, required: true, min: 1 },
    },
  },
  { timestamps: true },
);

orderDocumentSchema.index({ orderId: 1, type: 1, returnRequestId: 1 }, { unique: true });
orderDocumentSchema.pre("save", function protectImmutableSnapshot(next) {
  if (!this.isNew && this.isModified()) {
    next(new Error("Issued order documents are immutable"));
    return;
  }
  next();
});

export type OrderDocumentRecord = InferSchemaType<typeof orderDocumentSchema>;
export const OrderDocument =
  mongoose.models.OrderDocument || mongoose.model("OrderDocument", orderDocumentSchema);
