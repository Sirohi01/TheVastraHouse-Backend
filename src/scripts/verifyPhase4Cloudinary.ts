import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";
import { buildRenditions, uploadToCloudinary } from "../services/cloudinaryService.js";
import { validateUploadBuffer } from "../services/fileSecurityService.js";

async function main() {
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary credentials are required for Phase 4 live verification");
  }

  const fixturePath = join(process.cwd(), "src", "scripts", "fixtures", "phase4-sample.png");
  const buffer = Buffer.from((await readFile(fixturePath, "utf8")).trim(), "base64");
  const detectedFile = validateUploadBuffer(buffer, "product-media");
  const uploadResult = await uploadToCloudinary({
    buffer,
    detectedFile,
    aspectRatio: "1:1",
    context: "product-media",
    folder: "vastra-house/phase4-verification",
  });
  const renditions = buildRenditions(uploadResult.public_id, "1:1");

  console.info(
    JSON.stringify(
      {
        uploaded: true,
        publicId: uploadResult.public_id,
        originalPreserved: Boolean(uploadResult.secure_url),
        renditions: renditions.length,
        firstRenditionUrl: renditions[0]?.url,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
