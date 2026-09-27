import type { Request, RequestHandler } from "express";
import mongoose from "mongoose";
import { RateLimitBucket } from "../models/RateLimitBucket.js";
import { logger } from "../utils/logger.js";
import { AppError } from "./errorHandler.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  /** Extra identity dimension (e.g. the submitted email) so limits also apply across IPs. */
  identify?: (req: Request) => string | undefined;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const memoryBuckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter backed by MongoDB so limits are shared by every API instance and
 * survive restarts. Falls back to process memory only when the database is unreachable.
 * `app.set("trust proxy")` must be configured so `req.ip` is the real client address.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const identity = options.identify?.(req);
    const keys = [`${options.keyPrefix}:${req.path}:ip:${req.ip}`];

    if (identity) {
      keys.push(`${options.keyPrefix}:${req.path}:id:${identity.toLowerCase()}`);
    }

    try {
      for (const key of keys) {
        const bucket = await hit(key, options.windowMs);

        if (bucket.count > options.max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
          res.setHeader("Retry-After", String(retryAfter));
          next(new AppError("Too many requests. Please try again later.", 429));
          return;
        }
      }

      next();
    } catch (error) {
      logger.error({ error }, "Rate limiter failed; allowing request");
      next();
    }
  };
}

async function hit(key: string, windowMs: number): Promise<Bucket> {
  if (mongoose.connection.readyState !== 1) {
    return hitMemory(key, windowMs);
  }

  const now = new Date();
  const active = (await RateLimitBucket.findOneAndUpdate(
    { key, resetAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true },
  ).lean()) as { count: number; resetAt: Date } | null;

  if (active) {
    return { count: active.count, resetAt: active.resetAt.getTime() };
  }

  const resetAt = new Date(now.getTime() + windowMs);

  try {
    const fresh = (await RateLimitBucket.findOneAndUpdate(
      { key, resetAt: { $lte: now } },
      { $set: { count: 1, resetAt } },
      { new: true, upsert: true },
    ).lean()) as unknown as { count: number; resetAt: Date };
    return { count: fresh.count, resetAt: fresh.resetAt.getTime() };
  } catch (error) {
    // Another instance created the bucket first: count this request against it.
    if ((error as { code?: number }).code === 11000) {
      const bucket = (await RateLimitBucket.findOneAndUpdate(
        { key },
        { $inc: { count: 1 } },
        { new: true },
      ).lean()) as unknown as { count: number; resetAt: Date };
      return { count: bucket.count, resetAt: bucket.resetAt.getTime() };
    }
    throw error;
  }
}

function hitMemory(key: string, windowMs: number): Bucket {
  const now = Date.now();
  const current = memoryBuckets.get(key);

  if (!current || current.resetAt <= now) {
    const bucket = { count: 1, resetAt: now + windowMs };
    memoryBuckets.set(key, bucket);
    return bucket;
  }

  current.count += 1;
  return current;
}

export function emailIdentity(req: Request) {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.trim() : undefined;
}
