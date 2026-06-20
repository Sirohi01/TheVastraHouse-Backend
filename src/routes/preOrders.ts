import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { productionStages } from "../models/Product.js";
import {
  listAdminPreOrders,
  listCustomerPreOrderTrackers,
  updateProductionStage,
} from "../services/preOrderService.js";

export const preOrdersRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const stageSchema = z.enum(productionStages);

preOrdersRouter.get(
  "/admin",
  requireAuth,
  requirePermission({ module: "orders", action: "manage" }),
  async (req, res, next) => {
    try {
      res.json({
        trackers: await listAdminPreOrders({
          stage: typeof req.query.stage === "string" ? (req.query.stage as never) : undefined,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

preOrdersRouter.post(
  "/admin/stage",
  requireAuth,
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z
      .object({
        note: z.string().max(500).optional(),
        stage: stageSchema,
        trackerIds: z.array(objectIdSchema).min(1).max(100),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        trackers: await updateProductionStage({
          actor: { actorId: req.user!.id, actorType: "admin" },
          note: req.body.note,
          stage: req.body.stage,
          trackerIds: req.body.trackerIds,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

preOrdersRouter.get(
  "/trackers/:orderNumber",
  validateRequest({ params: z.object({ orderNumber: z.string().min(3).max(80) }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ trackers: await listCustomerPreOrderTrackers(String(req.params.orderNumber)) });
    } catch (error) {
      next(error);
    }
  },
);
