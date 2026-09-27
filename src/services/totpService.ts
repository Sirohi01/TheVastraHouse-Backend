import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { env } from "../config/env.js";

export function createTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = generateSecret();
  return {
    secret,
    otpauthUrl: buildTotpUri(email, secret),
  };
}

export function buildTotpUri(email: string, secret: string) {
  return generateURI({ issuer: env.TOTP_ISSUER, label: email, secret });
}

/**
 * SVG data URL of the otpauth URI. Vector output stays crisp at any display size (a scaled PNG
 * blurs module edges, which phone cameras fail to read off a screen), and the 4-module quiet
 * zone is what the QR spec requires for scanners to lock on.
 */
export async function buildTotpQrCode(otpauthUrl: string) {
  const svg = await QRCode.toString(otpauthUrl, {
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
    margin: 4,
    type: "svg",
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  // Accept the adjacent 30s step so small phone clock drift does not reject a valid code.
  const result = await verify({ token, secret, epochTolerance: 30 });
  return result.valid;
}
