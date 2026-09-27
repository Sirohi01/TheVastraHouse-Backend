import mongoose, { Schema } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { contentFaqSchema, seoFieldsSchema } from "./shared/seo.js";
import { applySoftDeleteFields } from "./shared/softDelete.js";

/**
 * Managed content pages: policies (privacy, terms, shipping, returns, cancellation) and custom
 * pages. Body is sanitised HTML; there is deliberately no raw-script block (architect review).
 */
const cmsPageSchema = new Schema(
  {
    slug: { type: String, required: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ["policy", "page"], default: "page", index: true },
    summary: { type: String, trim: true, maxlength: 500 },
    body: { type: String, required: true },
    heroImage: mediaReferenceSchema,
    faqs: [contentFaqSchema],
    pageStatus: { type: String, enum: ["draft", "published"], default: "draft", index: true },
    showInFooter: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    publishedAt: { type: Date },
    seo: seoFieldsSchema,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
applySoftDeleteFields(cmsPageSchema);
cmsPageSchema.index({ slug: 1 }, { unique: true });

export const CmsPage = mongoose.models.CmsPage || mongoose.model("CmsPage", cmsPageSchema);
