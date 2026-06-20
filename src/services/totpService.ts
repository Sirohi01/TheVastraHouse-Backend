import { generateSecret, generateURI, verify } from "otplib";
import { env } from "../config/env.js";

export function createTotpSecret(email: string): { secret: string; otpauthUrl: string } {
  const secret = generateSecret();
  return {
    secret,
    otpauthUrl: generateURI({ issuer: env.TOTP_ISSUER, label: email, secret }),
  };
}

export async function verifyTotp(token: string, secret: string): Promise<boolean> {
  const result = await verify({ token, secret });
  return result.valid;
}
