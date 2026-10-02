import type { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { AbandonedCartEvent } from "../models/AbandonedCartEvent.js";
import { Cart } from "../models/Cart.js";
import { Coupon } from "../models/Coupon.js";
import {
  AutomationSetting,
  CustomerSegment,
  MarketingCampaign,
} from "../models/MarketingCampaign.js";
import { NewsletterSubscriber } from "../models/NewsletterSubscriber.js";
import { NotificationJob } from "../models/NotificationJob.js";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { customSegmentQuery, REVENUE_STATUSES } from "./crmService.js";
import { unsubscribeUrlForEmail } from "./engagementService.js";
import { htmlToPlainText, sanitizeRichHtml } from "./htmlSanitizer.js";
import { enqueueNotification } from "./notificationDispatchService.js";

type AutomationKey = "abandoned_cart" | "win_back" | "review_request" | "welcome" | "back_in_stock";

const AUTOMATION_DEFAULTS: Record<AutomationKey, { enabled: boolean; delayHours: number }> = {
  abandoned_cart: { delayHours: 1, enabled: true },
  back_in_stock: { delayHours: 0, enabled: true },
  review_request: { delayHours: 72, enabled: true },
  welcome: { delayHours: 0, enabled: true },
  win_back: { delayHours: 0, enabled: true },
};

function siteUrl(path: string) {
  return `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}${path}`;
}

function withUtm(path: string, campaign: string, medium = "email") {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}utm_source=vastra_${medium}&utm_medium=${medium}&utm_campaign=${encodeURIComponent(campaign)}`;
}

// ---------- Automations ----------

export async function getAutomationSettings() {
  const rows = (await AutomationSetting.find({}).lean()) as unknown as Array<
    { key: AutomationKey } & Record<string, unknown>
  >;
  return (Object.keys(AUTOMATION_DEFAULTS) as AutomationKey[]).map((key) => ({
    key,
    ...AUTOMATION_DEFAULTS[key],
    ...(rows.find((row) => row.key === key) ?? {}),
  }));
}

export async function updateAutomationSetting(
  key: AutomationKey,
  input: { enabled?: boolean; delayHours?: number; couponCode?: string | null },
) {
  if (input.couponCode) {
    const coupon = await Coupon.exists({ active: true, code: input.couponCode.toUpperCase() });
    if (!coupon)
      throw new AppError(`Coupon ${input.couponCode} does not exist or is inactive`, 400);
  }

  return AutomationSetting.findOneAndUpdate(
    { key },
    {
      $set: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.delayHours !== undefined ? { delayHours: input.delayHours } : {}),
        ...(input.couponCode !== undefined
          ? { couponCode: input.couponCode?.toUpperCase() || undefined }
          : {}),
      },
    },
    { new: true, upsert: true },
  ).lean();
}

async function automation(key: AutomationKey) {
  const row = (await AutomationSetting.findOne({ key }).lean()) as unknown as {
    enabled?: boolean;
    delayHours?: number;
    couponCode?: string;
  } | null;
  return { ...AUTOMATION_DEFAULTS[key], ...(row ?? {}) };
}

async function markRun(key: AutomationKey, sent: number) {
  await AutomationSetting.updateOne(
    { key },
    { $inc: { sentCount: sent }, $set: { lastRunAt: new Date() } },
    { upsert: true },
  );
}

/** FR-MKT-04: one recovery email per abandoned cart, only to consented contacts. */
export async function runAbandonedCartRecovery(now = new Date()) {
  const config = await automation("abandoned_cart");
  if (!config.enabled) return { sent: 0, skipped: "disabled" };

  const cutoff = new Date(now.getTime() - config.delayHours * 3_600_000);
  const events = (await AbandonedCartEvent.find({
    email: { $exists: true, $ne: null },
    emittedAt: { $lte: cutoff, $gte: new Date(now.getTime() - 7 * 86_400_000) },
    recoveryEmailSentAt: { $exists: false },
  })
    .limit(200)
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    cartId: Types.ObjectId;
    email: string;
    userId?: Types.ObjectId;
  }>;
  let sent = 0;

  for (const event of events) {
    const claimed = await AbandonedCartEvent.updateOne(
      { _id: event._id, recoveryEmailSentAt: { $exists: false } },
      { $set: { recoveryEmailSentAt: new Date() } },
    );
    if (!claimed.modifiedCount) continue;

    const cart = (await Cart.findById(event.cartId).lean()) as unknown as {
      items?: Array<{ productName: string; quantity: number }>;
    } | null;
    if (!cart?.items?.length) continue;

    const lines = cart.items.map((item) => `• ${item.productName} × ${item.quantity}`).join("\n");
    const coupon = config.couponCode
      ? `\n\nUse code ${config.couponCode} for a little something off.`
      : "";
    await enqueueNotification({
      channel: "email",
      eventType: "abandoned_cart_recovery",
      fallback: {
        subject: "You left something beautiful behind",
        text: `Your cart is waiting:\n\n${lines}${coupon}\n\nComplete your order: ${siteUrl(withUtm("/cart", "abandoned_cart"))}\n\nUnsubscribe: ${unsubscribeUrlForEmail({ userId: event.userId ? String(event.userId) : undefined })}`,
      },
      relatedEntity: { id: String(event._id), type: "abandoned-cart" },
      to: event.email,
      variables: {},
    });
    sent += 1;
  }

  await markRun("abandoned_cart", sent);
  return { sent };
}

/** FR-MKT-05: win-back for Inactive customers who consented, at most once per 90 days. */
export async function runWinBackCampaign() {
  const config = await automation("win_back");
  if (!config.enabled) return { sent: 0, skipped: "disabled" };

  const customers = (await User.find({
    anonymizedAt: { $exists: false },
    "crm.segment": "inactive",
    "notificationPreferences.marketingEmail": true,
    status: "active",
    type: "customer",
  })
    .select("email firstName")
    .limit(500)
    .lean()) as unknown as Array<{ _id: Types.ObjectId; email: string; firstName?: string }>;
  const recent = new Set(
    (
      (await NotificationJob.distinct("to", {
        createdAt: { $gte: new Date(Date.now() - 90 * 86_400_000) },
        eventType: "win_back",
      })) as string[]
    ).map((email) => email.toLowerCase()),
  );
  let sent = 0;

  for (const customer of customers) {
    if (recent.has(customer.email.toLowerCase())) continue;
    const coupon = config.couponCode
      ? `\n\nAs a welcome back, use code ${config.couponCode} at checkout.`
      : "";
    await enqueueNotification({
      channel: "email",
      eventType: "win_back",
      fallback: {
        subject: "We have missed you at The Vastra House",
        text: `Hi ${customer.firstName ?? "there"},\n\nIt has been a while. Discover what is new this season: ${siteUrl(withUtm("/shop?sort=-newest", "win_back"))}${coupon}\n\nUnsubscribe: ${unsubscribeUrlForEmail({ userId: String(customer._id) })}`,
      },
      to: customer.email,
      variables: {},
    });
    sent += 1;
  }

  await markRun("win_back", sent);
  return { sent };
}

/** FR-MKT-06: review request after delivery (configurable delay), once per order. */
export async function runReviewRequests(now = new Date()) {
  const config = await automation("review_request");
  if (!config.enabled) return { sent: 0, skipped: "disabled" };

  const deliveredBefore = new Date(now.getTime() - config.delayHours * 3_600_000);
  const orders = (await Order.find({
    reviewRequestSentAt: { $exists: false },
    "shipment.deliveredAt": {
      $lte: deliveredBefore,
      $gte: new Date(now.getTime() - 60 * 86_400_000),
    },
    status: "delivered",
    userId: { $exists: true },
  })
    .select("orderNumber userId items.productName items.slug")
    .limit(200)
    .lean()) as unknown as Array<{
    _id: Types.ObjectId;
    orderNumber: string;
    userId: Types.ObjectId;
    items: Array<{ productName: string; slug: string }>;
  }>;
  let sent = 0;

  for (const order of orders) {
    const claimed = await Order.updateOne(
      { _id: order._id, reviewRequestSentAt: { $exists: false } },
      { $set: { reviewRequestSentAt: new Date() } },
    );
    if (!claimed.modifiedCount) continue;

    const user = (await User.findById(order.userId)
      .select("email firstName notificationPreferences.reviewRequests")
      .lean()) as unknown as {
      email: string;
      firstName?: string;
      notificationPreferences?: { reviewRequests?: boolean };
    } | null;
    if (!user || user.notificationPreferences?.reviewRequests === false) continue;

    const links = order.items
      .map(
        (item) =>
          `• ${item.productName}: ${siteUrl(withUtm(`/shop/${item.slug}#reviews`, "review_request"))}`,
      )
      .join("\n");
    await enqueueNotification({
      channel: "email",
      eventType: "review_request",
      fallback: {
        subject: `How was your order ${order.orderNumber}?`,
        text: `Hi ${user.firstName ?? "there"},\n\nWe hope you love your purchase. A short review helps other shoppers choose the right size and fit:\n\n${links}`,
      },
      relatedEntity: { id: String(order._id), type: "order" },
      to: user.email,
      variables: { orderNumber: order.orderNumber },
    });
    sent += 1;
  }

  await markRun("review_request", sent);
  return { sent };
}

/** Welcome email for newly verified customers (once). */
export async function runWelcomeEmails(now = new Date()) {
  const config = await automation("welcome");
  if (!config.enabled) return { sent: 0, skipped: "disabled" };

  const customers = (await User.find({
    createdAt: { $gte: new Date(now.getTime() - 3 * 86_400_000) },
    emailVerifiedAt: { $exists: true },
    type: "customer",
  })
    .select("email firstName")
    .limit(500)
    .lean()) as unknown as Array<{ _id: Types.ObjectId; email: string; firstName?: string }>;
  let sent = 0;

  for (const customer of customers) {
    const job = await enqueueNotification({
      channel: "email",
      eventType: "welcome",
      fallback: {
        subject: "Welcome to The Vastra House",
        text: `Hi ${customer.firstName ?? "there"},\n\nThank you for joining us. Explore our latest collections: ${siteUrl(withUtm("/shop", "welcome"))}\n\nManage your emails any time from your account.`,
      },
      relatedEntity: { id: String(customer._id), type: "user" },
      to: customer.email,
      variables: {},
    });
    if (job) sent += 1;
  }

  await markRun("welcome", sent);
  return { sent };
}

// ---------- Campaigns ----------

type CampaignInput = {
  name: string;
  kind: "newsletter" | "festival" | "segment";
  subject: string;
  previewText?: string;
  bodyHtml: string;
  audience: {
    type: "segment" | "newsletter" | "all_consented" | "custom_segment";
    segment?: string;
    customSegmentId?: string;
  };
  couponId?: string | null;
  banner?: { enabled?: boolean; title?: string; text?: string; href?: string; media?: unknown };
  startsAt?: Date;
  endsAt?: Date;
  scheduledAt?: Date;
  utmCampaign?: string;
};

export async function listCampaigns() {
  const campaigns = (await MarketingCampaign.find({})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean()) as unknown as Array<
    Record<string, unknown> & { utmCampaign?: string; _id: Types.ObjectId }
  >;
  // Revenue attribution by UTM campaign (FR-MKT performance visibility).
  const utms = campaigns.map((campaign) => campaign.utmCampaign).filter(Boolean) as string[];
  const attribution = utms.length
    ? ((await Order.aggregate([
        { $match: { "attribution.utmCampaign": { $in: utms }, status: { $in: REVENUE_STATUSES } } },
        {
          $group: {
            _id: "$attribution.utmCampaign",
            orders: { $sum: 1 },
            revenue: { $sum: "$totals.grandTotal" },
          },
        },
      ])) as Array<{ _id: string; orders: number; revenue: number }>)
    : [];

  return campaigns.map((campaign) => {
    const row = attribution.find((item) => item._id === campaign.utmCampaign);
    return {
      ...campaign,
      attributedOrders: row?.orders ?? 0,
      attributedRevenue: row?.revenue ?? 0,
    };
  });
}

function slugifyCampaign(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function createCampaign(input: CampaignInput, createdBy: string) {
  return MarketingCampaign.create({
    ...input,
    bodyHtml: sanitizeRichHtml(input.bodyHtml),
    campaignStatus: input.scheduledAt ? "scheduled" : "draft",
    couponId: input.couponId || undefined,
    createdBy,
    utmCampaign: input.utmCampaign
      ? slugifyCampaign(input.utmCampaign)
      : slugifyCampaign(input.name),
  });
}

export async function updateCampaign(id: string, input: Partial<CampaignInput>) {
  const campaign = await MarketingCampaign.findById(id);
  if (!campaign) throw new AppError("Campaign not found", 404);
  if (["sending", "sent"].includes(campaign.campaignStatus)) {
    throw new AppError("Sent campaigns cannot be edited", 409);
  }

  campaign.set({
    ...input,
    ...(input.bodyHtml ? { bodyHtml: sanitizeRichHtml(input.bodyHtml) } : {}),
    ...(input.couponId !== undefined ? { couponId: input.couponId || undefined } : {}),
    ...(input.utmCampaign ? { utmCampaign: slugifyCampaign(input.utmCampaign) } : {}),
  });
  if (input.scheduledAt !== undefined) {
    campaign.campaignStatus = input.scheduledAt ? "scheduled" : "draft";
  }
  await campaign.save();
  return campaign;
}

export async function cancelCampaign(id: string) {
  const campaign = await MarketingCampaign.findOneAndUpdate(
    { _id: id, campaignStatus: { $in: ["draft", "scheduled"] } },
    { $set: { campaignStatus: "cancelled" } },
    { new: true },
  );
  if (!campaign) throw new AppError("Only draft or scheduled campaigns can be cancelled", 409);
  return campaign;
}

async function resolveAudience(audience: CampaignInput["audience"]) {
  const recipients = new Map<string, { userId?: string; newsletterToken?: string }>();

  if (audience.type === "newsletter" || audience.type === "all_consented") {
    const subscribers = (await NewsletterSubscriber.find({ status: "subscribed" })
      .select("email unsubscribeToken")
      .lean()) as unknown as Array<{ email: string; unsubscribeToken: string }>;
    for (const subscriber of subscribers)
      recipients.set(subscriber.email, { newsletterToken: subscriber.unsubscribeToken });
  }

  if (audience.type !== "newsletter") {
    let query: Record<string, unknown> = {
      anonymizedAt: { $exists: false },
      "notificationPreferences.marketingEmail": true,
      status: "active",
      type: "customer",
    };

    if (audience.type === "segment" && audience.segment) query["crm.segment"] = audience.segment;
    if (audience.type === "custom_segment") {
      const segment = (await CustomerSegment.findById(
        audience.customSegmentId,
      ).lean()) as unknown as {
        rules: Parameters<typeof customSegmentQuery>[0];
      } | null;
      if (!segment) throw new AppError("Custom segment not found", 404);
      // Marketing consent is always enforced for campaigns, regardless of the rule set.
      query = { ...customSegmentQuery({ ...segment.rules, marketingConsentOnly: true }) };
    }

    const users = (await User.find(query).select("email").lean()) as unknown as Array<{
      _id: Types.ObjectId;
      email: string;
    }>;
    for (const user of users) {
      if (!recipients.has(user.email)) recipients.set(user.email, { userId: String(user._id) });
    }
  }

  return recipients;
}

export async function previewCampaignAudience(id: string) {
  const campaign = (await MarketingCampaign.findById(id).lean()) as unknown as {
    audience: CampaignInput["audience"];
  } | null;
  if (!campaign) throw new AppError("Campaign not found", 404);
  const recipients = await resolveAudience(campaign.audience);
  return { recipients: recipients.size, sample: [...recipients.keys()].slice(0, 10) };
}

/** Queues one email per consented recipient; the notification worker delivers them. */
export async function sendCampaign(id: string) {
  const campaign = await MarketingCampaign.findOneAndUpdate(
    { _id: id, campaignStatus: { $in: ["draft", "scheduled"] } },
    { $set: { campaignStatus: "sending" } },
    { new: true },
  );
  if (!campaign) throw new AppError("Campaign is not in a sendable state", 409);

  try {
    const recipients = await resolveAudience(campaign.audience as CampaignInput["audience"]);
    const coupon = campaign.couponId
      ? ((await Coupon.findById(campaign.couponId).select("code").lean()) as unknown as {
          code: string;
        } | null)
      : null;
    const text = htmlToPlainText(campaign.bodyHtml);
    let queued = 0;

    for (const [email, identity] of recipients) {
      const unsubscribe = unsubscribeUrlForEmail(identity);
      const footer = `<p style="font-size:12px;color:#6b625a">${coupon ? `Use code <strong>${coupon.code}</strong> at checkout. ` : ""}<a href="${unsubscribe}">Unsubscribe</a></p>`;
      await enqueueNotification({
        channel: "email",
        eventType: "marketing_campaign",
        fallback: {
          html: `${campaign.bodyHtml}${footer}`,
          subject: campaign.subject,
          text: `${text}${coupon ? `\n\nUse code ${coupon.code} at checkout.` : ""}\n\nUnsubscribe: ${unsubscribe}`,
        },
        relatedEntity: { id: String(campaign._id), type: "campaign" },
        to: email,
        variables: {},
      });
      queued += 1;
    }

    campaign.campaignStatus = "sent";
    campaign.sentAt = new Date();
    campaign.set("stats.recipients", recipients.size);
    campaign.set("stats.queued", queued);
    await campaign.save();
    return campaign;
  } catch (error) {
    campaign.campaignStatus = "draft";
    await campaign.save();
    throw error;
  }
}

export async function processScheduledCampaigns(now = new Date()) {
  const due = (await MarketingCampaign.find({
    campaignStatus: "scheduled",
    scheduledAt: { $lte: now },
  })
    .select("_id")
    .limit(10)
    .lean()) as unknown as Array<{ _id: Types.ObjectId }>;
  let sent = 0;

  for (const campaign of due) {
    await sendCampaign(String(campaign._id));
    sent += 1;
  }

  return { sent };
}

/** Festival campaign banner currently live on the storefront (FR-MKT-03 / FR-CMS-02). */
export async function getActiveCampaignBanner(now = new Date()) {
  const campaign = (await MarketingCampaign.findOne({
    "banner.enabled": true,
    campaignStatus: { $in: ["scheduled", "sent", "draft"] },
    endsAt: { $gte: now },
    startsAt: { $lte: now },
  })
    .sort({ startsAt: -1 })
    .populate("couponId", "code")
    .lean()) as unknown as {
    name: string;
    utmCampaign?: string;
    banner: { title?: string; text?: string; href?: string; media?: unknown };
    couponId?: { code?: string };
    endsAt?: Date;
  } | null;

  if (!campaign) return null;

  return {
    couponCode: campaign.couponId?.code,
    endsAt: campaign.endsAt,
    href: campaign.banner.href
      ? withUtm(campaign.banner.href, campaign.utmCampaign ?? "festival", "banner")
      : undefined,
    media: campaign.banner.media,
    text: campaign.banner.text,
    title: campaign.banner.title ?? campaign.name,
  };
}
