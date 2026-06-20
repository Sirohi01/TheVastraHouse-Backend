import assert from "node:assert/strict";
import test from "node:test";
import { computeBadges } from "./merchandisingBadgeService.js";

test("computeBadges marks new arrivals by age", () => {
  const badges = computeBadges(
    {
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      merchandisingMetrics: {},
    },
    { now: new Date("2026-06-15T00:00:00.000Z"), newArrivalDays: 30 },
  );

  assert.equal(badges.newArrival, true);
});

test("computeBadges marks best sellers and trending products from configured metrics", () => {
  const badges = computeBadges(
    {
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      merchandisingMetrics: {
        unitsSold30d: 50,
        views7d: 80,
        sales7d: 3,
      },
    },
    {
      now: new Date("2026-06-15T00:00:00.000Z"),
      bestSellerUnits: 25,
      trendingScore: 100,
    },
  );

  assert.equal(badges.bestSeller, true);
  assert.equal(badges.trending, true);
});

test("computeBadges lets manual overrides win over auto rules", () => {
  const badges = computeBadges(
    {
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      badgeOverrides: {
        newArrival: false,
        limitedEdition: true,
      },
      merchandisingMetrics: {
        unitsSold30d: 0,
        trendingScore: 0,
      },
    },
    { now: new Date("2026-06-15T00:00:00.000Z"), newArrivalDays: 30 },
  );

  assert.equal(badges.newArrival, false);
  assert.equal(badges.limitedEdition, true);
});
