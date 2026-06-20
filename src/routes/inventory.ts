import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { InventoryLog } from "../models/InventoryLog.js";
import { LowStockAlert } from "../models/LowStockAlert.js";
import { StockLedger } from "../models/StockLedger.js";
import { StockTransfer } from "../models/StockTransfer.js";
import {
  adjustStock,
  createStockTransfer,
  receiveStockTransfer,
  runLowStockAlertJob,
  upsertStockLedger,
} from "../services/inventoryService.js";

export const inventoryRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const skuSchema = z.string().min(2).max(80);
const stockStateSchema = z.enum(["available", "reserved", "damaged", "returned", "incoming"]);
const actorFromRequest = (req: { user?: { id: string; type: "customer" | "admin" } }) =>
  ({
    actorId: req.user?.id,
    actorType: req.user?.type ?? "system",
  }) as const;

inventoryRouter.use(requireAuth);

inventoryRouter.get(
  "/dashboard",
  requirePermission({ module: "inventory", action: "read" }),
  async (_req, res, next) => {
    try {
      const ledgers = await StockLedger.find({}).sort({ sku: 1 }).lean();
      const alerts = await LowStockAlert.find({ status: "open" }).sort({ triggeredAt: -1 }).lean();
      res.json({ alerts, ledgers });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.get(
  "/logs",
  requirePermission({ module: "inventory", action: "read" }),
  async (req, res, next) => {
    try {
      const filter = req.query.sku ? { sku: String(req.query.sku).trim().toUpperCase() } : {};
      const logs = await InventoryLog.find(filter).sort({ createdAt: -1 }).limit(100).lean();
      res.json({ logs });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.get(
  "/alerts",
  requirePermission({ module: "inventory", action: "read" }),
  async (_req, res, next) => {
    try {
      res.json({
        alerts: await LowStockAlert.find({}).sort({ status: 1, triggeredAt: -1 }).lean(),
      });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/alerts/run",
  requirePermission({ module: "inventory", action: "manage" }),
  async (_req, res, next) => {
    try {
      res.json(await runLowStockAlertJob());
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/ledgers",
  requirePermission({ module: "inventory", action: "manage" }),
  validateRequest({
    body: z
      .object({
        sku: skuSchema,
        warehouseId: objectIdSchema,
        available: z.coerce.number().int().min(0).optional(),
        reserved: z.coerce.number().int().min(0).optional(),
        damaged: z.coerce.number().int().min(0).optional(),
        returned: z.coerce.number().int().min(0).optional(),
        incoming: z.coerce.number().int().min(0).optional(),
        lowStockThreshold: z.coerce.number().int().min(0).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({
        ledger: await upsertStockLedger({ ...req.body, actor: actorFromRequest(req) }),
      });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/adjustments",
  requirePermission({ module: "inventory", action: "manage" }),
  validateRequest({
    body: z
      .object({
        sku: skuSchema,
        warehouseId: objectIdSchema,
        state: stockStateSchema,
        quantity: z.coerce.number().int().positive(),
        reasonCode: z.string().min(3).max(80),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({
        ledger: await adjustStock({ ...req.body, actor: actorFromRequest(req) }),
      });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.get(
  "/transfers",
  requirePermission({ module: "inventory", action: "read" }),
  async (_req, res, next) => {
    try {
      res.json({ transfers: await StockTransfer.find({}).sort({ createdAt: -1 }).lean() });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/transfers",
  requirePermission({ module: "inventory", action: "manage" }),
  validateRequest({
    body: z
      .object({
        sku: skuSchema,
        quantity: z.coerce.number().int().positive(),
        sourceWarehouseId: objectIdSchema,
        destinationWarehouseId: objectIdSchema,
        notes: z.string().max(500).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({
        transfer: await createStockTransfer({ ...req.body, actor: actorFromRequest(req) }),
      });
    } catch (error) {
      next(error);
    }
  },
);

inventoryRouter.post(
  "/transfers/:transferId/receive",
  requirePermission({ module: "inventory", action: "manage" }),
  validateRequest({ params: z.object({ transferId: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json({
        transfer: await receiveStockTransfer({
          actor: actorFromRequest(req),
          transferId: String(req.params.transferId),
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
