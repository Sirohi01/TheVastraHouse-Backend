import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { RefreshToken } from "../models/RefreshToken.js";
import {
  addDays,
  createOpaqueToken,
  createTokenFamilyId,
  hashOpaqueToken,
} from "./cryptoTokenService.js";

export type RefreshTokenIssueInput = {
  userId: Types.ObjectId;
  familyId?: string;
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
};

export async function issueRefreshToken(input: RefreshTokenIssueInput): Promise<string> {
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const familyId = input.familyId ?? createTokenFamilyId();

  await RefreshToken.create({
    userId: input.userId,
    tokenHash,
    familyId,
    deviceId: input.deviceId,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    expiresAt: addDays(new Date(), env.JWT_REFRESH_TTL_DAYS),
  });

  return token;
}

export async function rotateRefreshToken(
  token: string,
  metadata: Omit<RefreshTokenIssueInput, "userId" | "familyId">,
): Promise<{ userId: Types.ObjectId; refreshToken: string }> {
  const tokenHash = hashOpaqueToken(token);
  const existingToken = await RefreshToken.findOne({ tokenHash }).select("+tokenHash");

  if (!existingToken) {
    throw new Error("Refresh token is invalid");
  }

  if (existingToken.revokedAt || existingToken.reusedAt || existingToken.replacedByTokenHash) {
    await revokeRefreshTokenFamily(existingToken.familyId, "reuse");
    throw new Error("Refresh token reuse detected");
  }

  if (existingToken.expiresAt.getTime() <= Date.now()) {
    existingToken.revokedAt = new Date();
    await existingToken.save();
    throw new Error("Refresh token expired");
  }

  const nextRefreshToken = createOpaqueToken();
  const nextTokenHash = hashOpaqueToken(nextRefreshToken);

  existingToken.revokedAt = new Date();
  existingToken.replacedByTokenHash = nextTokenHash;
  await existingToken.save();

  await RefreshToken.create({
    userId: existingToken.userId,
    tokenHash: nextTokenHash,
    familyId: existingToken.familyId,
    deviceId: metadata.deviceId,
    userAgent: metadata.userAgent,
    ipAddress: metadata.ipAddress,
    expiresAt: addDays(new Date(), env.JWT_REFRESH_TTL_DAYS),
  });

  return {
    userId: existingToken.userId as Types.ObjectId,
    refreshToken: nextRefreshToken,
  };
}

export async function revokeRefreshTokenFamily(
  familyId: string,
  reason: "logout" | "reuse",
): Promise<void> {
  const update =
    reason === "reuse"
      ? { revokedAt: new Date(), reusedAt: new Date() }
      : { revokedAt: new Date() };

  await RefreshToken.updateMany({ familyId, revokedAt: { $exists: false } }, { $set: update });
}
