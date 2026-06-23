import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { CmsContent } from "../models/CmsContent.js";

export const cmsRouter = Router();

const mediaReferenceSchema = z
  .object({
    mediaId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .optional(),
    url: z.string().min(1).refine(isMediaUrl, "Media URL must be absolute or site-relative"),
    altText: z.string().min(3).max(160),
    type: z.enum(["image", "video", "pdf", "lookbook"]),
    aspectRatio: z.enum(["1:1", "4:5", "9:16", "16:7", "16:9", "21:9", "3:2", "2:3", "custom"]),
    objectFit: z.enum(["cover", "contain"]).optional(),
  })
  .strict();

function isMediaUrl(value: string) {
  return value.startsWith("/") || z.string().url().safeParse(value).success;
}

const linkSchema = z
  .object({
    enabled: z.boolean().default(true),
    href: z.string().min(1).max(240),
    label: z.string().min(1).max(80),
  })
  .strict();

const heroSlideSchema = z
  .object({
    copy: z.string().max(500).optional(),
    copyFontSize: z.enum(["sm", "md", "lg"]).default("md"),
    contentPosition: z.enum(["left", "center", "right"]).default("left"),
    eyebrow: z.string().max(120).optional(),
    fontFamily: z.enum(["serif", "sans"]).default("serif"),
    fontSize: z.enum(["sm", "md", "lg"]).default("lg"),
    media: mediaReferenceSchema.nullable().optional(),
    primaryCta: linkSchema.optional(),
    secondaryCta: linkSchema.optional(),
    showOutline: z.boolean().default(true),
    textColor: z.string().max(40).default("#ffffff"),
    title: z.string().max(160).optional(),
  })
  .strict();

const aboutValueSchema = z
  .object({
    icon: z.enum(["sparkles", "award", "shield", "care"]).default("sparkles"),
    text: z.string().min(1).max(500),
    title: z.string().min(1).max(120),
  })
  .strict();

const catalogPageContentSchema = z
  .object({
    description: z.string().max(500).optional(),
    copyFontSize: z.enum(["sm", "md", "lg"]).default("md"),
    contentPosition: z.enum(["left", "center", "right"]).default("left"),
    eyebrow: z.string().max(120).optional(),
    fontFamily: z.enum(["serif", "sans"]).default("serif"),
    fontSize: z.enum(["sm", "md", "lg"]).default("lg"),
    media: mediaReferenceSchema.nullable().optional(),
    promo: heroSlideSchema.optional(),
    showOutline: z.boolean().default(true),
    textColor: z.string().max(40).default("#ffffff"),
    title: z.string().max(180).optional(),
  })
  .strict();

const cmsSchema = z
  .object({
    title: z.string().min(1).max(120),
    status: z.enum(["draft", "published"]).default("published"),
    home: z
      .object({
        announcement: z.string().max(240).optional(),
        hero: z
          .object({
            copy: z.string().max(500).optional(),
            eyebrow: z.string().max(120).optional(),
            media: mediaReferenceSchema.nullable().optional(),
            primaryCta: linkSchema.optional(),
            secondaryCta: linkSchema.optional(),
            slides: z.array(heroSlideSchema).max(8).default([]),
            story: heroSlideSchema.optional(),
            title: z.string().max(160).optional(),
          })
          .strict()
          .optional(),
        storyMedia: mediaReferenceSchema.nullable().optional(),
      })
      .strict()
      .optional(),
    about: z
      .object({
        description: z.string().max(500).optional(),
        eyebrow: z.string().max(120).optional(),
        media: mediaReferenceSchema.nullable().optional(),
        primaryCta: linkSchema.optional(),
        storyCopy: z.string().max(1200).optional(),
        storyEyebrow: z.string().max(120).optional(),
        storyTitle: z.string().max(220).optional(),
        title: z.string().max(180).optional(),
        values: z.array(aboutValueSchema).max(8).default([]),
      })
      .strict()
      .optional(),
    shop: catalogPageContentSchema.optional(),
    preOrder: catalogPageContentSchema.optional(),
    navigation: z.array(linkSchema).max(20).default([]),
    footer: z
      .object({
        brandLogo: mediaReferenceSchema.nullable().optional(),
        email: z.string().email().or(z.literal("")).optional(),
        instagramPosts: z.array(z.string().url()).max(20).default([]),
        instagramUrl: z.string().url().or(z.literal("")).optional(),
        links: z.array(linkSchema).max(20).default([]),
        location: z.string().max(160).optional(),
        phone: z.string().max(40).optional(),
        tagline: z.string().max(240).optional(),
        whatsappUrl: z.string().url().or(z.literal("")).optional(),
      })
      .strict()
      .optional(),
    testimonials: z
      .array(
        z
          .object({
            location: z.string().max(100).optional(),
            name: z.string().min(1).max(100),
            quote: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(12)
      .default([]),
    faqs: z
      .array(
        z
          .object({
            answer: z.string().min(1).max(2000),
            question: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    policies: z
      .array(
        z
          .object({
            body: z.string().min(1),
            slug: z.string().min(1).max(120),
            title: z.string().min(1).max(160),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();

cmsRouter.get("/content/:key", async (req, res, next) => {
  try {
    const content = await CmsContent.findOne({
      key: String(req.params.key).toLowerCase(),
      status: "published",
    }).lean();

    res.json({ content });
  } catch (error) {
    next(error);
  }
});

cmsRouter.get(
  "/admin/content/:key",
  requireAuth,
  requirePermission({ module: "cms", action: "manage" }),
  async (req, res, next) => {
    try {
      const content = await CmsContent.findOne({
        key: String(req.params.key).toLowerCase(),
      }).lean();
      res.json({ content });
    } catch (error) {
      next(error);
    }
  },
);

cmsRouter.put(
  "/admin/content/:key",
  requireAuth,
  requirePermission({ module: "cms", action: "manage" }),
  validateRequest({ body: cmsSchema }),
  async (req, res, next) => {
    try {
      const content = await CmsContent.findOneAndUpdate(
        { key: String(req.params.key).toLowerCase() },
        { $set: { ...req.body, updatedBy: req.user!.id } },
        { new: true, upsert: true },
      );

      res.json({ content });
    } catch (error) {
      next(error);
    }
  },
);
