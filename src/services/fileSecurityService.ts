import net from "node:net";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";

const maxUploadBytesByContext = {
  "product-media": 25 * 1024 * 1024,
  "payment-screenshot": 8 * 1024 * 1024,
  "review-photo": 8 * 1024 * 1024,
  "catalog-pdf": 20 * 1024 * 1024,
} as const;

export type UploadContext = keyof typeof maxUploadBytesByContext;

export const customerUploadContexts: UploadContext[] = ["payment-screenshot", "review-photo"];

export type DetectedFile = {
  mimeType: string;
  extension: string;
  resourceType: "image" | "video" | "raw";
};

export function validateUploadBuffer(buffer: Buffer, context: UploadContext): DetectedFile {
  if (buffer.byteLength > maxUploadBytesByContext[context]) {
    throw new AppError("File exceeds maximum allowed size", 413);
  }

  const detectedFile = detectFileType(buffer);
  const allowedMimeTypes = getAllowedMimeTypes(context);

  if (!detectedFile || !allowedMimeTypes.includes(detectedFile.mimeType)) {
    throw new AppError("File type is not allowed", 415);
  }

  scanBufferForMalware(buffer, detectedFile);
  return detectedFile;
}

/** Full upload check: structural heuristics always, plus ClamAV when CLAMAV_HOST is set. */
export async function scanUpload(buffer: Buffer, context: UploadContext): Promise<DetectedFile> {
  const detected = validateUploadBuffer(buffer, context);
  const verdict = await scanWithClamAv(buffer);

  if (verdict && verdict !== "OK") {
    throw new AppError("Malware scan rejected the file", 422);
  }

  return detected;
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

// Markers are long enough that random compressed image bytes essentially never match them.
const scriptMarkers = [
  "<script",
  "<?php",
  "<html",
  "javascript:",
  "<iframe",
  "onerror=",
  "onload=",
];

// /OpenAction alone is common in benign PDFs (e.g. "open at page 1"), so it is not blocked.
const dangerousPdfMarkers = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia"];

/**
 * Structural malware heuristics. Rejects the EICAR test signature, script/markup payloads
 * hidden inside images (polyglots), and PDFs carrying active content. This is defence in depth;
 * signature-based scanning is performed by ClamAV when configured.
 */
export function scanBufferForMalware(buffer: Buffer, detected?: DetectedFile | null): void {
  const text = buffer.toString("latin1");

  if (text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    throw new AppError("Malware scan rejected the file", 422);
  }

  const file = detected ?? detectFileType(buffer);

  if (!file) {
    return;
  }

  if (file.resourceType === "image") {
    const lower = text.toLowerCase();

    if (scriptMarkers.some((marker) => lower.includes(marker))) {
      throw new AppError("Image contains embedded script content and was rejected", 422);
    }

    if (
      file.mimeType === "image/png" &&
      !buffer.subarray(-12).toString("latin1").includes("IEND")
    ) {
      throw new AppError("PNG file is truncated or has trailing data", 422);
    }
  }

  if (file.mimeType === "application/pdf") {
    const marker = dangerousPdfMarkers.find((item) =>
      new RegExp(`${escapeRegex(item)}[\\s/<(\\[]`).test(text),
    );

    if (marker) {
      throw new AppError(`PDF contains active content (${marker}) and was rejected`, 422);
    }
  }
}

/**
 * Streams the buffer to clamd using the INSTREAM protocol. Returns undefined when ClamAV is not
 * configured, "OK" for clean files, or the signature name when infected.
 */
export async function scanWithClamAv(buffer: Buffer): Promise<string | undefined> {
  if (!env.CLAMAV_HOST) {
    return undefined;
  }

  return new Promise((resolve, reject) => {
    const socket = net.connect(env.CLAMAV_PORT, env.CLAMAV_HOST);
    const chunks: Buffer[] = [];
    socket.setTimeout(15_000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new AppError("Malware scanner timed out", 503));
    });
    socket.on("error", () => reject(new AppError("Malware scanner unavailable", 503)));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      resolve(reply.endsWith("OK") ? "OK" : reply.replace(/^stream:\s*/, ""));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.subarray(offset, offset + chunkSize);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
