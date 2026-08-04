import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { AppError } from "../middleware/errorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { FabricInventory } from "../models/FabricInventory.js";
import { ManufacturingVendor, manufacturingVendorTypes } from "../models/ManufacturingVendor.js";
import { productionStages } from "../models/Product.js";
import { ProductionOrder } from "../models/ProductionOrder.js";
import {
  calculateProductionCosting,
  createProductionOrder,
  listFabricAlerts,
  updateProductionOrderStage,
} from "../services/manufacturingService.js";

export const manufacturingRouter = Router();
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const costs = z
  .object({
    courier: z.number().nonnegative(),
    fabric: z.number().nonnegative(),
    labor: z.number().nonnegative(),
    packaging: z.number().nonnegative(),
    printing: z.number().nonnegative(),
  })
  .strict();

manufacturingRouter.use(
  requireAuth,
  requirePermission({ module: "manufacturing", action: "manage" }),
);

manufacturingRouter.get("/vendors", async (req, res, next) => {
  try {
    const filter = req.query.type ? { type: String(req.query.type) } : {};
    res.json({ vendors: await ManufacturingVendor.find(filter).sort({ type: 1, name: 1 }).lean() });
  } catch (error) {
    next(error);
  }
});

manufacturingRouter.post(
  "/vendors",
  validateRequest({
    body: z
      .object({
        active: z.boolean().optional(),
        address: z.string().max(500).optional(),
        contactName: z.string().max(100).optional(),
        email: z.string().email().optional(),
        gstin: z.string().max(20).optional(),
        leadTimeDays: z.number().int().nonnegative().optional(),
        name: z.string().min(2).max(150),
        notes: z.string().max(1000).optional(),
        phone: z.string().max(30).optional(),
        type: z.enum(manufacturingVendorTypes),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({ vendor: await ManufacturingVendor.create(req.body) });
    } catch (error) {
      next(error);
    }
  },
);

manufacturingRouter.patch(
  "/vendors/:id",
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z
      .object({
        active: z.boolean().optional(),
        address: z.string().max(500).optional(),
        contactName: z.string().max(100).optional(),
        email: z.string().email().optional(),
        gstin: z.string().max(20).optional(),
        leadTimeDays: z.number().int().nonnegative().optional(),
        name: z.string().min(2).max(150).optional(),
        notes: z.string().max(1000).optional(),
        phone: z.string().max(30).optional(),
        type: z.enum(manufacturingVendorTypes).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const vendor = await ManufacturingVendor.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!vendor) throw new AppError("Vendor not found", 404);
      res.json({ vendor });
    } catch (error) {
      next(error);
    }
  },
);

manufacturingRouter.get("/fabric", async (_req, res, next) => {
  try {
    res.json({
      fabric: await FabricInventory.find({})
        .populate("vendorId", "name type")
        .sort({ name: 1 })
        .lean(),
    });
  } catch (error) {
    next(error);
  }
});
manufacturingRouter.get("/fabric/alerts", async (_req, res, next) => {
  try {
    res.json({ alerts: await listFabricAlerts() });
  } catch (error) {
    next(error);
  }
});
manufacturingRouter.post(
  "/fabric",
  validateRequest({
    body: z
      .object({
        active: z.boolean().optional(),
        color: z.string().max(80).optional(),
        costPerUnit: z.number().nonnegative(),
        name: z.string().min(2).max(150),
        onHand: z.number().nonnegative(),
        reorderThreshold: z.number().nonnegative(),
        sku: z.string().min(2).max(80),
        unit: z.enum(["meter", "yard", "kilogram", "piece"]),
        vendorId: objectId.optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({ fabric: await FabricInventory.create(req.body) });
    } catch (error) {
      next(error);
    }
  },
);
manufacturingRouter.patch(
  "/fabric/:id",
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z
      .object({
        active: z.boolean().optional(),
        color: z.string().max(80).optional(),
        costPerUnit: z.number().nonnegative().optional(),
        name: z.string().min(2).max(150).optional(),
        onHand: z.number().nonnegative().optional(),
        reorderThreshold: z.number().nonnegative().optional(),
        unit: z.enum(["meter", "yard", "kilogram", "piece"]).optional(),
        vendorId: objectId.optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const fabric = await FabricInventory.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!fabric) throw new AppError("Fabric inventory not found", 404);
      res.json({ fabric });
    } catch (error) {
      next(error);
    }
  },
);

manufacturingRouter.get("/production-orders", async (req, res, next) => {
  try {
    const filter = req.query.stage ? { stage: String(req.query.stage) } : {};
    const productionOrders = await ProductionOrder.find(filter)
      .populate("vendorIds", "name type")
      .populate("fabricInventoryId", "name sku unit onHand reserved reorderThreshold")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ productionOrders });
  } catch (error) {
    next(error);
  }
});
manufacturingRouter.post(
  "/production-orders",
  validateRequest({
    body: z
      .object({
        costs,
        demandReference: z.string().min(1).max(120),
        demandType: z.enum(["preorder", "restock"]),
        expectedCompletionAt: z.coerce.date().optional(),
        fabricInventoryId: objectId.optional(),
        fabricQuantityRequired: z.number().nonnegative().optional(),
        notes: z.string().max(1000).optional(),
        productId: objectId,
        quantity: z.number().int().positive(),
        sellingPricePerUnit: z.number().nonnegative(),
        sku: z.string().min(1).max(80),
        trackerIds: z.array(objectId).max(250).optional(),
        variantId: objectId,
        vendorIds: z.array(objectId).max(10).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.status(201).json({
        productionOrder: await createProductionOrder({ ...req.body, actorId: req.user!.id }),
      });
    } catch (error) {
      next(error);
    }
  },
);
manufacturingRouter.patch(
  "/production-orders/:id/costing",
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z.object({ costs, sellingPricePerUnit: z.number().nonnegative().optional() }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await ProductionOrder.findById(req.params.id);
      if (!order) throw new AppError("Production order not found", 404);
      order.costs = req.body.costs;
      if (req.body.sellingPricePerUnit !== undefined)
        order.sellingPricePerUnit = req.body.sellingPricePerUnit;
      Object.assign(
        order,
        calculateProductionCosting({
          costs: req.body.costs,
          quantity: order.quantity,
          sellingPricePerUnit: order.sellingPricePerUnit,
        }),
      );
      await order.save();
      res.json({ productionOrder: order });
    } catch (error) {
      next(error);
    }
  },
);
manufacturingRouter.patch(
  "/production-orders/:id/stage",
  validateRequest({
    params: z.object({ id: objectId }).strict(),
    body: z
      .object({ note: z.string().max(500).optional(), stage: z.enum(productionStages) })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      res.json({
        productionOrder: await updateProductionOrderStage({
          id: req.params.id,
          actorId: req.user!.id,
          ...req.body,
        }),
      });
    } catch (error) {
      next(error);
    }
  },
);
