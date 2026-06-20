import mongoose, { Schema, type InferSchemaType } from "mongoose";

const abandonedCartEventSchema = new Schema(
  {
    cartId: { type: Schema.Types.ObjectId, ref: "Cart", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestSessionId: { type: String, trim: true },
    itemCount: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, trim: true, uppercase: true, default: "INR" },
    emittedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

abandonedCartEventSchema.index({ cartId: 1, emittedAt: 1 }, { unique: true });

export type AbandonedCartEventDocument = InferSchemaType<typeof abandonedCartEventSchema>;

export const AbandonedCartEvent =
  mongoose.models.AbandonedCartEvent ||
  mongoose.model("AbandonedCartEvent", abandonedCartEventSchema);
