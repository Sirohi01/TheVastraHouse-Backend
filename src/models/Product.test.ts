import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { Product } from "./Product.js";

function buildProduct(overrides: Record<string, unknown> = {}) {
  return new Product({
    brandId: new Types.ObjectId(),
    name: "Red Silk Kurti",
    slug: "red-silk-kurti",
    description: "A festive kurti with silk finish.",
    hsnCode: "6204",
    gstRate: 5,
    media: [
      {
        url: "https://res.cloudinary.com/demo/image/upload/red-kurti.jpg",
        altText: "Red silk kurti on model",
        type: "image",
        aspectRatio: "4:5",
        objectFit: "cover",
      },
    ],
    variants: [
      {
        color: "Wine Red",
        size: "M",
        sku: "TVH-REDSILKURT-WINE-M-0001",
        barcode: "890000000001",
        basePrice: 2499,
        salePrice: 2199,
        stockPlaceholder: 12,
        priceTiers: [{ priceListCode: "WHOLESALE", price: 1800, currencyCode: "INR" }],
      },
    ],
    seo: {
      title: "Red Silk Kurti",
      description: "Buy Red Silk Kurti from The Vastra House.",
    },
    badgeOverrides: {
      limitedEdition: true,
    },
    computedBadges: {
      newArrival: true,
      bestSeller: false,
      trending: true,
      limitedEdition: true,
    },
    merchandisingMetrics: {
      unitsSold30d: 12,
      views7d: 240,
      sales7d: 4,
      trendingScore: 280,
    },
    relatedProductIds: [new Types.ObjectId()],
    recommendedProductIds: [new Types.ObjectId()],
    frequentlyBoughtTogetherIds: [new Types.ObjectId()],
    completeTheLookIds: [new Types.ObjectId()],
    ...overrides,
  });
}

test("Product model validates the Phase 5 catalog shape", () => {
  const product = buildProduct();
  const validationError = product.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(product.variants[0]?.sku, "TVH-REDSILKURT-WINE-M-0001");
  assert.equal(product.variants[0]?.priceTiers[0]?.priceListCode, "WHOLESALE");
  assert.equal(product.computedBadges?.limitedEdition, true);
  assert.equal(product.completeTheLookIds.length, 1);
});

test("Product model requires at least one variant", () => {
  const product = buildProduct({ variants: [] });
  const validationError = product.validateSync();

  assert.ok(validationError?.errors.variants);
});

test("Product model validates GST rate and HSN code", () => {
  const product = buildProduct({ gstRate: 7, hsnCode: "62AB" });
  const validationError = product.validateSync();

  assert.ok(validationError?.errors.gstRate);
  assert.ok(validationError?.errors.hsnCode);
});
