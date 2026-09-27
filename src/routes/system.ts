import { Router } from "express";
import { requireAnyPermission, requireAuth } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { applyTrackingUpdate, parseShiprocketWebhook, verifyShiprocketWebhook } from "../services/courierService.js";
import { getJobStatuses, listRegisteredJobs, runJobOnce, verifyCronSecret } from "../services/schedulerService.js";
import { logger } from "../utils/logger.js";

export const systemRouter = Router();

/**
 * External cron entrypoint (Render Cron Job / GitHub Actions / cron-job.org). Wakes a sleeping
 * instance and runs due jobs; each still runs under its lease, so this is safe to call often.
 */
systemRouter.post(
  "/jobs/run",
  rateLimit({ keyPrefix: "cron", max: 60, windowMs: 60 * 1000 }),
  async (req, res, next) => {
    try {
      if (!verifyCronSecret(req.header("X-Cron-Secret"))) {
        throw new AppError("Invalid cron secret", 401);
      }

      const requested = typeof req.query.job === "string" ? [req.query.job] : listRegisteredJobs().map((job) => job.name);
      const results: Record<string, unknown> = {};

      for (const name of requested) {
        try {
          results[name] = await runJobOnce(name);
        } catch (error) {
          results[name] = { error: error instanceof Error ? error.message : "failed" };
        }
      }

      res.json({ results });
    } catch (error) {
      next(error);
    }
  },
);

systemRouter.get(
  "/jobs",
  requireAuth,
  requireAnyPermission({ action: "read", module: "settings" }, { action: "read", module: "audit" }),
  async (_req, res, next) => {
    try {
      const [jobs, failedWebhooks] = await Promise.all([
        getJobStatuses(),
        PaymentWebhookEvent.countDocuments({
          $or: [{ signatureVerified: false }, { error: { $exists: true } }],
          createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
        }),
      ]);
      res.json({ failedWebhooksLast7Days: failedWebhooks, jobs });
    } catch (error) {
      next(error);
    }
  },
);

systemRouter.post(
  "/jobs/:name/run",
  requireAuth,
  requireAnyPermission({ action: "manage", module: "settings" }),
  async (req, res, next) => {
    try {
      if (!listRegisteredJobs().some((job) => job.name === req.params.name)) {
        throw new AppError("Unknown job", 404);
      }
      res.json({ result: await runJobOnce(String(req.params.name)) });
    } catch (error) {
      next(error);
    }
  },
);

/** Shiprocket tracking webhook; authenticated with the shared token in x-api-key. */
systemRouter.post(
  "/courier/shiprocket/webhook",
  rateLimit({ keyPrefix: "courier-webhook", max: 600, windowMs: 60 * 1000 }),
  async (req, res, next) => {
    try {
      if (!(await verifyShiprocketWebhook(req.header("x-api-key")))) {
        throw new AppError("Invalid courier webhook token", 401);
      }

      const update = parseShiprocketWebhook((req.body ?? {}) as Record<string, unknown>);
      if (!update) {
        res.json({ ignored: true });
        return;
      }

      const result = await applyTrackingUpdate(update);
      if (!result.matched) {
        logger.warn({ trackingNumber: update.trackingNumber }, "Courier webhook for unknown AWB");
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
