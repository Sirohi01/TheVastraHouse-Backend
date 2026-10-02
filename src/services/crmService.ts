import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { CustomerSegment } from "../models/MarketingCampaign.js";
import { NotificationLog } from "../models/NotificationLog.js";
import { Order } from "../models/Order.js";
import { OrderTimeline } from "../models/OrderTimeline.js";
import { ProductReview } from "../models/ProductReview.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { SupportTicket } from "../models/SupportTicket.js";
import { User } from "../models/User.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

/** Orders that represent real revenue (paid or committed); excludes unpaid and cancelled. */
export const REVENUE_STATUSES = [
  "confirmed",
  "pre_order_confirmed",
  "cod_confirmed",
  "in_production",
  "packed",
  "ready_to_dispatch",
  "shipped",
  "delivered",
];

export const CUSTOMER_SEGMENTS = ["new", "repeat", "vip", "wholesale", "inactive"] as const;
export type CustomerSegmentKey = (typeof CUSTOMER_SEGMENTS)[number];

export type CustomerStats = {
  orderCount: number;
  lifetimeValue: number;
  firstOrderAt?: Date;
  lastOrderAt?: Date;
};

export async function segmentThresholds() {
  const [vipSpend, vipOrders, inactiveDays, newDays] = await Promise.all([
    getRuntimeNumberSetting("CRM_VIP_LIFETIME_VALUE", env.CRM_VIP_LIFETIME_VALUE),
    getRuntimeNumberSetting("CRM_VIP_ORDER_COUNT", env.CRM_VIP_ORDER_COUNT),
    getRuntimeNumberSetting("CRM_INACTIVE_DAYS", env.CRM_INACTIVE_DAYS),
    getRuntimeNumberSetting("CRM_NEW_CUSTOMER_DAYS", env.CRM_NEW_CUSTOMER_DAYS),
  ]);
  return { inactiveDays, newDays, vipOrders, vipSpend };
}

/**
 * Rule-based classification (FR-CRM-04). Priority: Wholesale > Inactive > VIP > Repeat > New.
 * Thresholds are runtime settings so the business can tune them without a deploy.
 */
export function classifyCustomer(
  stats: CustomerStats,
  customerType: string | undefined,
  thresholds: Awaited<ReturnType<typeof segmentThresholds>>,
  now = new Date(),
): CustomerSegmentKey {
  if (customerType === "wholesale") return "wholesale";

  const daysSinceLastOrder = stats.lastOrderAt
    ? (now.getTime() - stats.lastOrderAt.getTime()) / 86_400_000
    : undefined;

  if (
    stats.orderCount > 0 &&
    daysSinceLastOrder !== undefined &&
    daysSinceLastOrder > thresholds.inactiveDays
  ) {
    return "inactive";
  }
  if (stats.lifetimeValue >= thresholds.vipSpend || stats.orderCount >= thresholds.vipOrders) {
    return "vip";
  }
  if (stats.orderCount >= 2) return "repeat";
  return "new";
}

async function statsForUsers(userIds: Types.ObjectId[]) {
  const rows = (await Order.aggregate([
    { $match: { status: { $in: REVENUE_STATUSES }, userId: { $in: userIds } } },
    {
      $group: {
        _id: "$userId",
        firstOrderAt: { $min: "$createdAt" },
        lastOrderAt: { $max: "$createdAt" },
        lifetimeValue: { $sum: "$totals.grandTotal" },
        orderCount: { $sum: 1 },
      },
    },
  ])) as Array<CustomerStats & { _id: Types.ObjectId }>;

  return new Map(rows.map((row) => [String(row._id), row]));
}

/** Recomputes LTV, order counts and segments for all customers (scheduled job). */
export async function recomputeCustomerSegments(batchSize = 500) {
  const thresholds = await segmentThresholds();
  let lastId: Types.ObjectId | undefined;
  let updated = 0;

  for (;;) {
    const users = (await User.find({
      type: "customer",
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .select("_id customerType")
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean()) as unknown as Array<{ _id: Types.ObjectId; customerType?: string }>;

    if (!users.length) break;

    const stats = await statsForUsers(users.map((user) => user._id));
    await User.bulkWrite(
      users.map((user) => {
        const row: CustomerStats = stats.get(String(user._id)) ?? {
          lifetimeValue: 0,
          orderCount: 0,
        };
        return {
          updateOne: {
            filter: { _id: user._id },
            update: {
              $set: {
                "crm.firstOrderAt": row.firstOrderAt,
                "crm.lastOrderAt": row.lastOrderAt,
                "crm.orderCount": row.orderCount,
                "crm.segment": classifyCustomer(row, user.customerType, thresholds),
                "crm.segmentComputedAt": new Date(),
                lifetimeOrderValue: row.lifetimeValue,
              },
            },
          },
        };
      }),
    );
    updated += users.length;
    lastId = users[users.length - 1]._id;
  }

  return { updated };
}

export async function listCustomers(
  filter: { segment?: string; search?: string; tag?: string; customerType?: string },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = { anonymizedAt: { $exists: false }, type: "customer" };

  if (filter.segment) query["crm.segment"] = filter.segment;
  if (filter.tag) query["crm.tags"] = filter.tag.toLowerCase();
  if (filter.customerType) query.customerType = filter.customerType;
  if (filter.search) {
    const pattern = { $options: "i", $regex: filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
    query.$or = [
      { email: pattern },
      { firstName: pattern },
      { lastName: pattern },
      { phone: pattern },
    ];
  }

  const [items, total] = await Promise.all([
    User.find(query)
      .select(
        "email firstName lastName phone customerType wholesaleStatus lifetimeOrderValue crm createdAt lastLoginAt marketingConsentAt status",
      )
      .sort({ lifetimeOrderValue: -1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return buildPaginatedResult(items, total, pagination);
}

export async function getSegmentCounts() {
  const rows = (await User.aggregate([
    { $match: { anonymizedAt: { $exists: false }, type: "customer" } },
    { $group: { _id: "$crm.segment", count: { $sum: 1 } } },
  ])) as Array<{ _id: string | null; count: number }>;

  return Object.fromEntries(
    CUSTOMER_SEGMENTS.map((segment) => [
      segment,
      rows.find((row) => row._id === segment)?.count ?? 0,
    ]),
  );
}

type TimelineEvent = {
  at: Date;
  kind:
    | "order"
    | "order_status"
    | "review"
    | "ticket"
    | "notification"
    | "return"
    | "note"
    | "account";
  title: string;
  detail?: string;
  href?: string;
};

/** Unified profile + chronological timeline (FR-CRM-01/02/03). */
export async function getCustomerProfile(userId: string) {
  if (!Types.ObjectId.isValid(userId)) {
    throw new AppError("Customer not found", 404);
  }

  const user = (await User.findOne({ _id: userId, type: "customer" })
    .select("-passwordHash -totpSecret")
    .lean()) as
    | (Record<string, unknown> & {
        email: string;
        createdAt?: Date;
        crm?: { notes?: Array<{ body: string; createdAt: Date; authorId?: unknown }> };
        customerType?: string;
      })
    | null;

  if (!user) {
    throw new AppError("Customer not found", 404);
  }

  const objectId = new Types.ObjectId(userId);
  const [orders, reviews, tickets, notifications, returns, statsMap, thresholds] =
    await Promise.all([
      Order.find({ userId: objectId })
        .select(
          "orderNumber status totals createdAt paymentMethod items.productName items.quantity",
        )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean() as unknown as Promise<
        Array<{
          orderNumber: string;
          status: string;
          totals: { grandTotal: number };
          createdAt: Date;
        }>
      >,
      ProductReview.find({ userId: objectId })
        .populate("productId", "name slug")
        .select("rating title moderationStatus createdAt productId")
        .limit(50)
        .lean() as unknown as Promise<
        Array<{
          rating: number;
          moderationStatus: string;
          createdAt: Date;
          productId?: { name?: string };
        }>
      >,
      SupportTicket.find({ $or: [{ userId: objectId }, { email: user.email }] })
        .select("ticketNumber subject status createdAt")
        .limit(50)
        .lean() as unknown as Promise<
        Array<{ ticketNumber: string; subject: string; status: string; createdAt: Date }>
      >,
      NotificationLog.find({ to: user.email })
        .select("eventType channel status subject createdAt")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean() as unknown as Promise<
        Array<{
          eventType: string;
          channel: string;
          status: string;
          subject?: string;
          createdAt: Date;
        }>
      >,
      ReturnRequest.find({ userId: objectId })
        .select("returnNumber status createdAt")
        .limit(50)
        .lean() as unknown as Promise<
        Array<{ returnNumber?: string; status: string; createdAt: Date }>
      >,
      statsForUsers([objectId]),
      segmentThresholds(),
    ]);
  const statusEvents = orders.length
    ? ((await OrderTimeline.find({ orderNumber: { $in: orders.map((order) => order.orderNumber) } })
        .select("orderNumber toStatus createdAt note")
        .limit(300)
        .lean()) as unknown as Array<{
        orderNumber: string;
        toStatus: string;
        createdAt: Date;
        note?: string;
      }>)
    : [];
  const stats = statsMap.get(userId) ?? { lifetimeValue: 0, orderCount: 0 };
  const timeline = (
    [
      { at: user.createdAt ?? new Date(0), kind: "account", title: "Account created" },
      ...orders.map((order) => ({
        at: order.createdAt,
        detail: `₹${order.totals?.grandTotal ?? 0} · ${order.status}`,
        href: `/admin/orders?search=${order.orderNumber}`,
        kind: "order" as const,
        title: `Placed order ${order.orderNumber}`,
      })),
      ...statusEvents.map((event) => ({
        at: event.createdAt,
        detail: event.note,
        kind: "order_status" as const,
        title: `${event.orderNumber} → ${event.toStatus}`,
      })),
      ...reviews.map((review) => ({
        at: review.createdAt,
        detail: `${review.rating}★ · ${review.moderationStatus}`,
        kind: "review" as const,
        title: `Reviewed ${review.productId?.name ?? "a product"}`,
      })),
      ...tickets.map((ticket) => ({
        at: ticket.createdAt,
        detail: ticket.status,
        href: `/admin/support?ticket=${ticket.ticketNumber}`,
        kind: "ticket" as const,
        title: `Support ticket ${ticket.ticketNumber}: ${ticket.subject}`,
      })),
      ...notifications.map((log) => ({
        at: log.createdAt,
        detail: `${log.channel} · ${log.status}`,
        kind: "notification" as const,
        title: log.subject ?? log.eventType,
      })),
      ...returns.map((request) => ({
        at: request.createdAt,
        detail: request.status,
        kind: "return" as const,
        title: `Return ${request.returnNumber ?? ""}`.trim(),
      })),
      ...(user.crm?.notes ?? []).map((note) => ({
        at: note.createdAt,
        detail: note.body,
        kind: "note" as const,
        title: "Internal note",
      })),
    ] as TimelineEvent[]
  ).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    customer: user,
    orders,
    segment: classifyCustomer(stats, user.customerType, thresholds),
    stats: {
      ...stats,
      averageOrderValue: stats.orderCount ? Math.round(stats.lifetimeValue / stats.orderCount) : 0,
    },
    timeline,
  };
}

export async function addCustomerNote(userId: string, body: string, authorId: string) {
  const user = await User.findOneAndUpdate(
    { _id: userId, type: "customer" },
    { $push: { "crm.notes": { authorId, body, createdAt: new Date() } } },
    { new: true },
  ).select("crm");

  if (!user) throw new AppError("Customer not found", 404);
  return user.crm;
}

export async function setCustomerTags(userId: string, tags: string[]) {
  const normalized = [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 30);
  const user = await User.findOneAndUpdate(
    { _id: userId, type: "customer" },
    { $set: { "crm.tags": normalized } },
    { new: true },
  ).select("crm");

  if (!user) throw new AppError("Customer not found", 404);
  return user.crm;
}

type SegmentRules = {
  minOrders?: number;
  maxOrders?: number;
  minSpend?: number;
  maxSpend?: number;
  lastOrderWithinDays?: number;
  noOrderForDays?: number;
  customerType?: string;
  tags?: string[];
  marketingConsentOnly?: boolean;
};

/** Translates custom segment rules (FR-CRM-05) into a customer query. */
export function customSegmentQuery(rules: SegmentRules, now = new Date()) {
  const query: Record<string, unknown> = {
    anonymizedAt: { $exists: false },
    status: "active",
    type: "customer",
  };
  const orderCount: Record<string, number> = {};
  const spend: Record<string, number> = {};

  if (rules.minOrders !== undefined) orderCount.$gte = rules.minOrders;
  if (rules.maxOrders !== undefined) orderCount.$lte = rules.maxOrders;
  if (Object.keys(orderCount).length) query["crm.orderCount"] = orderCount;
  if (rules.minSpend !== undefined) spend.$gte = rules.minSpend;
  if (rules.maxSpend !== undefined) spend.$lte = rules.maxSpend;
  if (Object.keys(spend).length) query.lifetimeOrderValue = spend;
  if (rules.lastOrderWithinDays !== undefined) {
    query["crm.lastOrderAt"] = {
      $gte: new Date(now.getTime() - rules.lastOrderWithinDays * 86_400_000),
    };
  }
  if (rules.noOrderForDays !== undefined) {
    query["crm.lastOrderAt"] = {
      $lte: new Date(now.getTime() - rules.noOrderForDays * 86_400_000),
    };
  }
  if (rules.customerType) query.customerType = rules.customerType;
  if (rules.tags?.length) query["crm.tags"] = { $all: rules.tags.map((tag) => tag.toLowerCase()) };
  if (rules.marketingConsentOnly !== false) query["notificationPreferences.marketingEmail"] = true;

  return query;
}

export async function previewCustomSegment(rules: SegmentRules) {
  const query = customSegmentQuery(rules);
  const [count, sample] = await Promise.all([
    User.countDocuments(query),
    User.find(query)
      .select("email firstName lastName lifetimeOrderValue crm.segment")
      .limit(20)
      .lean(),
  ]);
  return { count, sample };
}

export async function saveCustomSegment(
  input: { name: string; description?: string; rules: SegmentRules },
  createdBy: string,
) {
  return CustomerSegment.create({ ...input, createdBy });
}

export async function listCustomSegments() {
  const segments = (await CustomerSegment.find({})
    .sort({ createdAt: -1 })
    .lean()) as unknown as Array<{ rules: SegmentRules } & Record<string, unknown>>;
  return Promise.all(
    segments.map(async (segment) => ({
      ...segment,
      size: await User.countDocuments(customSegmentQuery(segment.rules)),
    })),
  );
}

export async function deleteCustomSegment(id: string) {
  await CustomerSegment.deleteOne({ _id: id });
}
