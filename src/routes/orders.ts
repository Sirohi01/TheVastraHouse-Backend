import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../middleware/authMiddleware.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { Order, orderStatuses } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { ProductionTracker } from "../models/ProductionTracker.js";
import { OrderDocument } from "../models/OrderDocument.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Refund } from "../models/Refund.js";
import { AppError } from "../middleware/errorHandler.js";
import { bookCourierShipment } from "../services/courierService.js";
import { recordOfflinePayment } from "../services/paymentService.js";
import { setOrderRiskHold } from "../services/orderLifecycleService.js";
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
        productionTrackers: productionTrackers.map(publicTracker),
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
      const order = result.order as Record<string, unknown> & { _id: unknown; paymentSessionId?: unknown };
      const [productionTrackers, paymentSession, refunds, documents] = await Promise.all([
        ProductionTracker.find({ orderNumber: String(req.params.orderNumber) }).sort({ createdAt: 1 }).lean(),
        order.paymentSessionId
          ? PaymentSession.findById(order.paymentSessionId)
              .select("method status amount paidAmount outstandingAmount refundedAmount paymentMode currencyCode dueAt")
              .lean()
          : Promise.resolve(null),
        Refund.find({ orderId: order._id }).select("amount method status source processedAt createdAt").lean(),
        OrderDocument.find({ orderId: order._id })
          .select("documentType documentNumber createdAt")
          .lean(),
      ]);
      res.json({
        documents,
        order: customerOrderDetail(order),
        paymentSession,
        productionTrackers: productionTrackers.map(publicTracker),
        refunds,
        timeline: (result.timeline as Record<string, unknown>[]).map(publicTimelineEvent),
      });
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
        risk: z.enum(["flagged", "held"]).optional(),
      })
      .strict(),
  }),
  async (req, res, next) => {
    try {
      const pagination = parsePagination(req.query);
      const search = req.query.search ? escapeRegExp(String(req.query.search)) : undefined;
      const filter = {
        status: req.query.status ? req.query.status : { $ne: "pending_payment" },
        ...(req.query.risk ? { "risk.status": req.query.risk } : {}),
        ...(search
          ? {
              $or: [
                { orderNumber: { $regex: search, $options: "i" } },
                { guestEmail: { $regex: search, $options: "i" } },
                { "shippingAddress.phone": { $regex: search } },
              ],
            }
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

ordersRouter.post(
  "/admin/:orderId/risk",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({
    body: z.object({ hold: z.boolean(), note: noteSchema }).strict(),
    params: z.object({ orderId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = await setOrderRiskHold({
        actor: actorFromRequest(req),
        hold: req.body.hold,
        note: req.body.note,
        orderId: String(req.params.orderId),
      });
      res.json({ order });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/:orderId/courier",
  requirePermission({ module: "orders", action: "manage" }),
  validateRequest({ params: z.object({ orderId: objectIdSchema }).strict() }),
  async (req, res, next) => {
    try {
      res.json({ order: await bookCourierShipment(String(req.params.orderId), req.user!.id) });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.post(
  "/admin/:orderId/offline-payment",
  requirePermission({ module: "payments", action: "manage" }),
  validateRequest({
    body: z.object({ amount: z.coerce.number().positive(), reference: z.string().trim().min(3).max(80) }).strict(),
    params: z.object({ orderId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const order = (await Order.findById(String(req.params.orderId)).select("paymentSessionId").lean()) as unknown as {
        paymentSessionId?: unknown;
      } | null;
      if (!order?.paymentSessionId) throw new AppError("Order has no payment session", 404);
      const session = await recordOfflinePayment({
        adminUserId: req.user!.id,
        amount: req.body.amount,
        paymentSessionId: String(order.paymentSessionId),
        reference: req.body.reference,
      });
      res.json({ session });
    } catch (error) {
      next(error);
    }
  },
);

ordersRouter.get(
  "/admin-refunds",
  requirePermission({ module: "payments", action: "manage" }),
  async (req, res, next) => {
    try {
      const pagination = parsePagination(req.query);
      const filter: Record<string, unknown> = {};
      if (typeof req.query.status === "string") filter.status = req.query.status;
      if (typeof req.query.source === "string") filter.source = req.query.source;
      const [items, total] = await Promise.all([
        Refund.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
        Refund.countDocuments(filter),
      ]);
      res.json(buildPaginatedResult(items, total, pagination));
    } catch (error) {
      next(error);
    }
  },
);

/** Finance confirms a bank-transfer refund (COD/manual orders) was paid out. */
ordersRouter.post(
  "/admin-refunds/:refundId/mark-processed",
  requirePermission({ module: "payments", action: "manage" }),
  validateRequest({
    body: z.object({ reference: z.string().trim().min(3).max(120) }).strict(),
    params: z.object({ refundId: objectIdSchema }).strict(),
  }),
  async (req, res, next) => {
    try {
      const refund = await Refund.findOneAndUpdate(
        { _id: req.params.refundId, status: "pending", method: { $in: ["bank_transfer", "store_credit"] } },
        {
          $set: {
            bankTransferReference: req.body.reference,
            processedAt: new Date(),
            processedBy: req.user!.id,
            status: "processed",
          },
        },
        { new: true },
      );
      if (!refund) throw new AppError("Refund not found or not awaiting a manual payout", 404);
      if (refund.paymentSessionId) {
        await PaymentSession.updateOne({ _id: refund.paymentSessionId }, { $inc: { refundedAmount: refund.amount } });
      }
      res.json({ refund });
    } catch (error) {
      next(error);
    }
  },
);

const INTERNAL_ITEM_FIELDS = ["costPrice"];

function sanitizeItems(items: unknown) {
  return ((items as Array<Record<string, unknown>>) ?? []).map((item) =>
    Object.fromEntries(Object.entries(item).filter(([key]) => !INTERNAL_ITEM_FIELDS.includes(key))),
  );
}

/** Customer-facing order: no cost prices, fraud signals, stock internals or guest tokens. */
function customerOrderDetail(order: Record<string, unknown>) {
  const {
    risk: _risk,
    stockReservations: _reservations,
    guestSessionId: _guest,
    cartId: _cart,
    financials,
    ...rest
  } = order as Record<string, unknown> & { financials?: Record<string, unknown> };
  return {
    ...rest,
    financials: financials
      ? {
          giftCardRedemptions: financials.giftCardRedemptions,
          rewardPointsEarned: financials.rewardPointsEarned,
          rewardPointsRedeemed: financials.rewardPointsRedeemed,
          storeCreditRedeemed: financials.storeCreditRedeemed,
        }
      : undefined,
    items: sanitizeItems(order.items),
  };
}

function publicTracker(tracker: Record<string, unknown>) {
  const { _id, orderId: _orderId, userId: _userId, ...rest } = tracker;
  return { _id, ...rest };
}

function customerOrderSummary(order: Record<string, unknown>) {
  return {
    _id: order._id,
    createdAt: order.createdAt,
    items: sanitizeItems(order.items),
    orderNumber: order.orderNumber,
    paymentMethod: order.paymentMethod,
    shipment: order.shipment,
    status: order.status,
    totals: order.totals,
  };
}

function publicTrackOrder(order: Record<string, unknown>) {
  const shipment = (order.shipment ?? {}) as Record<string, unknown>;
  return {
    createdAt: order.createdAt,
    items: sanitizeItems(order.items).map((item) => ({
      media: item.media,
      preOrder: item.preOrder,
      productName: item.productName,
      quantity: item.quantity,
      slug: item.slug,
    })),
    orderNumber: order.orderNumber,
    shipment: {
      carrier: shipment.carrier,
      deliveredAt: shipment.deliveredAt,
      dispatchedAt: shipment.dispatchedAt,
      events: shipment.events,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
    },
    status: order.status,
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
