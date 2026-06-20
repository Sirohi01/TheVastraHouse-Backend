import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { API_VERSION } from "../config/api.js";
import { AbandonedCartEvent } from "../models/AbandonedCartEvent.js";
import { Cart } from "../models/Cart.js";
import { GiftCard } from "../models/GiftCard.js";
import { Product } from "../models/Product.js";
import { StockLedger } from "../models/StockLedger.js";
import { emitAbandonedCartEvents, mergeGuestCartIntoUserCart } from "../services/cartService.js";

test("cart add-to-cart uses server-side product price and placeholder stock", async (t) => {
  const originalProductFindOne = Product.findOne;
  const originalCartFindOne = Cart.findOne;
  const originalCartCreate = Cart.create;
  const originalStockLedgerFind = StockLedger.find;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  let cart: InstanceType<typeof Cart> | undefined;

  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain(buildProduct(productId, variantId));
  (StockLedger as unknown as { find: unknown }).find = () => chain([]);
  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(cart ?? null);
  (Cart as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    cart = makeCart(payload);
    return Promise.resolve(cart);
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { create: unknown }).create = originalCartCreate;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
  });

  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(`${url}/api/${API_VERSION}/commerce/cart/items`, {
    body: JSON.stringify({ productId, quantity: 2, variantId }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-phase-9",
    },
    method: "POST",
  });
  const payload = (await response.json()) as {
    cart: { items: Array<{ unitPrice: number; quantity: number }>; totals: { subtotal: number } };
  };

  assert.equal(response.status, 201);
  assert.equal(payload.cart.items[0].unitPrice, 1999);
  assert.equal(payload.cart.items[0].quantity, 2);
  assert.equal(payload.cart.totals.subtotal, 3998);
});

test("cart add-to-cart uses inventory ledger stock before product placeholder stock", async (t) => {
  const originalProductFindOne = Product.findOne;
  const originalCartFindOne = Cart.findOne;
  const originalCartCreate = Cart.create;
  const originalStockLedgerFind = StockLedger.find;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  let cart: InstanceType<typeof Cart> | undefined;

  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain(buildProduct(productId, variantId, 8));
  (StockLedger as unknown as { find: unknown }).find = () =>
    chain([{ available: 1, sku: "TVH-SILK-M-0001" }]);
  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(cart ?? null);
  (Cart as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    cart = makeCart(payload);
    return Promise.resolve(cart);
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { create: unknown }).create = originalCartCreate;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
  });

  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(`${url}/api/${API_VERSION}/commerce/cart/items`, {
    body: JSON.stringify({ productId, quantity: 2, variantId }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-phase-12-ledger",
    },
    method: "POST",
  });

  assert.equal(response.status, 409);
});

test("cart keeps the same variant as separate regular and pre-order lines", async (t) => {
  const originalProductFindOne = Product.findOne;
  const originalCartFindOne = Cart.findOne;
  const originalCartCreate = Cart.create;
  const originalStockLedgerFind = StockLedger.find;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  let cart: InstanceType<typeof Cart> | undefined;

  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain(
      buildProduct(productId, variantId, 6, {
        advancePercent: 40,
        enabled: true,
        endAt: new Date("2030-01-01T00:00:00.000Z"),
        expectedDeliveryAt: new Date("2030-01-10T00:00:00.000Z"),
        expectedDispatchAt: new Date("2030-01-07T00:00:00.000Z"),
        paymentMode: "advance",
        remainingQuantity: 3,
        startAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    );
  (StockLedger as unknown as { find: unknown }).find = () => chain([]);
  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(cart ?? null);
  (Cart as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    cart = makeCart(payload);
    return Promise.resolve(cart);
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { create: unknown }).create = originalCartCreate;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
  });

  const { close, url } = await listen();
  t.after(close);

  const regularResponse = await fetch(`${url}/api/${API_VERSION}/commerce/cart/items`, {
    body: JSON.stringify({ productId, quantity: 1, variantId }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-purchase-mode",
    },
    method: "POST",
  });
  const preOrderResponse = await fetch(`${url}/api/${API_VERSION}/commerce/cart/items`, {
    body: JSON.stringify({ productId, purchaseMode: "pre_order", quantity: 1, variantId }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-purchase-mode",
    },
    method: "POST",
  });
  const payload = (await preOrderResponse.json()) as {
    cart: {
      items: Array<{
        preOrder?: { enabled?: boolean };
        preOrderOption?: { enabled?: boolean };
        purchaseMode: "regular" | "pre_order";
        sku: string;
      }>;
    };
  };

  assert.equal(regularResponse.status, 201);
  assert.equal(preOrderResponse.status, 201);
  assert.equal(payload.cart.items.length, 2);
  assert.deepEqual(payload.cart.items.map((item) => item.purchaseMode).sort(), [
    "pre_order",
    "regular",
  ]);
  assert.equal(
    payload.cart.items.find((item) => item.purchaseMode === "regular")?.preOrder?.enabled,
    undefined,
  );
  assert.equal(
    payload.cart.items.find((item) => item.purchaseMode === "regular")?.preOrderOption?.enabled,
    true,
  );
  assert.equal(
    payload.cart.items.find((item) => item.purchaseMode === "pre_order")?.preOrder?.enabled,
    true,
  );
});

test("cart rejects pre-order mode when the variant pre-order cap is unavailable", async (t) => {
  const originalProductFindOne = Product.findOne;
  const originalCartFindOne = Cart.findOne;
  const originalCartCreate = Cart.create;
  const originalStockLedgerFind = StockLedger.find;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  let cart: InstanceType<typeof Cart> | undefined;

  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain(
      buildProduct(productId, variantId, 6, {
        enabled: true,
        endAt: new Date("2030-01-01T00:00:00.000Z"),
        paymentMode: "advance",
        remainingQuantity: 0,
        startAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    );
  (StockLedger as unknown as { find: unknown }).find = () => chain([]);
  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(cart ?? null);
  (Cart as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    cart = makeCart(payload);
    return Promise.resolve(cart);
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { create: unknown }).create = originalCartCreate;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
  });

  const { close, url } = await listen();
  t.after(close);

  const response = await fetch(`${url}/api/${API_VERSION}/commerce/cart/items`, {
    body: JSON.stringify({ productId, purchaseMode: "pre_order", quantity: 1, variantId }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-pre-order-cap",
    },
    method: "POST",
  });

  assert.equal(response.status, 409);
});

test("cart gift packaging and gift card redemption update totals", async (t) => {
  const originalCartFindOne = Cart.findOne;
  const originalCartCreate = Cart.create;
  const originalGiftCardFindOne = GiftCard.findOne;
  let cart = makeCart({
    guestSessionId: "guest-session-gift",
    items: [
      {
        productId: new Types.ObjectId(),
        variantId: new Types.ObjectId(),
        productName: "Silk Kurti",
        slug: "silk-kurti",
        sku: "TVH-SILK-M-0001",
        unitPrice: 2000,
        currencyCode: "INR",
        quantity: 1,
        stockSnapshot: 5,
      },
    ],
  });

  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(cart);
  (Cart as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    cart = makeCart(payload);
    return Promise.resolve(cart);
  };
  (GiftCard as unknown as { findOne: unknown }).findOne = () =>
    Promise.resolve({
      balance: 500,
      code: "GIFT500",
      currencyCode: "INR",
      status: "active",
    });
  t.after(() => {
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { create: unknown }).create = originalCartCreate;
    (GiftCard as unknown as { findOne: unknown }).findOne = originalGiftCardFindOne;
  });

  const { close, url } = await listen();
  t.after(close);

  const packagingResponse = await fetch(`${url}/api/${API_VERSION}/commerce/cart/gift-packaging`, {
    body: JSON.stringify({ enabled: true }),
    headers: {
      "Content-Type": "application/json",
      "X-Guest-Session-Id": "guest-session-gift",
    },
    method: "PATCH",
  });
  const giftCardResponse = await fetch(
    `${url}/api/${API_VERSION}/commerce/cart/gift-cards/validate`,
    {
      body: JSON.stringify({ code: "gift500" }),
      headers: {
        "Content-Type": "application/json",
        "X-Guest-Session-Id": "guest-session-gift",
      },
      method: "POST",
    },
  );
  const payload = (await giftCardResponse.json()) as {
    cart: { totals: { giftPackagingFee: number; giftCardDiscount: number; grandTotal: number } };
  };

  assert.equal(packagingResponse.status, 200);
  assert.equal(giftCardResponse.status, 200);
  assert.equal(payload.cart.totals.giftPackagingFee, 99);
  assert.equal(payload.cart.totals.giftCardDiscount, 500);
  assert.equal(payload.cart.totals.grandTotal, 1599);
});

test("guest cart merges into logged-in cart without trusting stale quantities", async (t) => {
  const originalProductFindOne = Product.findOne;
  const originalCartFindOne = Cart.findOne;
  const originalCartDeleteOne = Cart.deleteOne;
  const originalStockLedgerFind = StockLedger.find;
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const guestCart = makeCart({
    guestSessionId: "guest-session-merge",
    items: [buildCartLine(productId, variantId, 3)],
  });
  const userCart = makeCart({
    userId: new Types.ObjectId(),
    items: [buildCartLine(productId, variantId, 2)],
  });
  let deletedGuestCart = false;

  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain(buildProduct(productId, variantId, 4));
  (StockLedger as unknown as { find: unknown }).find = () => chain([]);
  (Cart as unknown as { findOne: unknown }).findOne = (filter: { guestSessionId?: string }) =>
    Promise.resolve(filter.guestSessionId ? guestCart : userCart);
  (Cart as unknown as { deleteOne: unknown }).deleteOne = () => {
    deletedGuestCart = true;
    return Promise.resolve({ deletedCount: 1 });
  };
  t.after(() => {
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Cart as unknown as { deleteOne: unknown }).deleteOne = originalCartDeleteOne;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
  });

  const merged = await mergeGuestCartIntoUserCart("guest-session-merge", String(userCart.userId));

  assert.equal(merged.items[0].quantity, 4);
  assert.equal(merged.totals.subtotal, 7996);
  assert.equal(deletedGuestCart, true);
});

test("abandoned-cart event emits once for inactive carts", async (t) => {
  const originalCartFind = Cart.find;
  const originalEventCreate = AbandonedCartEvent.create;
  const cart = makeCart({
    guestSessionId: "guest-session-abandoned",
    items: [buildCartLine(new Types.ObjectId(), new Types.ObjectId(), 1)],
    lastActivityAt: new Date("2026-06-17T08:00:00.000Z"),
    totals: {
      currencyCode: "INR",
      giftCardDiscount: 0,
      giftPackagingFee: 0,
      grandTotal: 1999,
      subtotal: 1999,
    },
  });
  const events: unknown[] = [];

  (Cart as unknown as { find: unknown }).find = () => Promise.resolve([cart]);
  (AbandonedCartEvent as unknown as { create: unknown }).create = (payload: unknown) => {
    events.push(payload);
    return Promise.resolve(payload);
  };
  t.after(() => {
    (Cart as unknown as { find: unknown }).find = originalCartFind;
    (AbandonedCartEvent as unknown as { create: unknown }).create = originalEventCreate;
  });

  const result = await emitAbandonedCartEvents(new Date("2026-06-17T10:00:00.000Z"));

  assert.equal(result.emitted, 1);
  assert.equal(events.length, 1);
  assert.equal(Boolean(cart.abandonedCartEventEmittedAt), true);
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
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    url: `http://127.0.0.1:${address.port}`,
  };
}

function makeCart(payload: Record<string, unknown>) {
  const cart = new Cart(payload);
  cart.save = async () => cart;
  return cart;
}

function chain<T>(value: T) {
  return {
    lean() {
      return Promise.resolve(value);
    },
  };
}

function buildProduct(
  productId: Types.ObjectId,
  variantId: Types.ObjectId,
  stockPlaceholder = 5,
  preOrder?: {
    advancePercent?: number;
    enabled: boolean;
    endAt?: Date;
    expectedDeliveryAt?: Date;
    expectedDispatchAt?: Date;
    paymentMode?: "full" | "advance";
    remainingQuantity?: number;
    startAt?: Date;
  },
) {
  return {
    _id: productId,
    active: true,
    media: [{ type: "image", url: "https://res.cloudinary.com/demo/image/upload/silk.jpg" }],
    name: "Silk Kurti",
    slug: "silk-kurti",
    variants: [
      {
        _id: variantId,
        active: true,
        basePrice: 2499,
        currencyCode: "INR",
        salePrice: 1999,
        sku: "TVH-SILK-M-0001",
        stockPlaceholder,
        preOrder,
      },
    ],
  };
}

function buildCartLine(productId: Types.ObjectId, variantId: Types.ObjectId, quantity: number) {
  return {
    currencyCode: "INR",
    productId,
    productName: "Silk Kurti",
    quantity,
    sku: "TVH-SILK-M-0001",
    slug: "silk-kurti",
    stockSnapshot: 5,
    unitPrice: 1999,
    variantId,
  };
}
