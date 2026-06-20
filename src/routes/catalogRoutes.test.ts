import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { API_VERSION } from "../config/api.js";
import { Product } from "../models/Product.js";
import { ProductReview } from "../models/ProductReview.js";

type QueryChain<T> = {
  sort: () => QueryChain<T>;
  skip: () => QueryChain<T>;
  limit: () => QueryChain<T>;
  select: () => QueryChain<T>;
  lean: () => Promise<T>;
  populate: () => QueryChain<T>;
};

function chain<T>(value: T): QueryChain<T> {
  return {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    select() {
      return this;
    },
    populate() {
      return this;
    },
    lean() {
      return Promise.resolve(value);
    },
  };
}

test("public product list forces active products and paginates storefront shape", async (t) => {
  const originalFind = Product.find;
  const originalCountDocuments = Product.countDocuments;
  const filters: unknown[] = [];
  const product = buildProductPayload();

  (Product as unknown as { find: unknown }).find = (filter: unknown) => {
    filters.push(filter);
    return chain([product]);
  };
  (Product as unknown as { countDocuments: unknown }).countDocuments = (filter: unknown) => {
    filters.push(filter);
    return Promise.resolve(1);
  };
  t.after(() => {
    (Product as unknown as { find: unknown }).find = originalFind;
    (Product as unknown as { countDocuments: unknown }).countDocuments = originalCountDocuments;
  });

  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products?active=false`);
  const payload = (await response.json()) as { data: unknown[]; meta: { total: number } };

  assert.equal(response.status, 200);
  assert.equal(payload.data.length, 1);
  assert.equal(payload.meta.total, 1);
  assert.deepEqual(filters[0], { active: true, status: { $ne: "deleted" } });
});

test("public product list maps Phase 8 filters and best-selling sort to catalog query", async (t) => {
  const originalFind = Product.find;
  const originalCountDocuments = Product.countDocuments;
  const filters: unknown[] = [];
  const sorts: unknown[] = [];

  (Product as unknown as { find: unknown }).find = (filter: unknown) => {
    filters.push(filter);
    return {
      ...chain([buildProductPayload()]),
      sort(sort: unknown) {
        sorts.push(sort);
        return this;
      },
    };
  };
  (Product as unknown as { countDocuments: unknown }).countDocuments = (filter: unknown) => {
    filters.push(filter);
    return Promise.resolve(1);
  };
  t.after(() => {
    (Product as unknown as { find: unknown }).find = originalFind;
    (Product as unknown as { countDocuments: unknown }).countDocuments = originalCountDocuments;
  });

  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(
    `${url}/api/${API_VERSION}/catalog/products?size=M&color=Wine&fabric=silk&minPrice=1000&maxPrice=3000&sort=-bestSelling`,
  );
  const responseText = await response.text();

  assert.equal(response.status, 200, responseText);
  assert.deepEqual(filters[0], {
    "variants.size": "M",
    "variants.color": "Wine",
    fabricDetails: { $regex: "silk", $options: "i" },
    "variants.basePrice": { $gte: "1000", $lte: "3000" },
    active: true,
    status: { $ne: "deleted" },
  });
  assert.deepEqual(sorts[0], { "merchandisingMetrics.unitsSold30d": -1 });
});

test("product detail by slug returns only active products with storefront fields", async (t) => {
  const originalFindOne = Product.findOne;
  const filters: unknown[] = [];
  const product = buildProductPayload();

  (Product as unknown as { findOne: unknown }).findOne = (filter: unknown) => {
    filters.push(filter);
    return chain(product);
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalFindOne;
  });

  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti`);
  const payload = (await response.json()) as { product: ReturnType<typeof buildProductPayload> };

  assert.equal(response.status, 200);
  assert.deepEqual(filters[0], {
    slug: "red-silk-kurti",
    active: true,
    status: { $ne: "deleted" },
  });
  assert.equal(payload.product.slug, "red-silk-kurti");
  assert.equal(payload.product.variants[0].sku, "TVH-REDSILKUR-WINE-M-0001");
  assert.equal(payload.product.seo.title, "Red Silk Kurti");
});

test("PDP endpoint aggregates related merchandising sets for storefront consumption", async (t) => {
  const originalFindOne = Product.findOne;
  const originalFind = Product.find;
  const relatedId = new Types.ObjectId();
  const recommendedId = new Types.ObjectId();
  const product = {
    ...buildProductPayload(),
    relatedProductIds: [relatedId],
    recommendedProductIds: [recommendedId],
    frequentlyBoughtTogetherIds: [],
    completeTheLookIds: [],
    computedBadges: {
      newArrival: true,
      bestSeller: false,
      trending: true,
      limitedEdition: false,
    },
  };

  (Product as unknown as { findOne: unknown }).findOne = () => chain(product);
  (Product as unknown as { find: unknown }).find = (filter: { _id?: { $in?: unknown[] } }) => {
    const ids = filter._id?.$in ?? [];
    return chain(ids.map((id) => ({ _id: String(id), name: "Curated Product", slug: "curated" })));
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalFindOne;
    (Product as unknown as { find: unknown }).find = originalFind;
  });

  const { close, url } = await listen();
  t.after(close);
  const response = await fetch(`${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/pdp`);
  const payload = (await response.json()) as {
    badges: Record<string, boolean>;
    merchandising: {
      relatedProducts: unknown[];
      recommendedProducts: unknown[];
      frequentlyBoughtTogether: unknown[];
      completeTheLook: unknown[];
    };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.badges.newArrival, true);
  assert.equal(payload.merchandising.relatedProducts.length, 1);
  assert.equal(payload.merchandising.recommendedProducts.length, 1);
  assert.equal(payload.merchandising.frequentlyBoughtTogether.length, 0);
  assert.equal(payload.merchandising.completeTheLook.length, 0);
});

test("review submission enters the moderation queue and approved reviews are listed", async (t) => {
  const originalFindOne = Product.findOne;
  const originalReviewCreate = ProductReview.create;
  const originalReviewFind = ProductReview.find;
  const originalReviewCount = ProductReview.countDocuments;
  const productId = new Types.ObjectId();
  const review = {
    _id: String(new Types.ObjectId()),
    productId,
    rating: 5,
    body: "Beautiful fabric and comfortable fit.",
    moderationStatus: "pending",
  };

  (Product as unknown as { findOne: unknown }).findOne = () => chain({ _id: productId });
  (ProductReview as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve({ ...review, ...(payload as Record<string, unknown>) });
  (ProductReview as unknown as { find: unknown }).find = () =>
    chain([{ ...review, moderationStatus: "approved" }]);
  (ProductReview as unknown as { countDocuments: unknown }).countDocuments = () =>
    Promise.resolve(1);
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalFindOne;
    (ProductReview as unknown as { create: unknown }).create = originalReviewCreate;
    (ProductReview as unknown as { find: unknown }).find = originalReviewFind;
    (ProductReview as unknown as { countDocuments: unknown }).countDocuments = originalReviewCount;
  });

  const { close, url } = await listen();
  t.after(close);
  const submitResponse = await fetch(
    `${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        body: "Beautiful fabric and comfortable fit.",
        guestName: "Ananya",
        guestEmail: "ananya@example.com",
      }),
    },
  );
  const submitPayload = (await submitResponse.json()) as {
    moderationStatus: string;
    review: { moderationStatus: string };
  };
  const listResponse = await fetch(
    `${url}/api/${API_VERSION}/catalog/products/red-silk-kurti/reviews`,
  );
  const listPayload = (await listResponse.json()) as { data: unknown[]; meta: { total: number } };

  assert.equal(submitResponse.status, 201);
  assert.equal(submitPayload.moderationStatus, "pending");
  assert.equal(submitPayload.review.moderationStatus, "pending");
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.data.length, 1);
  assert.equal(listPayload.meta.total, 1);
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
    brandId: String(new Types.ObjectId()),
    name: "Red Silk Kurti",
    slug: "red-silk-kurti",
    description: "A festive kurti with silk finish.",
    hsnCode: "6204",
    gstRate: 5,
    media: [
      {
        url: "https://res.cloudinary.com/demo/image/upload/red-kurti.jpg",
        type: "image",
        aspectRatio: "4:5",
      },
    ],
    variants: [
      {
        color: "Wine Red",
        size: "M",
        sku: "TVH-REDSILKUR-WINE-M-0001",
        barcode: "890000000001",
        basePrice: 2499,
        stockPlaceholder: 12,
      },
    ],
    seo: {
      title: "Red Silk Kurti",
      description: "Buy Red Silk Kurti from The Vastra House.",
    },
    active: true,
  };
}
