import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  requireAuth,
  requirePermission,
  userHasPermission,
} from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Media } from "../models/Media.js";
import { aspectRatios } from "../models/shared/mediaReference.js";
import {
  buildRenditions,
  getDeliveryType,
  uploadToCloudinary,
} from "../services/cloudinaryService.js";
import {
  customerUploadContexts,
  scanUpload,
  type UploadContext,
} from "../services/fileSecurityService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const mediaRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const uploadBodySchema = z
  .object({
    aspectRatio: z.enum(aspectRatios),
    customWidth: z.coerce.number().int().positive().optional(),
    customHeight: z.coerce.number().int().positive().optional(),
    context: z.enum(["product-media", "payment-screenshot", "review-photo", "catalog-pdf"]),
    objectFit: z.enum(["cover", "contain"]).default("cover"),
    altText: z.string().min(3).max(160),
    tags: z.string().optional(),
  })
  .strict()
  .refine((value) => value.aspectRatio !== "custom" || (value.customWidth && value.customHeight), {
    message: "Custom aspect ratio requires customWidth and customHeight",
  });

const uploadLimit = rateLimit({ keyPrefix: "media-upload", max: 30, windowMs: 15 * 60 * 1000 });

// Fields safe to return to the uploader or to staff; never exposes internal scan metadata.
const publicMediaFields =
  "originalUrl secureUrl resourceType deliveryType uploadContext mimeType bytes selectedAspectRatio customAspectRatio objectFit altText tags renditions createdAt";

mediaRouter.post(
  "/upload",
  requireAuth,
  uploadLimit,
  upload.single("file"),
  validateRequest({ body: uploadBodySchema }),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError("File is required", 400);
      }

      const context = req.body.context as UploadContext;

      // Customers may only upload their own payment proof and review photos. Catalog, CMS and
      // lookbook assets require the media permission.
      if (!customerUploadContexts.includes(context)) {
        const permission = await userHasPermission(req.user!.id, {
          action: "manage",
          module: "media",
        });

        if (!permission.allowed) {
          throw new AppError("You are not allowed to upload this type of media", 403);
        }
      }

      const detectedFile = await scanUpload(req.file.buffer, context);
      const uploadResult = await uploadToCloudinary({
        buffer: req.file.buffer,
        detectedFile,
        aspectRatio: req.body.aspectRatio,
        context,
        folder: customerUploadContexts.includes(context)
          ? `vastra-house/customer/${context}`
          : undefined,
      });
      const deliveryType = getDeliveryType(context);
      const customAspectRatio =
        req.body.aspectRatio === "custom"
          ? { width: req.body.customWidth, height: req.body.customHeight }
          : undefined;
      const renditions =
        detectedFile.resourceType === "video"
          ? [
              {
                format: uploadResult.format,
                height: uploadResult.height ?? 1080,
                url: uploadResult.secure_url,
                width: uploadResult.width ?? 1080,
              },
            ]
          : buildRenditions(
              uploadResult.public_id,
              req.body.aspectRatio,
              deliveryType,
              customAspectRatio,
            );
      const media = await Media.create({
        originalUrl: uploadResult.secure_url,
        secureUrl: uploadResult.secure_url,
        publicId: uploadResult.public_id,
        resourceType: detectedFile.resourceType,
        deliveryType,
        uploadContext: context,
        mimeType: detectedFile.mimeType,
        bytes: uploadResult.bytes,
        selectedAspectRatio: req.body.aspectRatio,
        customAspectRatio,
        objectFit: req.body.objectFit,
        altText: req.body.altText,
        tags: customerUploadContexts.includes(context) ? [] : parseTags(req.body.tags),
        renditions,
        uploadedBy: req.user?.id,
        scanStatus: "clean",
      });

      res.status(201).json({ media: serializeMedia(media.toObject()) });
    } catch (error) {
      next(error);
    }
  },
);

/** A customer's own uploads (payment proofs, review photos). */
mediaRouter.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const media = await Media.find({ status: { $ne: "deleted" }, uploadedBy: req.user!.id })
      .select(publicMediaFields)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ media });
  } catch (error) {
    next(error);
  }
});

/**
 * Staff media library. Private customer uploads (payment screenshots, review photos) are never
 * listed here; payment proofs are reachable only through the payment verification queue.
 */
mediaRouter.get(
  "/",
  requireAuth,
  requirePermission({ module: "media", action: "read" }),
  async (req, res, next) => {
    try {
      const tag = typeof req.query.tag === "string" ? req.query.tag.toLowerCase() : undefined;
      const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
      const filter: Record<string, unknown> = {
        status: { $ne: "deleted" },
        uploadContext: { $nin: customerUploadContexts },
        ...(tag ? { tags: tag } : {}),
      };

      if (search) {
        filter.$or = [
          { altText: { $regex: escapeRegex(search), $options: "i" } },
          { tags: search.toLowerCase() },
        ];
      }

      const media = await Media.find(filter).sort({ createdAt: -1 }).limit(100).lean();

      res.json({ media });
    } catch (error) {
      next(error);
    }
  },
);

mediaRouter.patch(
  "/:id",
  requireAuth,
  requirePermission({ module: "media", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: z
      .object({
        altText: z.string().min(3).max(160).optional(),
        tags: z.array(z.string().min(1).max(40)).max(20).optional(),
        objectFit: z.enum(["cover", "contain"]).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const update: Record<string, unknown> = {};
      if (req.body.altText) update.altText = req.body.altText;
      if (req.body.objectFit) update.objectFit = req.body.objectFit;
      if (req.body.tags) update.tags = req.body.tags.map((item: string) => item.toLowerCase());
      const media = await Media.findOneAndUpdate(
        { _id: req.params.id, uploadContext: { $nin: customerUploadContexts } },
        { $set: update },
        { new: true },
      );

      if (!media) {
        throw new AppError("Media not found", 404);
      }

      res.json({ media });
    } catch (error) {
      next(error);
    }
  },
);

mediaRouter.patch(
  "/:id/tags",
  requireAuth,
  requirePermission({ module: "media", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: z.object({ tags: z.array(z.string().min(1).max(40)).max(20) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const media = await Media.findOneAndUpdate(
        { _id: req.params.id, uploadContext: { $nin: customerUploadContexts } },
        { $set: { tags: req.body.tags.map((tag: string) => tag.toLowerCase()) } },
        { new: true },
      );

      if (!media) {
        throw new AppError("Media not found", 404);
      }

      res.json({ media });
    } catch (error) {
      next(error);
    }
  },
);

mediaRouter.delete(
  "/:id",
  requireAuth,
  requirePermission({ module: "media", action: "manage" }),
  validateRequest({ params: z.object({ id: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      const media = await Media.findOneAndUpdate(
        { _id: req.params.id, uploadContext: { $nin: customerUploadContexts } },
        { $set: { status: "deleted", deletedAt: new Date() } },
        { new: true },
      );

      if (!media) {
        throw new AppError("Media not found", 404);
      }

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

function serializeMedia(media: Record<string, unknown>) {
  return {
    _id: String(media._id),
    altText: media.altText,
    bytes: media.bytes,
    customAspectRatio: media.customAspectRatio,
    deliveryType: media.deliveryType,
    mimeType: media.mimeType,
    objectFit: media.objectFit,
    originalUrl: media.originalUrl,
    renditions: media.renditions,
    resourceType: media.resourceType,
    secureUrl: media.secureUrl,
    selectedAspectRatio: media.selectedAspectRatio,
    tags: media.tags,
    uploadContext: media.uploadContext,
  };
}

function parseTags(tags?: string): string[] {
  if (!tags) {
    return [];
  }

  return tags
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
