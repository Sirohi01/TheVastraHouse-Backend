import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { getRuntimeNumberSetting } from "./runtimeSettingsService.js";

export const loyaltyTiers = ["standard", "silver", "gold", "platinum"] as const;
export type LoyaltyTier = (typeof loyaltyTiers)[number];

export async function getLoyaltyTier(userId: string): Promise<LoyaltyTier> {
  const user = (await User.findById(userId).select("lifetimeOrderValue").lean()) as {
    lifetimeOrderValue?: number;
  } | null;

  return computeLoyaltyTier(user?.lifetimeOrderValue ?? 0, await loadThresholds());
}

export function computeLoyaltyTier(
  lifetimeOrderValue: number,
  thresholds: { silver: number; gold: number; platinum: number },
): LoyaltyTier {
  if (lifetimeOrderValue >= thresholds.platinum) {
    return "platinum";
  }

  if (lifetimeOrderValue >= thresholds.gold) {
    return "gold";
  }

  if (lifetimeOrderValue >= thresholds.silver) {
    return "silver";
  }

  return "standard";
}

async function loadThresholds() {
  return {
    gold: await getRuntimeNumberSetting(
      "LOYALTY_TIER_GOLD_THRESHOLD",
      env.LOYALTY_TIER_GOLD_THRESHOLD,
    ),
    platinum: await getRuntimeNumberSetting(
      "LOYALTY_TIER_PLATINUM_THRESHOLD",
      env.LOYALTY_TIER_PLATINUM_THRESHOLD,
    ),
    silver: await getRuntimeNumberSetting(
      "LOYALTY_TIER_SILVER_THRESHOLD",
      env.LOYALTY_TIER_SILVER_THRESHOLD,
    ),
  };
}
