import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../config/env.js";
import type { AspectRatio } from "../models/shared/mediaReference.js";
import type { DetectedFile, UploadContext } from "./fileSecurityService.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export type CloudinaryUploadInput = {
  buffer: Buffer;
  detectedFile: DetectedFile;
  aspectRatio: AspectRatio;
  context: UploadContext;
  folder?: string;
};

export type CustomAspectRatio = {
  width: number;
  height: number;
};

export async function uploadToCloudinary(input: CloudinaryUploadInput): Promise<UploadApiResponse> {
  assertCloudinaryConfigured();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: input.folder ?? "vastra-house/media",
        resource_type: input.detectedFile.resourceType,
        type: getDeliveryType(input.context),
        format: input.detectedFile.extension === "jpg" ? "jpg" : undefined,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed"));
          return;
        }

        resolve(result);
      },
    );

    stream.end(input.buffer);
  });
}

export function buildRenditions(
  publicId: string,
  aspectRatio: AspectRatio,
  deliveryType: "upload" | "authenticated" = "upload",
  customAspectRatio?: CustomAspectRatio,
) {
  const sizes = buildRenditionSizes(aspectRatio, customAspectRatio);

  return sizes.map((size) => ({
    ...size,
    url: cloudinary.url(publicId, {
      secure: true,
      width: size.width,
      height: size.height,
      crop: "fill",
      gravity: "auto",
      fetch_format: "auto",
      quality: "auto",
      type: deliveryType,
      sign_url: deliveryType === "authenticated",
    }),
    format: "auto",
  }));
}

export function buildRenditionSizes(
  aspectRatio: AspectRatio,
  customAspectRatio?: CustomAspectRatio,
) {
  const ratio = parseAspectRatio(aspectRatio, customAspectRatio);
  const baseWidths = [480, 768, 1200];

  return baseWidths.map((width) => ({
    width,
    height: Math.round(width / ratio),
  }));
}

export function getDeliveryType(context: UploadContext): "upload" | "authenticated" {
  return context === "payment-screenshot" ? "authenticated" : "upload";
}

function assertCloudinaryConfigured(): void {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary credentials are not configured");
  }
}

function parseAspectRatio(aspectRatio: AspectRatio, customAspectRatio?: CustomAspectRatio): number {
  if (aspectRatio === "custom") {
    if (!customAspectRatio) {
      throw new Error("Custom aspect ratio dimensions are required");
    }

    return customAspectRatio.width / customAspectRatio.height;
  }

  const [width, height] = aspectRatio.split(":").map(Number);
  return width / height;
}
