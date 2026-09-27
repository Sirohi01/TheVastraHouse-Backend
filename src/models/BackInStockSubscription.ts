import mongoose, { Schema } from "mongoose";

const backInStockSubscriptionSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    sku: { type: String, required: true, trim: true, uppercase: true, index: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["waiting", "notified", "cancelled"],
      default: "waiting",
      index: true,
    },
    notifiedAt: { type: Date },
    unsubscribeToken: { type: String, required: true },
  },
  { timestamps: true },
);

// One active alert per email per variant.
backInStockSubscriptionSchema.index(
  { sku: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: "waiting" } },
);
backInStockSubscriptionSchema.index({ unsubscribeToken: 1 }, { unique: true });

export const BackInStockSubscription =
  mongoose.models.BackInStockSubscription ||
  mongoose.model("BackInStockSubscription", backInStockSubscriptionSchema);
