import crypto from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { BackInStockSubscription } from "../models/BackInStockSubscription.js";
import { NewsletterSubscriber } from "../models/NewsletterSubscriber.js";
import { Product } from "../models/Product.js";
import { User } from "../models/User.js";
import { buildPaginatedResult, type PaginationOptions } from "../utils/pagination.js";
import { getAvailabilityBySkus } from "./catalogPublicService.js";
import { enqueueNotification } from "./notificationDispatchService.js";

const NEWSLETTER_CONSENT_TEXT =
  "I agree to receive The Vastra House newsletter with new arrivals, offers and stories. I can unsubscribe at any time.";

function frontendUrl(path: string) {
  return `${env.FRONTEND_PUBLIC_URL.replace(/\/$/, "")}${path}`;
}

// ---------- Unsubscribe tokens ----------

/** Stateless, unforgeable unsubscribe token for account holders ("u.<id>.<mac>"). */
export function userUnsubscribeToken(userId: string) {
  const mac = crypto
    .createHmac("sha256", `${env.JWT_REFRESH_SECRET}:unsubscribe`)
    .update(userId)
    .digest("base64url")
    .slice(0, 32);
  return `u.${userId}.${mac}`;
}

export function unsubscribeUrlForEmail(input: { userId?: string; newsletterToken?: string }) {
  if (input.newsletterToken) return frontendUrl(`/unsubscribe?token=${input.newsletterToken}`);
  if (input.userId) return frontendUrl(`/unsubscribe?token=${userUnsubscribeToken(input.userId)}`);
  return frontendUrl("/account/preferences");
}

/** One-click unsubscribe from all marketing email for either kind of token. */
export async function unsubscribeByToken(token: string) {
  if (token.startsWith("u.")) {
    const [, userId] = token.split(".");
    if (!Types.ObjectId.isValid(userId) || userUnsubscribeToken(userId) !== token) {
      throw new AppError("This unsubscribe link is invalid", 400);
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { "notificationPreferences.marketingEmail": false } },
      { new: true },
    ).select("email");
    if (user) {
      await NewsletterSubscriber.updateOne(
        { email: user.email },
        { $set: { status: "unsubscribed", unsubscribedAt: new Date() } },
      );
    }
    return { email: user?.email, unsubscribed: true };
  }

  const subscriber = await NewsletterSubscriber.findOneAndUpdate(
    { unsubscribeToken: token },
    { $set: { status: "unsubscribed", unsubscribedAt: new Date() } },
    { new: true },
  );

  if (!subscriber) {
    const alert = await BackInStockSubscription.findOneAndUpdate(
      { status: "waiting", unsubscribeToken: token },
      { $set: { status: "cancelled" } },
      { new: true },
    );
    if (alert) return { email: alert.email, unsubscribed: true };
    throw new AppError("This unsubscribe link is invalid or already used", 400);
  }

  await User.updateOne(
    { email: subscriber.email },
    { $set: { "notificationPreferences.marketingEmail": false } },
  );
  return { email: subscriber.email, unsubscribed: true };
}

// ---------- Newsletter ----------

export async function subscribeNewsletter(input: {
  email: string;
  source?: string;
  consent: boolean;
  userId?: string;
  ipAddress?: string;
}) {
  if (!input.consent) {
    throw new AppError("Please confirm you want to receive our newsletter", 400);
  }

  const email = input.email.trim().toLowerCase();
  const existing = await NewsletterSubscriber.findOne({ email });

  if (existing?.status === "subscribed") {
    return { alreadySubscribed: true, subscribed: true };
  }

  if (existing) {
    existing.status = "subscribed";
    existing.consentAt = new Date();
    existing.consentText = NEWSLETTER_CONSENT_TEXT;
    existing.unsubscribedAt = undefined;
    existing.source = input.source ?? existing.source;
    await existing.save();
  } else {
    await NewsletterSubscriber.create({
      consentAt: new Date(),
      consentText: NEWSLETTER_CONSENT_TEXT,
      email,
      ipAddress: input.ipAddress,
      source: input.source ?? "footer",
      unsubscribeToken: crypto.randomBytes(24).toString("base64url"),
      userId: input.userId,
    });
  }

  await User.updateOne(
    { email },
    { $set: { marketingConsentAt: new Date(), "notificationPreferences.marketingEmail": true } },
  );
  const subscriber = (await NewsletterSubscriber.findOne({ email }).lean()) as {
    unsubscribeToken: string;
  } | null;
  await enqueueNotification({
    channel: "email",
    eventType: "newsletter_welcome",
    fallback: {
      subject: "Welcome to The Vastra House newsletter",
      text: `Thank you for subscribing. You'll hear about new arrivals and offers first.\n\nUnsubscribe any time: ${unsubscribeUrlForEmail({ newsletterToken: subscriber?.unsubscribeToken })}`,
    },
    to: email,
    variables: {},
  });

  return { alreadySubscribed: false, subscribed: true };
}

export async function listNewsletterSubscribers(
  filter: { status?: string; search?: string },
  pagination: PaginationOptions,
) {
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.search)
    query.email = { $options: "i", $regex: filter.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };

  const [items, total, subscribed] = await Promise.all([
    NewsletterSubscriber.find(query)
      .select("-unsubscribeToken")
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    NewsletterSubscriber.countDocuments(query),
    NewsletterSubscriber.countDocuments({ status: "subscribed" }),
  ]);

  return { ...buildPaginatedResult(items, total, pagination), subscribedCount: subscribed };
}

export async function exportNewsletterCsv() {
  const rows = (await NewsletterSubscriber.find({})
    .select("email status source consentAt unsubscribedAt createdAt")
    .sort({ createdAt: 1 })
    .lean()) as unknown as Array<Record<string, unknown>>;
  const header = "email,status,source,consent_at,unsubscribed_at,created_at";
  const lines = rows.map((row) =>
    [
      row.email,
      row.status,
      row.source,
      iso(row.consentAt),
      iso(row.unsubscribedAt),
      iso(row.createdAt),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...lines].join("\n");
}

// ---------- Back in stock ----------

export async function subscribeBackInStock(input: {
  productId: string;
  variantId: string;
  email: string;
  userId?: string;
}) {
  const product = (await Product.findOne({
    _id: input.productId,
    active: true,
    status: { $ne: "deleted" },
  })
    .select("name variants._id variants.sku")
    .lean()) as unknown as {
    name: string;
    variants: Array<{ _id: Types.ObjectId; sku: string }>;
  } | null;
  const variant = product?.variants.find((item) => String(item._id) === input.variantId);

  if (!product || !variant) {
    throw new AppError("Product not found", 404);
  }

  const availability = await getAvailabilityBySkus([variant.sku]);
  if ((availability.get(variant.sku)?.available ?? 0) > 0) {
    throw new AppError("Good news: this item is already in stock", 409);
  }

  const email = input.email.trim().toLowerCase();

  try {
    await BackInStockSubscription.create({
      email,
      productId: input.productId,
      sku: variant.sku,
      unsubscribeToken: crypto.randomBytes(24).toString("base64url"),
      userId: input.userId,
      variantId: input.variantId,
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    return { alreadySubscribed: true, subscribed: true };
  }

  return { alreadySubscribed: false, subscribed: true };
}

export async function listBackInStockDemand() {
  return BackInStockSubscription.aggregate([
    { $match: { status: "waiting" } },
    {
      $group: {
        _id: { productId: "$productId", sku: "$sku" },
        subscribers: { $sum: 1 },
        oldest: { $min: "$createdAt" },
      },
    },
    {
      $lookup: {
        as: "product",
        foreignField: "_id",
        from: "products",
        localField: "_id.productId",
      },
    },
    {
      $project: {
        oldest: 1,
        productName: { $first: "$product.name" },
        productSlug: { $first: "$product.slug" },
        sku: "$_id.sku",
        subscribers: 1,
      },
    },
    { $sort: { subscribers: -1 } },
    { $limit: 200 },
  ]);
}

/** Scheduled job: emails waiting subscribers once their variant has stock again (FR-MKT-07). */
export async function processBackInStockAlerts(limit = 500) {
  const skus = (await BackInStockSubscription.distinct("sku", { status: "waiting" })) as string[];

  if (!skus.length) {
    return { notified: 0 };
  }

  const availability = await getAvailabilityBySkus(skus);
  const restocked = skus.filter((sku) => (availability.get(sku)?.available ?? 0) > 0);
  let notified = 0;

  for (const sku of restocked) {
    const subscriptions = (await BackInStockSubscription.find({ sku, status: "waiting" })
      .limit(limit)
      .lean()) as unknown as Array<{
      _id: Types.ObjectId;
      email: string;
      productId: Types.ObjectId;
      unsubscribeToken: string;
    }>;
    const product = subscriptions.length
      ? ((await Product.findById(subscriptions[0].productId)
          .select("name slug")
          .lean()) as unknown as { name: string; slug: string } | null)
      : null;

    for (const subscription of subscriptions) {
      const claimed = await BackInStockSubscription.updateOne(
        { _id: subscription._id, status: "waiting" },
        { $set: { notifiedAt: new Date(), status: "notified" } },
      );
      if (!claimed.modifiedCount || !product) continue;

      const productUrl = frontendUrl(
        `/shop/${product.slug}?utm_source=back_in_stock&utm_medium=email`,
      );
      await enqueueNotification({
        channel: "email",
        eventType: "back_in_stock",
        fallback: {
          subject: `${product.name} is back in stock`,
          text: `Good news! ${product.name} is available again. Stock is limited, so order soon: ${productUrl}\n\nYou asked us to tell you when it returned. Stop these alerts: ${frontendUrl(`/unsubscribe?token=${subscription.unsubscribeToken}`)}`,
        },
        relatedEntity: { id: String(subscription._id), type: "back-in-stock" },
        to: subscription.email,
        variables: { productName: product.name, productUrl },
      });
      notified += 1;
    }
  }

  return { notified, restockedSkus: restocked.length };
}

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? String(value) : "";
}

export function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  // Neutralise spreadsheet formula injection and quote special characters.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
