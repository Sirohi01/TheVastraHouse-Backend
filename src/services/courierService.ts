import crypto from "node:crypto";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { Order } from "../models/Order.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { logger } from "../utils/logger.js";
import { recordOrderTimeline, transitionOrderDocument, type OrderStatus } from "./orderLifecycleService.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";

/**
 * Phase 35 — Logistics & Courier Integration. Carriers sit behind one adapter interface so a
 * new courier (or region) is an additional adapter, not a rewrite. "manual" is always
 * available as the fallback when a carrier API is down or not configured.
 */
export type CreatedShipment = {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl?: string;
  providerShipmentId?: string;
  providerOrderId?: string;
};

export type TrackingUpdate = {
  trackingNumber: string;
  status: string;
  location?: string;
  occurredAt: Date;
  mappedStatus?: "shipped" | "delivered";
};

type ShippableOrder = {
  _id: unknown;
  orderNumber: string;
  createdAt?: Date;
  paymentSessionId?: unknown;
  shippingAddress?: {
    fullName?: string;
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    countryCode: string;
    phone?: string;
  };
  guestEmail?: string;
  items: Array<{ productName: string; sku: string; quantity: number; unitPrice: number; hsnCode: string; gstRate: number }>;
  totals: { grandTotal: number; shippingFee: number; discountTotal: number };
};

const SHIPROCKET_API = "https://apiv2.shiprocket.in/v1/external";
let shiprocketToken: { value: string; expiresAt: number } | undefined;

async function shiprocketCredentials() {
  const [email, password, pickup] = await Promise.all([
    getRuntimeSetting("SHIPROCKET_EMAIL"),
    getRuntimeSetting("SHIPROCKET_PASSWORD"),
    getRuntimeSetting("SHIPROCKET_PICKUP_LOCATION"),
  ]);
  return { email: email || "", password: password || "", pickup: pickup || env.SHIPROCKET_PICKUP_LOCATION };
}

async function shiprocketRequest<T>(path: string, body: unknown): Promise<T> {
  const token = await shiprocketAuth();
  const response = await fetch(`${SHIPROCKET_API}${path}`, {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };

  if (!response.ok) {
    if (response.status === 401) shiprocketToken = undefined;
    throw new AppError(`Shiprocket ${path} failed: ${payload.message ?? response.status}`, 502);
  }

  return payload;
}

async function shiprocketAuth() {
  if (shiprocketToken && shiprocketToken.expiresAt > Date.now()) {
    return shiprocketToken.value;
  }

  const credentials = await shiprocketCredentials();
  if (!credentials.email || !credentials.password) {
    throw new AppError("Shiprocket credentials are not configured (Settings > Shipping)", 503);
  }

  const response = await fetch(`${SHIPROCKET_API}/auth/login`, {
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { token?: string; message?: string };

  if (!response.ok || !payload.token) {
    throw new AppError(`Shiprocket login failed: ${payload.message ?? response.status}`, 502);
  }

  // Tokens are valid for 10 days; refresh a day early.
  shiprocketToken = { expiresAt: Date.now() + 9 * 86_400_000, value: payload.token };
  return payload.token;
}

/** Builds the Shiprocket ad-hoc order. Secured-COD orders collect only the unpaid balance. */
export function buildShiprocketOrder(order: ShippableOrder, outstanding: number, pickupLocation: string, email: string) {
  const address = order.shippingAddress;
  if (!address?.postalCode || !address.phone) {
    throw new AppError("Shipping address needs a PIN code and phone number for courier booking", 400);
  }

  const itemTotal = order.items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const isCod = outstanding > 0;
  const orderValue = itemTotal + order.totals.shippingFee;
  const [firstName, ...rest] = (address.fullName ?? "Customer").split(" ");

  return {
    billing_address: [address.line1, address.line2].filter(Boolean).join(", "),
    billing_city: address.city,
    billing_country: address.countryCode === "IN" ? "India" : address.countryCode,
    billing_customer_name: firstName,
    billing_email: email,
    billing_last_name: rest.join(" "),
    billing_phone: address.phone.replace(/\D/g, "").slice(-10),
    billing_pincode: address.postalCode,
    billing_state: address.region ?? "",
    breadth: 25,
    height: 5,
    length: 30,
    order_date: (order.createdAt ?? new Date()).toISOString().slice(0, 16).replace("T", " "),
    order_id: order.orderNumber,
    order_items: order.items.map((item) => ({
      hsn: item.hsnCode,
      name: item.productName.slice(0, 100),
      selling_price: item.unitPrice,
      sku: item.sku,
      tax: item.gstRate,
      units: item.quantity,
    })),
    payment_method: isCod ? "COD" : "Prepaid",
    pickup_location: pickupLocation,
    shipping_charges: order.totals.shippingFee,
    shipping_is_billing: true,
    sub_total: itemTotal,
    // For COD the courier must collect only what is still unpaid (the online advance is netted off).
    total_discount: isCod ? Math.max(0, orderValue - outstanding) : order.totals.discountTotal,
    weight: Math.max(0.3, order.items.reduce((total, item) => total + item.quantity, 0) * 0.4),
  };
}

async function createShiprocketShipment(order: ShippableOrder): Promise<CreatedShipment> {
  const credentials = await shiprocketCredentials();
  const session = order.paymentSessionId
    ? ((await PaymentSession.findById(order.paymentSessionId).select("outstandingAmount").lean()) as unknown as {
        outstandingAmount?: number;
      } | null)
    : null;
  const created = await shiprocketRequest<{ order_id?: number; shipment_id?: number }>(
    "/orders/create/adhoc",
    buildShiprocketOrder(order, session?.outstandingAmount ?? 0, credentials.pickup, order.guestEmail ?? env.COMPANY_EMAIL),
  );

  if (!created.shipment_id) {
    throw new AppError("Shiprocket did not return a shipment id", 502);
  }

  const awb = await shiprocketRequest<{ response?: { data?: { awb_code?: string; courier_name?: string } } }>(
    "/courier/assign/awb",
    { shipment_id: created.shipment_id },
  );
  const awbCode = awb.response?.data?.awb_code;

  if (!awbCode) {
    throw new AppError("Shiprocket could not assign an AWB. Try again or enter tracking manually.", 502);
  }

  const label = await shiprocketRequest<{ label_url?: string }>("/courier/generate/label", {
    shipment_id: [created.shipment_id],
  });
  await shiprocketRequest("/courier/generate/pickup", { shipment_id: [created.shipment_id] }).catch((error) =>
    logger.warn({ error, orderNumber: order.orderNumber }, "Shiprocket pickup request failed; schedule manually"),
  );

  return {
    carrier: awb.response?.data?.courier_name ?? "Shiprocket",
    labelUrl: label.label_url,
    providerOrderId: String(created.order_id ?? ""),
    providerShipmentId: String(created.shipment_id),
    trackingNumber: awbCode,
    trackingUrl: `https://shiprocket.co/tracking/${awbCode}`,
  };
}

export async function activeCourierProvider() {
  const configured = (await getRuntimeSetting("COURIER_PROVIDER")) || env.COURIER_PROVIDER;
  return configured === "shiprocket" ? "shiprocket" : "manual";
}

/**
 * Books a courier shipment for an order that is ready to dispatch. On carrier failure nothing
 * changes on the order and the error explains how to fall back to manual entry.
 */
export async function bookCourierShipment(orderId: string, actorId?: string) {
  const provider = await activeCourierProvider();

  if (provider === "manual") {
    throw new AppError("No courier integration is enabled. Enter the carrier and AWB manually.", 409);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError("Order not found", 404);
  if (!["packed", "ready_to_dispatch"].includes(order.status)) {
    throw new AppError("Courier booking is available once an order is packed or ready to dispatch", 409);
  }
  if (order.shipment?.providerShipmentId) {
    throw new AppError("A courier shipment already exists for this order", 409);
  }

  const shipment = await createShiprocketShipment(order.toObject() as unknown as ShippableOrder);
  order.set("shipment", {
    ...(order.shipment ? (order.shipment as { toObject?: () => object }).toObject?.() ?? order.shipment : {}),
    ...shipment,
    courierStatus: "AWB_ASSIGNED",
    provider,
  });
  await order.save();
  await recordOrderTimeline({
    actor: { actorId, actorType: actorId ? "admin" : "system" },
    fromStatus: order.status as OrderStatus,
    metadata: { provider, trackingNumber: shipment.trackingNumber },
    note: `Courier booked with ${shipment.carrier} (AWB ${shipment.trackingNumber})`,
    order: order as never,
  });

  return order;
}

/** Normalises Shiprocket tracking webhook payloads. */
export function parseShiprocketWebhook(body: Record<string, unknown>): TrackingUpdate | null {
  const trackingNumber = String(body.awb ?? body.awb_code ?? "").trim();
  if (!trackingNumber) return null;

  const status = String(body.current_status ?? body.shipment_status ?? "").toUpperCase();
  const scans = Array.isArray(body.scans) ? (body.scans as Array<Record<string, unknown>>) : [];
  const latest = scans[scans.length - 1];
  const mappedStatus = /DELIVERED/.test(status) && !/UNDELIVERED|RTO/.test(status)
    ? "delivered"
    : /PICKED|SHIPPED|IN TRANSIT|OUT FOR DELIVERY|REACHED/.test(status)
      ? "shipped"
      : undefined;

  return {
    location: latest ? String(latest.location ?? "") : undefined,
    mappedStatus,
    occurredAt: new Date(String(body.current_timestamp ?? latest?.date ?? new Date().toISOString())),
    status,
    trackingNumber,
  };
}

export async function verifyShiprocketWebhook(token: string | undefined) {
  const expected = (await getRuntimeSetting("SHIPROCKET_WEBHOOK_TOKEN")) || env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Applies a carrier tracking update: records the scan and advances order status. */
export async function applyTrackingUpdate(update: TrackingUpdate) {
  const order = await Order.findOne({ "shipment.trackingNumber": update.trackingNumber });
  if (!order) return { matched: false };

  const events = [...((order.shipment?.events as unknown[]) ?? [])];
  events.push({ location: update.location, occurredAt: update.occurredAt, status: update.status });
  order.set("shipment.events", events.slice(-50));
  order.set("shipment.courierStatus", update.status);
  await order.save();

  if (update.mappedStatus === "shipped" && ["packed", "ready_to_dispatch"].includes(order.status)) {
    if (order.status === "packed") {
      await transitionOrderDocument(order as never, { actor: { actorType: "system" }, note: "Courier pickup", toStatus: "ready_to_dispatch" });
    }
    await transitionOrderDocument(order as never, { actor: { actorType: "system" }, note: `Courier: ${update.status}`, toStatus: "shipped" });
  }

  if (update.mappedStatus === "delivered" && order.status === "shipped") {
    order.set("shipment.deliveredAt", update.occurredAt);
    await transitionOrderDocument(order as never, { actor: { actorType: "system" }, note: "Courier: delivered", toStatus: "delivered" });
  }

  return { matched: true, orderNumber: order.orderNumber };
}
