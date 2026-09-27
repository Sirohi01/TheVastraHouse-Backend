import mongoose, { Schema } from "mongoose";

export const ticketStatuses = ["open", "pending_customer", "resolved", "closed", "spam"] as const;
export const ticketCategories = [
  "order",
  "payment",
  "return",
  "product",
  "wholesale",
  "feedback",
  "privacy",
  "other",
] as const;

const ticketMessageSchema = new Schema(
  {
    authorType: { type: String, enum: ["customer", "agent", "system"], required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User" },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    internal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/** Phase 33 helpdesk ticket. Contact-form enquiries create tickets. */
const supportTicketSchema = new Schema(
  {
    ticketNumber: { type: String, required: true, trim: true },
    source: { type: String, enum: ["contact_form", "account", "admin"], default: "contact_form" },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    orderNumber: { type: String, trim: true, index: true },
    category: { type: String, enum: ticketCategories, default: "other" },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
    status: { type: String, enum: ticketStatuses, default: "open", index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
    messages: [ticketMessageSchema],
    firstResponseAt: { type: Date },
    resolvedAt: { type: Date },
    slaDueAt: { type: Date, index: true },
    ipAddress: { type: String, trim: true },
  },
  { timestamps: true },
);

supportTicketSchema.index({ ticketNumber: 1 }, { unique: true });
supportTicketSchema.index({ status: 1, slaDueAt: 1 });

export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model("SupportTicket", supportTicketSchema);
