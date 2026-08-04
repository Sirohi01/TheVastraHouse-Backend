import { Router } from "express";
import { z } from "zod";
import { AppError } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { notificationChannels, NotificationTemplate } from "../models/NotificationTemplate.js";
import { buildPaginatedResult, parsePagination } from "../utils/pagination.js";

export const notificationsRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);

const templateInputSchema = z
  .object({
    eventType: z.string().min(1).max(120),
    channel: z.enum(notificationChannels),
    subject: z.string().max(200).optional(),
    body: z.string().min(1),
    active: z.boolean().default(true),
  })
  .strict();

notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/admin/templates",
  requirePermission({ module: "notifications", action: "read" }),
  async (_req, res, next) => {
    try {
      const templates = await NotificationTemplate.find({})
        .sort({ eventType: 1, channel: 1 })
        .lean();
      res.json({ templates });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.post(
  "/admin/templates",
  requirePermission({ module: "notifications", action: "manage" }),
  validateRequest({ body: templateInputSchema }),
  async (req, res, next) => {
    try {
      const template = await NotificationTemplate.findOneAndUpdate(
        { channel: req.body.channel, eventType: req.body.eventType },
        { $set: req.body },
        { new: true, upsert: true },
      );
      res.status(201).json({ template });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.patch(
  "/admin/templates/:id",
  requirePermission({ module: "notifications", action: "manage" }),
  validateRequest({
    params: z.object({ id: objectIdSchema }).strict(),
    body: templateInputSchema.partial(),
  }),
  async (req, res, next) => {
    try {
      const template = await NotificationTemplate.findByIdAndUpdate(
        req.params.id,
        { $set: req.body },
        { new: true },
      );

      if (!template) {
        throw new AppError("Notification template not found", 404);
      }

      res.json({ template });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.delete(
  "/admin/templates/:id",
  requirePermission({ module: "notifications", action: "manage" }),
  validateRequest({ params: z.object({ id: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      const template = await NotificationTemplate.findByIdAndDelete(req.params.id);

      if (!template) {
        throw new AppError("Notification template not found", 404);
      }

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  },
);

notificationsRouter.get(
  "/admin/log",
  requirePermission({ module: "notifications", action: "read" }),
  async (req, res, next) => {
    try {
      const pagination = parsePagination(req.query);
      const filter: Record<string, unknown> = {};

      if (typeof req.query.eventType === "string" && req.query.eventType) {
        filter.eventType = req.query.eventType;
      }
      if (typeof req.query.status === "string" && req.query.status) {
        filter.status = req.query.status;
      }
      if (typeof req.query.to === "string" && req.query.to) {
        filter.to = req.query.to;
      }

      const [logs, total] = await Promise.all([
        NotificationLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        NotificationLog.countDocuments(filter),
      ]);

      res.json(buildPaginatedResult(logs, total, pagination));
    } catch (error) {
      next(error);
    }
  },
);
