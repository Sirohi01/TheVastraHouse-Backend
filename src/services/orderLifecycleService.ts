import type { HydratedDocument, Types } from "mongoose";
import { AppError } from "../middleware/errorHandler.js";
import { Order, type orderStatuses } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { releaseOrderStock } from "./inventoryService.js";

export type OrderStatus = (typeof orderStatuses)[number];

type OrderDoc = HydratedDocument<{
  _id: Types.ObjectId;
  orderNumber: string;
  userId: Types.ObjectId;
  status: OrderStatus;
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    trackingUrl?: string;
    dispatchedAt?: Date;
    deliveredAt?: Date;
  };
  stockReservations: Array<{
    sku: string;
    quantity: number;
    warehouseId?: Types.ObjectId;
    status?: "reserved" | "released" | "deducted";
  }>;
}>;

export type OrderActor = {
  actorId?: string;
  actorType: "customer" | "admin" | "system";
};

export const orderTransitionGraph: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["confirmed", "payment_verification_pending", "payment_rejected", "cancelled"],
  payment_verification_pending: ["confirmed", "payment_rejected", "cancelled"],
  payment_rejected: ["pending_payment", "cancelled"],
  confirmed: ["in_production", "packed", "ready_to_dispatch", "cancelled"],
  pre_order_confirmed: ["in_production", "cancelled"],
  cod_confirmed: ["in_production", "packed", "ready_to_dispatch", "cancelled"],
  in_production: ["packed", "cancelled"],
  packed: ["ready_to_dispatch", "cancelled"],
  ready_to_dispatch: ["shipped", "cancelled"],
  shipped: ["delivered", "returned"],
  delivered: ["returned", "refunded"],
  returned: ["refunded"],
  cancelled: [],
  refunded: [],
};

const customerCancelableStatuses = new Set<OrderStatus>([
  "pending_payment",
  "payment_verification_pending",
  "payment_rejected",
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
]);

export async function recordOrderTimeline(input: {
  order: { _id: unknown; orderNumber: string; status: OrderStatus };
  fromStatus?: OrderStatus;
  actor: OrderActor;
  note?: string;
  metadata?: Record<string, unknown>;
}) {
  return OrderTimeline.create({
    actorId: input.actor.actorId,
    actorType: input.actor.actorType,
    fromStatus: input.fromStatus,
    metadata: input.metadata,
    note: input.note,
    orderId: input.order._id,
    orderNumber: input.order.orderNumber,
    toStatus: input.order.status,
  });
}

export async function transitionOrderStatus(input: {
  orderId: string;
  toStatus: OrderStatus;
  actor: OrderActor;
  note?: string;
  allowAdminCancelAnyStage?: boolean;
}) {
  const order = (await Order.findById(input.orderId)) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  return transitionOrderDocument(order, input);
}

export async function transitionOrderDocument(
  order: OrderDoc,
  input: {
    toStatus: OrderStatus;
    actor: OrderActor;
    note?: string;
    allowAdminCancelAnyStage?: boolean;
  },
) {
  assertTransitionAllowed(order, input);
  const fromStatus = order.status;

  if (input.toStatus === "cancelled") {
    await releaseStockForCancellation(order, input.actor);
  }

  order.status = input.toStatus;

  if (input.toStatus === "delivered") {
    order.shipment = {
      ...(order.shipment ?? {}),
      deliveredAt: order.shipment?.deliveredAt ?? new Date(),
    };
  }

  await order.save();
  await recordOrderTimeline({
    actor: input.actor,
    fromStatus,
    note: input.note,
    order,
  });
  return order;
}

export async function cancelCustomerOrder(input: {
  orderNumber: string;
  userId: string;
  actor: OrderActor;
  note?: string;
}) {
  const order = (await Order.findOne({
    orderNumber: input.orderNumber,
    userId: input.userId,
  })) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  if (!customerCancelableStatuses.has(order.status)) {
    throw new AppError("Order can no longer be cancelled by customer", 409);
  }

  return transitionOrderDocument(order, {
    actor: input.actor,
    note: input.note,
    toStatus: "cancelled",
  });
}

export async function cancelAdminOrder(input: {
  orderId: string;
  actor: OrderActor;
  note?: string;
}) {
  return transitionOrderStatus({
    actor: input.actor,
    allowAdminCancelAnyStage: true,
    note: input.note,
    orderId: input.orderId,
    toStatus: "cancelled",
  });
}

export async function updateShipment(input: {
  orderId: string;
  actor: OrderActor;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  dispatchedAt?: Date;
  note?: string;
}) {
  const order = (await Order.findById(input.orderId)) as OrderDoc | null;

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  order.shipment = {
    ...(order.shipment ?? {}),
    carrier: input.carrier,
    dispatchedAt: input.dispatchedAt ?? order.shipment?.dispatchedAt ?? new Date(),
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
  };

  if (order.status === "shipped") {
    await order.save();
    await recordOrderTimeline({
      actor: input.actor,
      fromStatus: order.status,
      metadata: { shipment: order.shipment },
      note: input.note ?? "Shipment updated",
      order,
    });
    return order;
  }

  return transitionOrderDocument(order, {
    actor: input.actor,
    note: input.note ?? "Shipment dispatched",
    toStatus: "shipped",
  });
}

export async function bulkTransitionOrders(input: {
  filter: { status?: OrderStatus; orderNumbers?: string[] };
  toStatus: OrderStatus;
  actor: OrderActor;
  note?: string;
}) {
  const orders = (await Order.find({
    ...(input.filter.status ? { status: input.filter.status } : {}),
    ...(input.filter.orderNumbers?.length
      ? { orderNumber: { $in: input.filter.orderNumbers } }
      : {}),
  })) as OrderDoc[];
  const updated: string[] = [];
  const failed: Array<{ orderNumber: string; reason: string }> = [];

  for (const order of orders) {
    try {
      await transitionOrderDocument(order, {
        actor: input.actor,
        note: input.note,
        toStatus: input.toStatus,
      });
      updated.push(order.orderNumber);
    } catch (error) {
      failed.push({
        orderNumber: order.orderNumber,
        reason: error instanceof Error ? error.message : "Transition failed",
      });
    }
  }

  return { failed, matched: orders.length, updated };
}

export async function getOrderWithTimeline(filter: { orderNumber: string; userId?: string }) {
  const order = await Order.findOne({
    orderNumber: filter.orderNumber,
    ...(filter.userId ? { userId: filter.userId } : {}),
  }).lean();

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const timeline = await OrderTimeline.find({ orderNumber: filter.orderNumber })
    .sort({ createdAt: 1 })
    .lean();

  return { order, timeline };
}

function assertTransitionAllowed(
  order: OrderDoc,
  input: {
    toStatus: OrderStatus;
    actor: OrderActor;
    allowAdminCancelAnyStage?: boolean;
  },
) {
  if (order.status === input.toStatus) {
    throw new AppError("Order is already in requested status", 409);
  }

  if (input.actor.actorType === "customer" && input.toStatus !== "cancelled") {
    throw new AppError("Customers can only cancel eligible orders", 403);
  }

  if (
    input.toStatus === "cancelled" &&
    input.actor.actorType === "admin" &&
    input.allowAdminCancelAnyStage &&
    !["cancelled", "refunded"].includes(order.status)
  ) {
    return;
  }

  const allowed = orderTransitionGraph[order.status]?.includes(input.toStatus);

  if (!allowed) {
    throw new AppError(
      `Invalid order status transition: ${order.status} -> ${input.toStatus}`,
      409,
    );
  }
}

async function releaseStockForCancellation(order: OrderDoc, actor: OrderActor) {
  await releaseOrderStock({
    actor,
    referenceId: order.orderNumber,
    reservations: order.stockReservations,
  });

  for (const reservation of order.stockReservations) {
    reservation.status = "released";
  }
}
