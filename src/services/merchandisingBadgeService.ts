import type { FilterQuery } from "mongoose";
import { env } from "../config/env.js";
import { Product, type ProductDocument } from "../models/Product.js";
import { logger } from "../utils/logger.js";

export type BadgeKey = "newArrival" | "bestSeller" | "trending" | "limitedEdition";

export type BadgeState = Record<BadgeKey, boolean>;

export type BadgeComputationConfig = {
  now?: Date;
  newArrivalDays?: number;
  bestSellerUnits?: number;
  trendingScore?: number;
};

type ProductBadgeInput = Pick<ProductDocument, "createdAt"> & {
  badgeOverrides?: Partial<BadgeState>;
  merchandisingMetrics?: {
    unitsSold30d?: number;
    views7d?: number;
    sales7d?: number;
    trendingScore?: number;
  };
};

export function computeBadges(
  product: ProductBadgeInput,
  config: BadgeComputationConfig = {},
): BadgeState {
  const now = config.now ?? new Date();
  const newArrivalDays = config.newArrivalDays ?? env.MERCHANDISING_NEW_ARRIVAL_DAYS;
  const bestSellerUnits = config.bestSellerUnits ?? env.MERCHANDISING_BEST_SELLER_UNITS;
  const trendingScore = config.trendingScore ?? env.MERCHANDISING_TRENDING_SCORE;
  const metrics = product.merchandisingMetrics ?? {};
  const overrides = product.badgeOverrides ?? {};
  const createdAt = product.createdAt instanceof Date ? product.createdAt : now;
  const ageInDays = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
  const autoBadges: BadgeState = {
    newArrival: ageInDays <= newArrivalDays,
    bestSeller: Number(metrics.unitsSold30d ?? 0) >= bestSellerUnits,
    trending:
      Number(metrics.trendingScore ?? 0) >= trendingScore ||
      Number(metrics.views7d ?? 0) + Number(metrics.sales7d ?? 0) * 10 >= trendingScore,
    limitedEdition: false,
  };

  return {
    newArrival: overrides.newArrival ?? autoBadges.newArrival,
    bestSeller: overrides.bestSeller ?? autoBadges.bestSeller,
    trending: overrides.trending ?? autoBadges.trending,
    limitedEdition: overrides.limitedEdition ?? autoBadges.limitedEdition,
  };
}

export async function recomputeProductBadges(filter: FilterQuery<ProductDocument> = {}) {
  const products = await Product.find({ status: { $ne: "deleted" }, ...filter });
  let updated = 0;

  for (const product of products) {
    product.computedBadges = computeBadges(product);
    await product.save();
    updated += 1;
  }

  return { checked: products.length, updated };
}

export function startMerchandisingBadgeJob() {
  const intervalMs = env.MERCHANDISING_BADGE_JOB_INTERVAL_MINUTES * 60_000;
  const timer = setInterval(() => {
    void recomputeProductBadges().catch((error) => {
      logger.warn({ error }, "Merchandising badge recompute failed");
    });
  }, intervalMs);

  timer.unref();
  return timer;
}
