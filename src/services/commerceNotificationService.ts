import { Order } from "../models/Order.js";
import { buildStatusUpdateTemplate } from "./emailTemplateService.js";
import { enqueueNotification } from "./notificationDispatchService.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";
import { env } from "../config/env.js";

const customerStatusEvents = new Set([
  "cancelled",
  "packed",
  "ready_to_dispatch",
  "shipped",
  "delivered",
  "returned",
  "refunded",
  "payment_rejected",
]);

export async function notifyOrderStatusChanged(
  order: {
    _id: unknown;
    orderNumber: string;
    guestEmail?: string;
    whatsappOptIn?: boolean;
    shippingAddress?: { fullName?: string; phone?: string };
    shipment?: { carrier?: string; trackingNumber?: string; trackingUrl?: string };
  },
  status: string,
  note?: string,
) {
  if (!customerStatusEvents.has(status)) return null;
  const trackUrl =
    order.shipment?.trackingUrl ??
    `${await publicUrl()}/track-order?order=${encodeURIComponent(order.orderNumber)}`;
  const variables = {
    customerName: order.shippingAddress?.fullName,
    note,
    orderNumber: order.orderNumber,
    status: humanize(status),
    trackingNumber: order.shipment?.trackingNumber,
    trackUrl,
  };
  const fallback = buildStatusUpdateTemplate(variables);
  return Promise.all([
    order.guestEmail
      ? enqueueNotification({
          channel: "email",
          eventType: `order_${status}`,
          fallback,
          relatedEntity: { id: String(order._id), type: "order" },
          to: order.guestEmail,
          variables,
        })
      : null,
    order.whatsappOptIn && order.shippingAddress?.phone
      ? enqueueNotification({
          channel: "whatsapp",
          consentGranted: true,
          eventType: `order_${status}`,
          fallback,
          relatedEntity: { id: String(order._id), type: "order" },
          to: order.shippingAddress.phone,
          variables,
        })
      : null,
  ]);
}

export async function notifyProductionStageChanged(
  tracker: {
    _id: unknown;
    orderId: unknown;
    orderNumber: string;
    productName: string;
  },
  stage: string,
  note?: string,
) {
  const order = (await Order.findById(tracker.orderId)
    .select("guestEmail shippingAddress orderNumber whatsappOptIn")
    .lean()) as {
    guestEmail?: string;
    shippingAddress?: { fullName?: string; phone?: string };
    whatsappOptIn?: boolean;
  } | null;
  if (!order) return null;
  const variables = {
    customerName: order.shippingAddress?.fullName,
    note,
    orderNumber: tracker.orderNumber,
    productName: tracker.productName,
    status: humanize(stage),
    trackUrl: `${await publicUrl()}/track-order?order=${encodeURIComponent(tracker.orderNumber)}`,
  };
  const fallback = buildStatusUpdateTemplate(variables);
  return Promise.all([
    order.guestEmail
      ? enqueueNotification({
          channel: "email",
          eventType: "production_stage_update",
          fallback,
          relatedEntity: { id: String(tracker._id), type: `production-tracker:${stage}` },
          to: order.guestEmail,
          variables,
        })
      : null,
    order.whatsappOptIn && order.shippingAddress?.phone
      ? enqueueNotification({
          channel: "whatsapp",
          consentGranted: true,
          eventType: "production_stage_update",
          fallback,
          relatedEntity: { id: String(tracker._id), type: `production-tracker:${stage}` },
          to: order.shippingAddress.phone,
          variables,
        })
      : null,
  ]);
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function publicUrl() {
  return (await getRuntimeSetting("FRONTEND_PUBLIC_URL")) ?? env.FRONTEND_PUBLIC_URL;
}
