const maxUploadBytesByContext = {
  "product-media": 25 * 1024 * 1024,
  "payment-screenshot": 8 * 1024 * 1024,
  "review-photo": 8 * 1024 * 1024,
  "catalog-pdf": 20 * 1024 * 1024,
} as const;

export type UploadContext = keyof typeof maxUploadBytesByContext;

export type DetectedFile = {
  mimeType: string;
  extension: string;
  resourceType: "image" | "video" | "raw";
};

export function validateUploadBuffer(buffer: Buffer, context: UploadContext): DetectedFile {
  if (buffer.byteLength > maxUploadBytesByContext[context]) {
    throw new Error("File exceeds maximum allowed size");
  }

  const detectedFile = detectFileType(buffer);
  const allowedMimeTypes = getAllowedMimeTypes(context);

  if (!detectedFile || !allowedMimeTypes.includes(detectedFile.mimeType)) {
    throw new Error("File type is not allowed");
  }

  scanBufferForMalware(buffer);

  return detectedFile;
}

export function detectFileType(buffer: Buffer): DetectedFile | null {
  const signature = buffer.subarray(0, 12).toString("hex").toLowerCase();

  if (signature.startsWith("ffd8ff")) {
    return { mimeType: "image/jpeg", extension: "jpg", resourceType: "image" };
  }

  if (signature.startsWith("89504e470d0a1a0a")) {
    return { mimeType: "image/png", extension: "png", resourceType: "image" };
  }

  if (signature.startsWith("52494646") && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: "webp", resourceType: "image" };
  }

  if (signature.startsWith("25504446")) {
    return { mimeType: "application/pdf", extension: "pdf", resourceType: "raw" };
  }

  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return { mimeType: "video/mp4", extension: "mp4", resourceType: "video" };
  }

  return null;
}

export function scanBufferForMalware(buffer: Buffer): void {
  const text = buffer.toString("utf8");

  if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    throw new Error("Malware scan rejected the file");
  }
}

function getAllowedMimeTypes(context: UploadContext): string[] {
  if (context === "catalog-pdf") {
    return ["application/pdf"];
  }

  if (context === "payment-screenshot" || context === "review-photo") {
    return ["image/jpeg", "image/png", "image/webp"];
  }

  return ["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"];
}
