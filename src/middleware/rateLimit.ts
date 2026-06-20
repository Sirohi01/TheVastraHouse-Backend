import type { RequestHandler } from "express";
import { AppError } from "./errorHandler.js";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, _res, next) => {
    const key = `${options.keyPrefix}:${req.ip}:${req.path}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.max) {
      next(new AppError("Too many requests. Please try again later.", 429));
      return;
    }

    current.count += 1;
    next();
  };
}
