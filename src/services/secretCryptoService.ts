import crypto from "node:crypto";
import { env } from "../config/env.js";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const material = env.SETTINGS_ENCRYPTION_KEY || env.JWT_REFRESH_SECRET;
  return crypto.createHash("sha256").update(`vastra-settings:${material}`).digest();
}

export function isEncryptedSecret(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value: string): string | undefined {
  if (!isEncryptedSecret(value)) {
    return value;
  }

  try {
    const [ivText, tagText, dataText] = value.slice(PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivText, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(dataText, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return undefined;
  }
}

export function maskSecret(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}
