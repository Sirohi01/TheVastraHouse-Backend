import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenClaims = {
  sub: string;
  type: "customer" | "admin";
  roleSlug?: string;
  customerType?: "retail" | "wholesale";
};

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    issuer: "vastra-house-api",
    audience: "vastra-house-clients",
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "vastra-house-api",
    audience: "vastra-house-clients",
  }) as AccessTokenClaims;
}
