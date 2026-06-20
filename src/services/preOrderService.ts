import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Order } from "../models/Order.js";
import { Product, productionStages } from "../models/Product.js";
import { ProductionTracker } from "../models/ProductionTracker.js";
import {
  recordOrderTimeline,
  transitionOrderDocument,
  type OrderActor,
} from "./orderLifecycleService.js";

export type ProductionStage = (typeof productionStages)[number];

export type PreOrderVariantSnapshot = {
  enabled: boolean;
  expectedDispatchAt?: Date;
  expectedDeliveryAt?: Date;
  paymentMode?: "full" | "advance";
  advancePercent?: number;
  remainingQuantity?: number;
  startAt?: Date;
  endAt?: Date;
};

export function isPreOrderActive(preOrder?: PreOrderVariantSnapshot, now = new Date()) {
  if (!preOrder?.enabled) {
    return false;
  }

  if (preOrder.startAt && preOrder.startAt.getTime() > now.getTime()) {
    return false;
  }

  if (preOrder.endAt && preOrder.endAt.getTime() < now.getTime()) {
    return false;
  }

  return (preOrder.remainingQuantity ?? 0) > 0;
}

export function assertPreOrderWindow(preOrder?: PreOrderVariantSnapshot, now = new Date()) {
  if (!preOrder?.enabled) {
    throw new AppError("Variant is not enabled for pre-order", 409);
  }

  if (preOrder.startAt && preOrder.startAt.getTime() > now.getTime()) {
    throw new AppError("Pre-order window has not started", 409);
  }

  if (preOrder.endAt && preOrder.endAt.getTime() < now.getTime()) {
    throw new AppError("Pre-order window has closed", 409);
  }
}

export async function reservePreOrderSlots(
  items: Array<{ variantId: unknown; quantity: number; sku: string }>,
  now = new Date(),
) {
  const reserved: Array<{ variantId: unknown; quantity: number; sku: string }> = [];

  for (const item of items) {
    const product = await Product.findOneAndUpdate(
      {
        "variants._id": item.variantId,
        "variants.preOrder.enabled": true,
        "variants.preOrder.remainingQuantity": { $gte: item.quantity },
        $and: [
          {
            $or: [
              { "variants.preOrder.startAt": { $exists: false } },
              { "variants.preOrder.startAt": { $lte: now } },
            ],
          },
          {
            $or: [
              { "variants.preOrder.endAt": { $exists: false } },
              { "variants.preOrder.endAt": { $gte: now } },
            ],
          },
        ],
      },
      { $inc: { "variants.$.preOrder.remainingQuantity": -item.quantity } },
      { new: true },
    );

    if (!product) {
      await releasePreOrderSlots(reserved);
      throw new AppError(`Pre-order quantity is not available for ${item.sku}`, 409);
    }

    reserved.push(item);
  }

  return reserved;
}

export async function releasePreOrderSlots(items: Array<{ variantId: unknown; quantity: number }>) {
  for (const item of items) {
    await Product.updateOne(
      { "variants._id": item.variantId },
      { $inc: { "variants.$.preOrder.remainingQuantity": item.quantity } },
    );
  }
}

export async function createProductionTrackersForOrder(order: {
  _id: unknown;
  orderNumber: string;
  userId?: unknown;
  items: Array<{
    productId: unknown;
    variantId: unknown;
    productName: string;
    quantity: number;
    sku: string;
    preOrder?: {
      enabled?: boolean;
      expectedDispatchAt?: Date;
      expectedDeliveryAt?: Date;
    };
  }>;
}) {
  const trackers = [];

  for (const item of order.items) {
    if (!item.preOrder?.enabled) {
      continue;
    }

    try {
      trackers.push(
        await ProductionTracker.create({
          expectedDeliveryAt: item.preOrder.expectedDeliveryAt,
          expectedDispatchAt: item.preOrder.expectedDispatchAt,
          history: [{ actorType: "system", stage: "order_received" }],
          orderId: order._id,
          orderNumber: order.orderNumber,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          sku: item.sku,
          stage: "order_received",
          ...(order.userId ? { userId: order.userId } : {}),
          variantId: item.variantId,
        }),
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  return trackers;
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

export async function listAdminPreOrders(filter: { stage?: ProductionStage } = {}) {
  return ProductionTracker.find({
    ...(filter.stage ? { stage: filter.stage } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
}

export async function listCustomerPreOrderTrackers(orderNumber: string, userId?: string) {
  const order = await Order.findOne({
    orderNumber,
    ...(userId ? { userId } : {}),
  }).select("_id");

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  return ProductionTracker.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
}

export async function updateProductionStage(input: {
  trackerIds: string[];
  stage: ProductionStage;
  actor: OrderActor;
  note?: string;
}) {
  if (!productionStages.includes(input.stage)) {
    throw new AppError("Production stage is invalid", 400);
  }

  const trackers = await ProductionTracker.find({
    _id: { $in: input.trackerIds.map((id) => new Types.ObjectId(id)) },
  });

  for (const tracker of trackers) {
    tracker.stage = input.stage;
    tracker.history.push({
      actorId: input.actor.actorId ? new Types.ObjectId(input.actor.actorId) : undefined,
      actorType: input.actor.actorType,
      note: input.note,
      stage: input.stage,
    });
    await tracker.save();
  }

  const orderIds = [...new Set(trackers.map((tracker) => String(tracker.orderId)))];
  if (input.stage === "dispatch") {
    const orders = await Order.find({ _id: { $in: orderIds } });
    for (const order of orders) {
      if (order.status === "in_production") {
        await transitionOrderDocument(order as Parameters<typeof transitionOrderDocument>[0], {
          actor: input.actor,
          note: input.note ?? "Pre-order production dispatched",
          toStatus: "packed",
        });
      }
    }
  } else if (trackers.length) {
    const orders = await Order.find({ _id: { $in: orderIds }, status: "pre_order_confirmed" });
    for (const order of orders) {
      await transitionOrderDocument(order as Parameters<typeof transitionOrderDocument>[0], {
        actor: input.actor,
        note: input.note ?? "Pre-order entered production",
        toStatus: "in_production",
      });
    }
  } else {
    for (const tracker of trackers) {
      await recordOrderTimeline({
        actor: input.actor,
        metadata: { productionStage: input.stage },
        note: input.note,
        order: {
          _id: tracker.orderId,
          orderNumber: tracker.orderNumber,
          status: "in_production",
        },
      });
    }
  }

  return trackers;
}
