import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { orderStatuses } from "./Order.js";

const orderTimelineSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    fromStatus: { type: String, enum: orderStatuses },
    toStatus: { type: String, enum: orderStatuses, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: { type: String, enum: ["customer", "admin", "system"], required: true },
    note: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

orderTimelineSchema.index({ orderId: 1, createdAt: 1 });

export type OrderTimelineDocument = InferSchemaType<typeof orderTimelineSchema>;

export const OrderTimeline =
  mongoose.models.OrderTimeline || mongoose.model("OrderTimeline", orderTimelineSchema);
