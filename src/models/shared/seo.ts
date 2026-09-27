import { Schema } from "mongoose";
import { mediaReferenceSchema } from "./mediaReference.js";

/**
 * Per-entity SEO overrides. Every field is optional: the storefront falls back through the
 * entity's own content and then the global SEO settings (see frontend lib/seo.ts).
 */
export const seoFieldsSchema = new Schema(
  {
    title: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 320 },
    keywords: [{ type: String, trim: true, maxlength: 60 }],
    canonicalUrl: { type: String, trim: true },
    robotsIndex: { type: Boolean, default: true },
    robotsFollow: { type: Boolean, default: true },
    ogTitle: { type: String, trim: true, maxlength: 120 },
    ogDescription: { type: String, trim: true, maxlength: 320 },
    ogImage: mediaReferenceSchema,
    twitterTitle: { type: String, trim: true, maxlength: 120 },
    twitterDescription: { type: String, trim: true, maxlength: 320 },
    twitterImage: mediaReferenceSchema,
    schemaEnabled: { type: Boolean, default: true },
  },
  { _id: false },
);

export const contentFaqSchema = new Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 300 },
    answer: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { _id: false },
);
