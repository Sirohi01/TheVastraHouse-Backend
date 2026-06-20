import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { refundMethods } from "../models/Refund.js";
import { ReturnRequest, returnStockDispositions } from "../models/ReturnRequest.js";
import {
  approveReturn,
  rejectReturn,
  requestReturn,
  type RefundMethod,
} from "../services/returnService.js";

export const returnsRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const actorFromRequest = (req: { user?: { id: string; type: "customer" | "admin" } }) =>
  ({
    actorId: req.user?.id,
    actorType: req.user?.type ?? "system",
  }) as const;

returnsRouter.use(requireAuth);

returnsRouter.get("/me", async (req, res, next) => {
  try {
    const returns = await ReturnRequest.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ returns });
  } catch (error) {
    next(error);
  }
});

returnsRouter.post(
  "/requests",
  validateRequest({
    body: z
      .object({
        items: z
          .array(
            z
              .object({
                quantity: z.coerce.number().int().positive(),
                reason: z.string().min(3).max(500),
                sku: z.string().min(2).max(80),
              })
              .strict(),
          )
          .min(1),
        orderNumber: z.string().min(3).max(80),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({
        returnRequest: await requestReturn({
          items: req.body.items,
          orderNumber: req.body.orderNumber,
          userId: req.user!.id,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);

returnsRouter.get(
  "/admin",
  requirePermission({ module: "orders", action: "manage" }),
  async (_req, res, next) => {
    try {
      const returns = await ReturnRequest.find({}).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ returns });
    } catch (error) {
      next(error);
    }
  },
);

returnsRouter.post(
  "/admin/:id/approve",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z
      .object({
        note: z.string().max(500).optional(),
        refundAmount: z.coerce.number().positive().optional(),
        refundMethod: z.enum(refundMethods),
        stockDisposition: z.enum(returnStockDispositions),
      })
      .strict(),
    params: z.object({ id: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await approveReturn({
          actor: actorFromRequest(req),
          note: req.body.note,
          refundAmount: req.body.refundAmount,
          refundMethod: req.body.refundMethod as RefundMethod,
          returnRequestId: String(req.params.id),
          stockDisposition: req.body.stockDisposition,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

returnsRouter.post(
  "/admin/:id/reject",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z.object({ note: z.string().min(3).max(500) }).strict(),
    params: z.object({ id: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        returnRequest: await rejectReturn({
          actor: actorFromRequest(req),
          note: req.body.note,
          returnRequestId: String(req.params.id),
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
