import mongoose, { Schema, type InferSchemaType } from "mongoose";
import { mediaReferenceSchema } from "./shared/mediaReference.js";

const linkSchema = new Schema(
  {
    label: { type: String, required: true, trim: true },
    href: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const heroSlideSchema = new Schema(
  {
    copy: { type: String, trim: true },
    copyFontSize: { type: String, enum: ["sm", "md", "lg"], default: "md" },
    contentPosition: { type: String, enum: ["left", "center", "right"], default: "left" },
    eyebrow: { type: String, trim: true },
    fontFamily: { type: String, enum: ["serif", "sans"], default: "serif" },
    fontSize: { type: String, enum: ["sm", "md", "lg"], default: "lg" },
    media: mediaReferenceSchema,
    mobileMedia: mediaReferenceSchema,
    overlay: { type: String, enum: ["none", "soft", "medium", "strong"], default: "medium" },
    primaryCta: linkSchema,
    secondaryCta: linkSchema,
    showOutline: { type: Boolean, default: true },
    showTextOnMobile: { type: Boolean, default: true },
    textColor: { type: String, trim: true, default: "#ffffff" },
    title: { type: String, trim: true },
    enabled: { type: Boolean, default: true },
    startsAt: { type: Date },
    endsAt: { type: Date },
  },
  { _id: false },
);

const catalogPageContentSchema = new Schema(
  {
    eyebrow: { type: String, trim: true },
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    copyFontSize: { type: String, enum: ["sm", "md", "lg"], default: "md" },
    contentPosition: { type: String, enum: ["left", "center", "right"], default: "left" },
    fontFamily: { type: String, enum: ["serif", "sans"], default: "serif" },
    fontSize: { type: String, enum: ["sm", "md", "lg"], default: "lg" },
    media: mediaReferenceSchema,
    promo: heroSlideSchema,
    showOutline: { type: Boolean, default: true },
    textColor: { type: String, trim: true, default: "#ffffff" },
  },
  { _id: false },
);

const cmsContentSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ["draft", "published"], required: true, default: "published" },
    home: {
      hero: {
        eyebrow: { type: String, trim: true },
        title: { type: String, trim: true },
        copy: { type: String, trim: true },
        media: mediaReferenceSchema,
        primaryCta: linkSchema,
        secondaryCta: linkSchema,
        slides: [heroSlideSchema],
        slideDuration: { type: Number, min: 3, max: 30 },
      },
      story: heroSlideSchema,
      storyMedia: mediaReferenceSchema,
      announcement: { type: String, trim: true },
      topBarText: { type: String, trim: true },
    },
    about: {
      eyebrow: { type: String, trim: true },
      title: { type: String, trim: true },
      description: { type: String, trim: true },
      storyEyebrow: { type: String, trim: true },
      storyTitle: { type: String, trim: true },
      storyCopy: { type: String, trim: true },
      // Entity-rich, customer-facing sections (who we are, what we sell, how orders work...).
      sections: [
        {
          _id: false,
          heading: { type: String, required: true, trim: true },
          body: { type: String, required: true, trim: true },
        },
      ],
      // Optional verified business facts; rendered only when filled in by the owner.
      foundedYear: { type: Number, min: 1800, max: 2100 },
      founder: {
        name: { type: String, trim: true },
        role: { type: String, trim: true },
        bio: { type: String, trim: true },
      },
      media: mediaReferenceSchema,
      primaryCta: linkSchema,
      values: [
        {
          icon: {
            type: String,
            enum: ["sparkles", "award", "shield", "care"],
            default: "sparkles",
          },
          title: { type: String, required: true, trim: true },
          text: { type: String, required: true, trim: true },
        },
      ],
    },
    shop: catalogPageContentSchema,
    preOrder: catalogPageContentSchema,
    navigation: [linkSchema],
    headerNavigation: [linkSchema],
    footer: {
      brandLogo: mediaReferenceSchema,
      email: { type: String, trim: true },
      instagramPosts: [{ type: String, trim: true }],
      instagramUrl: { type: String, trim: true },
      tagline: { type: String, trim: true },
      location: { type: String, trim: true },
      phone: { type: String, trim: true },
      whatsappUrl: { type: String, trim: true },
      links: [linkSchema],
      shopLinks: [linkSchema],
      helpLinks: [linkSchema],
      newsletterTitle: { type: String, trim: true },
      newsletterText: { type: String, trim: true },
      copyrightText: { type: String, trim: true },
    },
    testimonials: [
      {
        name: { type: String, required: true, trim: true },
        location: { type: String, trim: true },
        quote: { type: String, required: true, trim: true },
      },
    ],
    faqs: [
      {
        question: { type: String, required: true, trim: true },
        answer: { type: String, required: true, trim: true },
      },
    ],
    policies: [
      {
        slug: { type: String, required: true, trim: true, lowercase: true },
        title: { type: String, required: true, trim: true },
        body: { type: String, required: true, trim: true },
      },
    ],
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export type CmsContentDocument = InferSchemaType<typeof cmsContentSchema>;

export const CmsContent =
  mongoose.models.CmsContent || mongoose.model("CmsContent", cmsContentSchema);
