import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { applySoftDeleteFields } from "./shared/softDelete.js";

export const couponTypes = ["percentage", "fixed", "free_shipping"] as const;

const couponSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, trim: true },
    type: { type: String, enum: couponTypes, required: true },
    value: { type: Number, required: true, min: 0, default: 0 },
    minCartValue: { type: Number, min: 0, default: 0 },
    maxDiscount: { type: Number, min: 0 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    active: { type: Boolean, default: true, index: true },
    usageLimit: { type: Number, min: 0 },
    perUserLimit: { type: Number, min: 0, default: 1 },
    usedCount: { type: Number, min: 0, default: 0 },
    applicableProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    applicableCategoryIds: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    excludedProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    excludedCategoryIds: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    firstOrderOnly: { type: Boolean, default: false },
    allowedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    combinableWithStoreCredit: { type: Boolean, default: true },
    combinableWithRewards: { type: Boolean, default: true },
    combinableWithGiftCards: { type: Boolean, default: true },
    campaignId: { type: Schema.Types.ObjectId, ref: "MarketingCampaign" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

applySoftDeleteFields(couponSchema);
couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

export type CouponDocument = InferSchemaType<typeof couponSchema>;
export const Coupon = mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);

const couponRedemptionSchema = new Schema(
  {
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    guestEmail: { type: String, trim: true, lowercase: true, index: true },
    orderNumber: { type: String, required: true, trim: true },
    discount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["applied", "reversed"], default: "applied", index: true },
    reversedAt: { type: Date },
  },
  { timestamps: true },
);

couponRedemptionSchema.index({ couponId: 1, orderNumber: 1 }, { unique: true });

export const CouponRedemption =
  mongoose.models.CouponRedemption || mongoose.model("CouponRedemption", couponRedemptionSchema);
