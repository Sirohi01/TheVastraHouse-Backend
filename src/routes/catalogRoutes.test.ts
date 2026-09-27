import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { API_VERSION } from "../config/api.js";
import { Category } from "../models/Category.js";
import { Collection } from "../models/Collection.js";
import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ProductReview } from "../models/ProductReview.js";
import { SeoSettings } from "../models/SeoSettings.js";
import { StockLedger } from "../models/StockLedger.js";
import { User } from "../models/User.js";
import { signAccessToken } from "../services/jwtService.js";
import { queryResult, stubStatics } from "../testing/commerceStubs.js";

type Pipeline = Array<Record<string, unknown>>;

function stubLedger(t: test.TestContext, available: number) {
  t.after(
    stubStatics(StockLedger, {
      aggregate: () =>
        Promise.resolve([{ _id: "TVH-REDSILKUR-WINE-M-0001", available, lowStockThreshold: 2 }]),
    }),
  );
}

function stubProductAggregate(t: test.TestContext, pipelines: Pipeline[]) {
  t.after(
    stubStatics(Product, {
      aggregate: (pipeline: Pipeline) => {
        pipelines.push(pipeline);
        return Promise.resolve(
          pipeline.some((stage) => "$count" in stage) ? [{ total: 1 }] : [buildProductPayload()],
        );
      },
    }),
  );
}

test("public product list forces active products and hides internal pricing", async (t) => {
  const pipelines: Pipeline[] = [];
  stubProductAggregate(t, pipelines);
  stubLedger(t, 12);
  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products?active=false`);
  const payload = (await response.json()) as {
    data: Array<{
      availabilityStatus: string;
      merchandisingMetrics?: unknown;
      variants: Array<Record<string, unknown> & { availability: { status: string; available: number } }>;
    }>;
    meta: { total: number };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.meta.total, 1);
  assert.deepEqual(pipelines[0][0].$match, { active: true, status: { $ne: "deleted" } });
  const variant = payload.data[0].variants[0];
  assert.equal(variant.costPrice, undefined, "cost price must never reach the storefront");
  assert.equal(variant.priceTiers, undefined, "wholesale price lists must not leak to retail");
  assert.equal(variant.stockPlaceholder, undefined);
  assert.equal(payload.data[0].merchandisingMetrics, undefined);
  assert.equal(variant.availability.status, "in_stock");
  assert.equal(variant.availability.available, 12);
});

test("availability comes from the inventory ledger, not the product document", async (t) => {
  const pipelines: Pipeline[] = [];
  stubProductAggregate(t, pipelines);
  stubLedger(t, 0);
  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products`);
  const payload = (await response.json()) as {
    data: Array<{ availabilityStatus: string; variants: Array<{ availability: { status: string } }> }>;
  };

  assert.equal(payload.data[0].variants[0].availability.status, "out_of_stock");
  assert.equal(payload.data[0].availabilityStatus, "out_of_stock");
});

test("public product list maps filters, effective price range and sort", async (t) => {
  const pipelines: Pipeline[] = [];
  stubProductAggregate(t, pipelines);
  stubLedger(t, 3);
  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(
    `${url}/api/${API_VERSION}/catalog/products?size=M&color=Wine&fabric=silk&minPrice=1000&maxPrice=3000&sort=-bestSelling`,
  );
  const responseText = await response.text();

  assert.equal(response.status, 200, responseText);
  const pipeline = pipelines[0];
  assert.deepEqual(pipeline[0].$match, {
    "variants.size": "M",
    "variants.color": "Wine",
    fabricDetails: { $regex: "silk", $options: "i" },
    active: true,
    status: { $ne: "deleted" },
  });
  assert.deepEqual(
    pipeline.find((stage) => (stage.$match as Record<string, unknown>)?.effectivePrice)?.$match,
    { effectivePrice: { $gte: 1000, $lte: 3000 } },
  );
  assert.deepEqual(pipeline.find((stage) => "$sort" in stage)?.$sort, {
    hasActivePreOrder: 1,
    "merchandisingMetrics.unitsSold30d": -1,
  });
});

test("product detail by slug returns storefront-safe fields", async (t) => {
  const filters: unknown[] = [];
  t.after(
    stubStatics(Product, {
      findOne: (filter: unknown) => {
        filters.push(filter);
        return queryResult(buildProductPayload());
      },
    }),
  );
  stubLedger(t, 1);
  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti`);
  const payload = (await response.json()) as {
    product: { slug: string; seo: { title: string }; variants: Array<Record<string, unknown> & { availability: { status: string } }> };
  };

  assert.equal(response.status, 200);
  assert.deepEqual(filters[0], { slug: "red-silk-kurti", active: true, status: { $ne: "deleted" } });
  assert.equal(payload.product.seo.title, "Red Silk Kurti");
  assert.equal(payload.product.variants[0].costPrice, undefined);
  assert.equal(payload.product.variants[0].availability.status, "low_stock");
});

test("PDP endpoint aggregates curated merchandising sets", async (t) => {
  const relatedId = new Types.ObjectId();
  const recommendedId = new Types.ObjectId();
  const product = {
    ...buildProductPayload(),
    completeTheLookIds: [],
    computedBadges: { bestSeller: false, limitedEdition: false, newArrival: true, trending: true },
    frequentlyBoughtTogetherIds: [],
    recommendedProductIds: [recommendedId],
    relatedProductIds: [relatedId],
  };
  t.after(
    stubStatics(Product, {
      find: (filter: { _id?: { $in?: unknown[] } }) =>
        queryResult((filter._id?.$in ?? []).map((id) => ({ ...buildProductPayload(), _id: String(id) }))),
      findOne: () => queryResult(product),
    }),
  );
  stubLedger(t, 10);
  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/pdp`);
  const payload = (await response.json()) as {
    badges: Record<string, boolean>;
    merchandising: Record<string, Array<{ variants: Array<Record<string, unknown>> }>>;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.badges.newArrival, true);
  assert.equal(payload.merchandising.relatedProducts.length, 1);
  assert.equal(payload.merchandising.recommendedProducts.length, 1);
  assert.equal(payload.merchandising.relatedProducts[0].variants[0].costPrice, undefined);
  assert.equal(payload.merchandising.frequentlyBoughtTogether.length, 0);
});

test("reviews require sign-in, enter moderation, and only approved reviews are listed", async (t) => {
  const productId = new Types.ObjectId();
  const userId = String(new Types.ObjectId());
  const created: Array<Record<string, unknown>> = [];
  const listFilters: unknown[] = [];
  t.after(stubStatics(Product, { findOne: () => queryResult({ _id: productId, name: "Red Silk Kurti", slug: "red-silk-kurti" }) }));
  t.after(stubStatics(Order, { exists: () => Promise.resolve({ _id: new Types.ObjectId() }) }));
  t.after(stubStatics(User, { findById: () => queryResult({ email: "ananya@shop.in", firstName: "Ananya", lastName: "Sharma" }) }));
  t.after(
    stubStatics(ProductReview, {
      aggregate: () => Promise.resolve([{ _id: 5, count: 1 }]),
      countDocuments: () => Promise.resolve(1),
      create: (payload: Record<string, unknown>) => {
        created.push(payload);
        return Promise.resolve({ _id: new Types.ObjectId(), ...payload });
      },
      find: (filter: unknown) => {
        listFilters.push(filter);
        return queryResult([{ body: "Beautiful fabric and comfortable fit.", rating: 5 }]);
      },
      findOne: () => queryResult(null),
    }),
  );
  const { close, url } = await listen();
  t.after(close);
  const body = JSON.stringify({ body: "Beautiful fabric and comfortable fit.", rating: 5 });

  const anonymous = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/reviews`, {
    body,
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(anonymous.status, 401);

  const token = signAccessToken({ sub: userId, type: "customer" });
  const submit = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/reviews`, {
    body,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const submitted = (await submit.json()) as { moderationStatus: string };

  assert.equal(submit.status, 201);
  assert.equal(submitted.moderationStatus, "pending");
  assert.equal(created[0].moderationStatus, "pending");
  assert.equal(created[0].verifiedPurchase, true);
  assert.equal(created[0].guestName, "Ananya S.");

  const list = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/reviews`);
  const listed = (await list.json()) as { summary: { average: number; count: number } };

  assert.equal(list.status, 200);
  assert.equal((listFilters[0] as { moderationStatus: string }).moderationStatus, "approved");
  assert.equal(listed.summary.average, 5);
  assert.equal(listed.summary.count, 1);
});

test("customers cannot reach the review moderation API", async (t) => {
  const { close, url } = await listen();
  t.after(close);
  const token = signAccessToken({ sub: String(new Types.ObjectId()), type: "customer" });
  t.after(stubStatics(User, { findById: () => Promise.resolve({ status: "active", type: "customer" }) }));
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/admin/reviews`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 403);
});

test("sitemap endpoint returns indexable product/category/collection slugs", async (t) => {
  const filters: unknown[] = [];
  const record = (items: unknown[]) => (filter: unknown) => {
    filters.push(filter);
    return queryResult(items);
  };
  t.after(stubStatics(Product, { find: record([{ slug: "red-silk-kurti", updatedAt: new Date("2026-01-01") }]) }));
  t.after(stubStatics(Category, { find: record([{ slug: "festive-wear", updatedAt: new Date("2026-01-02") }]) }));
  t.after(stubStatics(Collection, { find: record([{ slug: "winter-edit", updatedAt: new Date("2026-01-03") }]) }));
  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/sitemap`);
  const payload = (await response.json()) as Record<string, Array<{ slug: string }>>;

  assert.equal(response.status, 200);
  assert.deepEqual(payload.products.map((item) => item.slug), ["red-silk-kurti"]);
  assert.deepEqual(payload.categories.map((item) => item.slug), ["festive-wear"]);
  assert.deepEqual(payload.collections.map((item) => item.slug), ["winter-edit"]);
  assert.deepEqual((filters[0] as Record<string, unknown>)["seo.robotsIndex"], { $ne: false });
});

test("seo-settings endpoint returns resolved public defaults without auth", async (t) => {
  t.after(stubStatics(SeoSettings, { findOne: () => queryResult(null) }));
  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/seo-settings`);
  const payload = (await response.json()) as {
    seo: { siteName: string; titleTemplate: string; defaultOgImage: string; robots: { indexSite: boolean } };
  };

  assert.equal(response.status, 200);
  assert.ok(payload.seo.siteName.length > 0);
  assert.ok(payload.seo.titleTemplate.includes("%s"));
  assert.ok(payload.seo.defaultOgImage.startsWith("https://"));
  assert.equal(payload.seo.robots.indexSite, true);
});

async function listen(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createApp();
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function buildProductPayload() {
  return {
    _id: String(new Types.ObjectId()),
    active: true,
    brandId: String(new Types.ObjectId()),
    description: "A festive kurti with silk finish.",
    gstRate: 5,
    hsnCode: "6204",
    media: [
      {
        altText: "Red silk kurti front view",
        aspectRatio: "4:5",
        type: "image",
        url: "https://res.cloudinary.com/demo/image/upload/red-kurti.jpg",
      },
    ],
    merchandisingMetrics: { unitsSold30d: 4 },
    name: "Red Silk Kurti",
    seo: {
      description: "Buy Red Silk Kurti from The Vastra House.",
      title: "Red Silk Kurti",
    },
    slug: "red-silk-kurti",
    variants: [
      {
        _id: String(new Types.ObjectId()),
        barcode: "890000000001",
        basePrice: 2499,
        color: "Wine Red",
        costPrice: 900,
        priceTiers: [{ price: 1500, priceListCode: "WHOLESALE" }],
        size: "M",
        sku: "TVH-REDSILKUR-WINE-M-0001",
        stockPlaceholder: 12,
      },
    ],
  };
}
