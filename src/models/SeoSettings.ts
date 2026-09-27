import mongoose, { Schema } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";
import { seoFieldsSchema } from "./shared/seo.js";

/** Singleton (key "global") holding site-wide SEO defaults and per-static-page overrides. */
const seoSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "global" },
    siteName: { type: String, trim: true },
    brandName: { type: String, trim: true },
    titleTemplate: { type: String, trim: true, default: "%s | The Vastra House" },
    defaultTitle: { type: String, trim: true },
    defaultDescription: { type: String, trim: true },
    defaultKeywords: [{ type: String, trim: true }],
    baseUrl: { type: String, trim: true },
    defaultOgImage: mediaReferenceSchema,
    defaultTwitterImage: mediaReferenceSchema,
    twitterHandle: { type: String, trim: true },
    facebookAppId: { type: String, trim: true },
    locale: { type: String, trim: true, default: "en_IN" },
    verification: {
      google: { type: String, trim: true },
      bing: { type: String, trim: true },
      pinterest: { type: String, trim: true },
      yandex: { type: String, trim: true },
      other: [
        {
          _id: false,
          name: { type: String, trim: true },
          content: { type: String, trim: true },
        },
      ],
    },
    robots: {
      indexSite: { type: Boolean, default: true },
      extraDisallow: [{ type: String, trim: true }],
    },
    organization: {
      legalName: { type: String, trim: true },
      logo: mediaReferenceSchema,
      email: { type: String, trim: true },
      phone: { type: String, trim: true },
      streetAddress: { type: String, trim: true },
      locality: { type: String, trim: true },
      region: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      countryCode: { type: String, trim: true, default: "IN" },
      sameAs: [{ type: String, trim: true }],
    },
    search: {
      // Each entry is a comma-separated group of equivalent terms, e.g. "kurta, kurti".
      synonyms: [{ type: String, trim: true, lowercase: true }],
      boostNewArrivals: { type: Boolean, default: true },
    },
    pages: [
      {
        _id: false,
        path: { type: String, required: true, trim: true },
        label: { type: String, trim: true },
        seo: seoFieldsSchema,
      },
    ],
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const SeoSettings =
  mongoose.models.SeoSettings || mongoose.model("SeoSettings", seoSettingsSchema);
