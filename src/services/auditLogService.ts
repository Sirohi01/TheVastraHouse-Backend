import type { Types } from "mongoose";
import { AuditLog, type AuditAction } from "../models/AuditLog.js";

export type AuditActor = {
  actorId?: Types.ObjectId;
  actorType: "customer" | "admin" | "system";
  role?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type AuditEntity = {
  type: string;
  id?: Types.ObjectId;
  displayId?: string;
};

export type AuditLogInput = {
  actor: AuditActor;
  entity: AuditEntity;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

export function buildAuditLogPayload(input: AuditLogInput): AuditLogInput {
  return {
    ...input,
    entity: {
      type: input.entity.type,
      id: input.entity.id,
      displayId: input.entity.displayId,
    },
  };
}

export async function writeAuditLog(input: AuditLogInput) {
  return AuditLog.create(buildAuditLogPayload(input));
}
