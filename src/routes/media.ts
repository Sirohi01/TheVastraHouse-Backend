import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Media } from "../models/Media.js";
import { aspectRatios } from "../models/shared/mediaReference.js";
import {
  buildRenditions,
  getDeliveryType,
  uploadToCloudinary,
} from "../services/cloudinaryService.js";
import { validateUploadBuffer, type UploadContext } from "../services/fileSecurityService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const mediaRouter = Router();

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

mediaRouter.post(
  "/upload",
  requireAuth,
  upload.single("file"),
  validateRequest({ body: uploadBodySchema }),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError("File is required", 400);
      }

      const detectedFile = validateUploadBuffer(req.file.buffer, req.body.context as UploadContext);
      const uploadResult = await uploadToCloudinary({
        buffer: req.file.buffer,
        detectedFile,
        aspectRatio: req.body.aspectRatio,
        context: req.body.context as UploadContext,
      });
      const deliveryType = getDeliveryType(req.body.context as UploadContext);
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
        uploadContext: req.body.context,
        mimeType: detectedFile.mimeType,
        bytes: uploadResult.bytes,
        selectedAspectRatio: req.body.aspectRatio,
        customAspectRatio,
        objectFit: req.body.objectFit,
        altText: req.body.altText,
        tags: parseTags(req.body.tags),
        renditions,
        uploadedBy: req.user?.id,
        scanStatus: "clean",
      });

      res.status(201).json({ media });
    } catch (error) {
      next(error);
    }
  },
);

mediaRouter.get("/", requireAuth, async (req, res, next) => {
  try {
    const tag = typeof req.query.tag === "string" ? req.query.tag.toLowerCase() : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const filter: Record<string, unknown> = tag
      ? { tags: tag, status: { $ne: "deleted" } }
      : { status: { $ne: "deleted" } };

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
});

mediaRouter.patch(
  "/:id/tags",
  requireAuth,
  validateRequest({
    body: z.object({ tags: z.array(z.string().min(1).max(40)).max(20) }).strict(),
  }),
  async (req, res, next) => {
    try {
      const media = await Media.findByIdAndUpdate(
        req.params.id,
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

mediaRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const media = await Media.findByIdAndUpdate(
      req.params.id,
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
});

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
