import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { validateGstRate, validateHsnCode } from "../services/taxValidationService.js";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

const seoSchema = new Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
    ogImage: mediaReferenceSchema,
  },
  { _id: false },
);

const priceTierSchema = new Schema(
  {
    priceListCode: { type: String, required: true, trim: true, uppercase: true },
    price: { type: Number, required: true, min: 0 },
    currencyCode: { type: String, required: true, uppercase: true, trim: true, default: "INR" },
  },
  { _id: false },
);

export const productionStages = [
  "order_received",
  "fabric_sourcing",
  "cutting",
  "printing",
  "stitching",
  "finishing",
  "quality_check",
  "packaging",
  "dispatch",
] as const;

const preOrderSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    startAt: { type: Date },
    endAt: { type: Date },
    expectedDispatchAt: { type: Date },
    expectedDeliveryAt: { type: Date },
    paymentMode: { type: String, enum: ["full", "advance"], default: "full" },
    advancePercent: { type: Number, min: 1, max: 99, default: 50 },
    quantityCap: { type: Number, min: 0, default: 0 },
    remainingQuantity: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const variantSchema = new Schema(
  {
    color: { type: String, trim: true },
    size: { type: String, trim: true },
    sku: { type: String, required: true, trim: true, uppercase: true },
    barcode: { type: String, trim: true },
    basePrice: { type: Number, required: true, min: 0 },
    salePrice: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0, default: 0 },
    currencyCode: { type: String, required: true, uppercase: true, trim: true, default: "INR" },
    priceTiers: [priceTierSchema],
    stockPlaceholder: { type: Number, min: 0, default: 0 },
    preOrder: { type: preOrderSchema, default: () => ({}) },
    media: [mediaReferenceSchema],
    active: { type: Boolean, default: true },
  },
  { _id: true },
);

const badgeStateSchema = new Schema(
  {
    newArrival: { type: Boolean, default: false },
    bestSeller: { type: Boolean, default: false },
    trending: { type: Boolean, default: false },
    limitedEdition: { type: Boolean, default: false },
  },
  { _id: false },
);

const badgeOverridesSchema = new Schema(
  {
    newArrival: { type: Boolean },
    bestSeller: { type: Boolean },
    trending: { type: Boolean },
    limitedEdition: { type: Boolean },
  },
  { _id: false },
);

const merchandisingMetricsSchema = new Schema(
  {
    unitsSold30d: { type: Number, min: 0, default: 0 },
    views7d: { type: Number, min: 0, default: 0 },
    sales7d: { type: Number, min: 0, default: 0 },
    trendingScore: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, required: true, trim: true },
    shortDescription: { type: String, trim: true },
    highlights: [{ type: String, trim: true }],
    fabricDetails: { type: String, trim: true },
    washCare: { type: String, trim: true },
    sizeGuide: { type: String, trim: true },
    sizeGuideMedia: mediaReferenceSchema,
    hsnCode: {
      type: String,
      required: true,
      trim: true,
      validate: { validator: validateHsnCode, message: "HSN code must be 4 to 8 digits" },
    },
    gstRate: {
      type: Number,
      required: true,
      validate: { validator: validateGstRate, message: "GST rate is not supported" },
    },
    categoryIds: [{ type: Schema.Types.ObjectId, ref: "Category", index: true }],
    collectionIds: [{ type: Schema.Types.ObjectId, ref: "Collection", index: true }],
    tagIds: [{ type: Schema.Types.ObjectId, ref: "Tag", index: true }],
    media: [mediaReferenceSchema],
    variants: {
      type: [variantSchema],
      validate: {
        validator(value: unknown[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one variant is required",
      },
    },
    seo: seoSchema,
    badgeOverrides: badgeOverridesSchema,
    computedBadges: { type: badgeStateSchema, default: () => ({}) },
    merchandisingMetrics: { type: merchandisingMetricsSchema, default: () => ({}) },
    relatedProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    recommendedProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    frequentlyBoughtTogetherIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    completeTheLookIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

applySoftDeleteFields(productSchema);
productSchema.index({ brandId: 1, slug: 1 }, { unique: true });
productSchema.index({ name: "text", description: "text", fabricDetails: "text" });
productSchema.index({ "computedBadges.newArrival": 1, "computedBadges.bestSeller": 1 });
productSchema.index({ active: 1, status: 1, createdAt: -1 });
productSchema.index({ categoryIds: 1, active: 1, status: 1 });
productSchema.index({ collectionIds: 1, active: 1, status: 1 });
productSchema.index({ tagIds: 1, active: 1, status: 1 });
productSchema.index({ "variants.size": 1, active: 1, status: 1 });
productSchema.index({ "variants.color": 1, active: 1, status: 1 });
productSchema.index({ "variants.basePrice": 1, active: 1, status: 1 });
productSchema.index({ "variants.preOrder.enabled": 1, "variants.preOrder.endAt": 1 });
productSchema.index({ fabricDetails: 1, active: 1, status: 1 });
productSchema.index({ "merchandisingMetrics.unitsSold30d": -1, active: 1, status: 1 });

export type ProductDocument = InferSchemaType<typeof productSchema>;

export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
