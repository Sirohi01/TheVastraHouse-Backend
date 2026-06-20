import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Order, orderStatuses } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { ProductionTracker } from "../models/ProductionTracker.js";
import {
  bulkTransitionOrders,
  cancelAdminOrder,
  cancelCustomerOrder,
  getOrderWithTimeline,
  transitionOrderStatus,
  updateShipment,
  type OrderActor,
} from "../services/orderLifecycleService.js";
import { buildPaginatedResult, parsePagination } from "../utils/pagination.js";

export const ordersRouter = Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const orderNumberSchema = z.string().min(3).max(80);
const orderStatusSchema = z.enum(orderStatuses);
const noteSchema = z.string().max(500).optional();

const actorFromRequest = (req: { user?: { id: string; type: "customer" | "admin" } }) =>
  ({
    actorId: req.user?.id,
    actorType: req.user?.type ?? "system",
  }) as OrderActor;

ordersRouter.get(
  "/track/:orderNumber",
  validateRequest({ params: z.object({ orderNumber: orderNumberSchema }).strict() }),
  async (req, res, next) => {
    try {
      const result = await getOrderWithTimeline({ orderNumber: String(req.params.orderNumber) });
      const productionTrackers = await ProductionTracker.find({
        orderNumber: String(req.params.orderNumber),
      })
        .sort({ createdAt: 1 })
        .lean();
      res.json({
        order: publicTrackOrder(result.order as Record<string, unknown>),
        productionTrackers,
        timeline: (result.timeline as Record<string, unknown>[]).map(publicTimelineEvent),
      });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.use(requireAuth);

ordersRouter.get("/me", async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const filter = { userId: req.user!.id };
    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(pagination.skip)
        .limit(pagination.limit)
        .lean(),
      Order.countDocuments(filter),
    ]);

    res.json(buildPaginatedResult(orders.map(customerOrderSummary), total, pagination));
  } catch (error) {
    next(error);
  }
});

ordersRouter.get(
  "/me/:orderNumber",
  validateRequest({ params: z.object({ orderNumber: orderNumberSchema }).strict() }),
  async (req, res, next) => {
    try {
      const result = await getOrderWithTimeline({
        orderNumber: String(req.params.orderNumber),
        userId: req.user!.id,
      });
      const productionTrackers = await ProductionTracker.find({
        orderNumber: String(req.params.orderNumber),
      })
        .sort({ createdAt: 1 })
        .lean();
      res.json({ ...result, productionTrackers });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/me/:orderNumber/cancel",
  validateRequest({
    body: z.object({ note: noteSchema }).strict(),
    params: z.object({ orderNumber: orderNumberSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await cancelCustomerOrder({
        actor: actorFromRequest(req),
        note: req.body.note,
        orderNumber: String(req.params.orderNumber),
        userId: req.user!.id,
      });
      res.json({ order });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.get(
  "/admin",
  requirePermission({ module: "orders", action: "read" }),
  validateRequest({
    query: z
      .object({
        limit: z.coerce.number().int().positive().max(100).optional(),
        page: z.coerce.number().int().positive().optional(),
        search: z.string().max(120).optional(),
        status: orderStatusSchema.optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const pagination = parsePagination(req.query);
      const filter = {
        ...(req.query.status ? { status: req.query.status } : {}),
        ...(req.query.search
          ? { orderNumber: { $regex: escapeRegExp(String(req.query.search)), $options: "i" } }
          : {}),
      };
      const [orders, total] = await Promise.all([
        Order.find(filter)
          .sort({ createdAt: -1 })
          .skip(pagination.skip)
          .limit(pagination.limit)
          .lean(),
        Order.countDocuments(filter),
      ]);

      res.json(buildPaginatedResult(orders, total, pagination));
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/bulk-status",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z
      .object({
        note: noteSchema,
        orderNumbers: z.array(orderNumberSchema).max(100).optional(),
        status: orderStatusSchema.optional(),
        toStatus: orderStatusSchema,
      })
      .strict()
      .refine((value) => value.status || value.orderNumbers?.length, {
        message: "Bulk update requires a status filter or order numbers",
      }),
  }),
  async (req, res, next) => {
    try {
      res.json(
        await bulkTransitionOrders({
          actor: actorFromRequest(req),
          filter: { orderNumbers: req.body.orderNumbers, status: req.body.status },
          note: req.body.note,
          toStatus: req.body.toStatus,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.get(
  "/admin/:orderId",
  requirePermission({ module: "orders", action: "read" }),
  validateRequest({ params: z.object({ orderId: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      const order = (await Order.findById(String(req.params.orderId)).lean()) as Record<
        string,
        unknown
      > | null;
      if (!order) {
        res.status(404).json({ error: { message: "Order not found" } });
        return;
      }
      const timeline = await OrderTimeline.find({ orderNumber: String(order.orderNumber) })
        .sort({ createdAt: 1 })
        .lean();
      const productionTrackers = await ProductionTracker.find({
        orderNumber: String(order.orderNumber),
      })
        .sort({ createdAt: 1 })
        .lean();
      res.json({ order, productionTrackers, timeline });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/:orderId/status",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z.object({ note: noteSchema, toStatus: orderStatusSchema }).strict(),
    params: z.object({ orderId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await transitionOrderStatus({
        actor: actorFromRequest(req),
        note: req.body.note,
        orderId: String(req.params.orderId),
        toStatus: req.body.toStatus,
      });
      res.json({ order });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/:orderId/shipment",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z
      .object({
        carrier: z.string().min(1).max(120),
        dispatchedAt: z.coerce.date().optional(),
        note: noteSchema,
        trackingNumber: z.string().min(1).max(120),
        trackingUrl: z.string().url().optional(),
      })
      .strict(),
    params: z.object({ orderId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await updateShipment({
        actor: actorFromRequest(req),
        carrier: req.body.carrier,
        dispatchedAt: req.body.dispatchedAt,
        note: req.body.note,
        orderId: String(req.params.orderId),
        trackingNumber: req.body.trackingNumber,
        trackingUrl: req.body.trackingUrl,
      });
      res.json({ order });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/:orderId/cancel",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z.object({ note: noteSchema }).strict(),
    params: z.object({ orderId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await cancelAdminOrder({
        actor: actorFromRequest(req),
        note: req.body.note,
        orderId: String(req.params.orderId),
      });
      res.json({ order });
    } catch (error) {
      next(error);
    }
  },
);

function customerOrderSummary(order: Record<string, unknown>) {
  return {
    _id: order._id,
    createdAt: order.createdAt,
    orderNumber: order.orderNumber,
    shipment: order.shipment,
    status: order.status,
    totals: order.totals,
  };
}

function publicTrackOrder(order: Record<string, unknown>) {
  return {
    createdAt: order.createdAt,
    items: order.items,
    orderNumber: order.orderNumber,
    shipment: order.shipment,
    status: order.status,
    totals: order.totals,
  };
}

function publicTimelineEvent(event: Record<string, unknown>) {
  return {
    actorType: event.actorType,
    createdAt: event.createdAt,
    fromStatus: event.fromStatus,
    note: event.note,
    toStatus: event.toStatus,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
