import type { Types } from "mongoose";
import { ActivityLog } from "../models/ActivityLog.js";

export type ActivityLogInput = {
  actorId?: Types.ObjectId;
  actorType: "customer" | "admin" | "system";
  activity: string;
  module: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

export function buildActivityLogPayload(input: ActivityLogInput): ActivityLogInput {
  return {
    ...input,
    module: input.module.toLowerCase(),
  };
}

export async function writeActivityLog(input: ActivityLogInput) {
  return ActivityLog.create(buildActivityLogPayload(input));
}
