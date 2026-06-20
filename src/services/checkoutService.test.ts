import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../app.js";
import { API_VERSION } from "../config/api.js";
import { Cart } from "../models/Cart.js";
import { InventoryLog } from "../models/InventoryLog.js";
import { Order } from "../models/Order.js";
import { PaymentHistory } from "../models/PaymentHistory.js";
import { PaymentSession } from "../models/PaymentSession.js";
import { Product } from "../models/Product.js";
import { ProductionTracker } from "../models/ProductionTracker.js";
import { StockLedger } from "../models/StockLedger.js";
import { signAccessToken } from "./jwtService.js";
import { createOrderFromCheckout, previewCheckout, type CheckoutInput } from "./checkoutService.js";

test("checkout preview calculates GST, shipping, gift packaging, and gift card precedence", async (t) => {
  const ctx = patchCheckoutModels();
  t.after(ctx.restore);

  const preview = await previewCheckout({
    shippingAddress: buildAddress(),
    shippingMethod: "standard",
    userId: ctx.userId,
  });

  assert.equal(preview.totals.itemSubtotal, 4000);
  assert.equal(preview.totals.giftPackagingFee, 99);
  assert.equal(preview.totals.shippingFee, 0);
  assert.equal(preview.totals.giftCardDiscount, 500);
  assert.equal(preview.totals.grandTotal, 3599);
  assert.equal(preview.taxBreakdown[0].gstRate, 5);
});

test("order creation maps all Phase 10 payment methods to correct initial order status", async (t) => {
  const ctx = patchCheckoutModels();
  t.after(ctx.restore);
  const cases: Array<[CheckoutInput["paymentMethod"], string]> = [
    ["razorpay", "pending_payment"],
    ["cod", "cod_confirmed"],
    ["manual_bank_transfer", "payment_verification_pending"],
    ["upi", "pending_payment"],
  ];

  for (const [paymentMethod, expectedStatus] of cases) {
    const result = await createOrderFromCheckout({
      manualScreenshot:
        paymentMethod === "manual_bank_transfer"
          ? {
              type: "image",
              url: "https://res.cloudinary.com/demo/image/authenticated/payment-proof.jpg",
            }
          : undefined,
      paymentMethod,
      shippingAddress: buildAddress(),
      shippingMethod: "express",
      upiReference: paymentMethod === "upi" ? "UTR-P11" : undefined,
      userId: ctx.userId,
    });

    assert.equal(result.order.status, expectedStatus);
    assert.equal(
      result.order.stockReservations[0].status,
      expectedStatus === "cod_confirmed" ? "deducted" : "reserved",
    );
    assert.equal(result.order.totals.shippingFee, 199);
    assert.equal(result.paymentSession.orderReference, result.order.orderNumber);
  }

  assert.equal(ctx.orders.length, 4);
  assert.equal(ctx.paymentSessions.length, 4);
});

test("checkout order creation reserves and deducts real inventory ledger stock", async (t) => {
  const ctx = patchCheckoutModels({ inventoryAvailable: 2 });
  t.after(ctx.restore);

  const result = await createOrderFromCheckout({
    paymentMethod: "cod",
    shippingAddress: buildAddress(),
    shippingMethod: "standard",
    userId: ctx.userId,
  });

  assert.equal(result.order.status, "cod_confirmed");
  assert.equal(result.order.stockReservations[0].status, "deducted");
  assert.equal(String(result.order.stockReservations[0].warehouseId), ctx.warehouseId);
  assert.equal(ctx.inventoryLedger?.available, 0);
  assert.equal(ctx.inventoryLedger?.reserved, 0);
  assert.deepEqual(
    ctx.inventoryLogs.map((log) => log.eventType),
    ["reserve", "deduct"],
  );
});

test("pre-order checkout enforces window, decrements cap, creates tracker, and sets status", async (t) => {
  const ctx = patchCheckoutModels({ preOrderRemaining: 2 });
  t.after(ctx.restore);

  const result = await createOrderFromCheckout({
    paymentMethod: "cod",
    paymentMode: "advance",
    payableNow: 1000,
    shippingAddress: buildAddress(),
    shippingMethod: "standard",
    userId: ctx.userId,
  });

  assert.equal(result.order.status, "pre_order_confirmed");
  assert.equal(ctx.preOrderRemaining, 0);
  assert.equal(ctx.productionTrackers.length, 1);
  assert.equal(ctx.productionTrackers[0]?.stage, "order_received");

  await assert.rejects(
    createOrderFromCheckout({
      paymentMethod: "cod",
      paymentMode: "advance",
      payableNow: 1000,
      shippingAddress: buildAddress(),
      shippingMethod: "standard",
      userId: ctx.userId,
    }),
    /Pre-order quantity is not available/,
  );
});

test("pre-order checkout rejects closed booking windows", async (t) => {
  const ctx = patchCheckoutModels({ preOrderClosed: true, preOrderRemaining: 2 });
  t.after(ctx.restore);

  await assert.rejects(
    createOrderFromCheckout({
      paymentMethod: "cod",
      paymentMode: "advance",
      payableNow: 1000,
      shippingAddress: buildAddress(),
      shippingMethod: "standard",
      userId: ctx.userId,
    }),
    /Pre-order window has closed/,
  );
});

test("checkout rejects balance payment mode for a fresh (non pre-order) checkout", async (t) => {
  const ctx = patchCheckoutModels();
  t.after(ctx.restore);

  await assert.rejects(
    createOrderFromCheckout({
      paymentMethod: "cod",
      paymentMode: "balance",
      shippingAddress: buildAddress(),
      shippingMethod: "standard",
      userId: ctx.userId,
    }),
    /Balance payment mode is only available/,
  );
});

test("mixed cart with a pre-order item still reserves and deducts stock for the ready-stock item", async (t) => {
  const userId = String(new Types.ObjectId());
  const regularProductId = new Types.ObjectId();
  const regularVariantId = new Types.ObjectId();
  const preOrderProductId = new Types.ObjectId();
  const preOrderVariantId = new Types.ObjectId();
  const warehouseId = String(new Types.ObjectId());
  const regularSku = "TVH-REGULAR-001";
  const preOrderSku = "TVH-PREORDER-001";

  const originalCartFindOne = Cart.findOne;
  const originalProductFindOne = Product.findOne;
  const originalProductFindOneAndUpdate = Product.findOneAndUpdate;
  const originalOrderCreate = Order.create;
  const originalPaymentCreate = PaymentSession.create;
  const originalHistoryCreate = PaymentHistory.create;
  const originalStockLedgerFind = StockLedger.find;
  const originalStockLedgerFindOne = StockLedger.findOne;
  const originalStockLedgerFindOneAndUpdate = StockLedger.findOneAndUpdate;
  const originalInventoryLogCreate = InventoryLog.create;
  const originalProductionTrackerCreate = ProductionTracker.create;

  const regularLedger = {
    available: 5,
    damaged: 0,
    incoming: 0,
    lowStockThreshold: 0,
    reserved: 0,
    returned: 0,
    sku: regularSku,
    warehouseId,
  };
  const preOrder = {
    advancePercent: 50,
    enabled: true,
    endAt: new Date(Date.now() + 60_000),
    expectedDeliveryAt: new Date(Date.now() + 7 * 86_400_000),
    expectedDispatchAt: new Date(Date.now() + 5 * 86_400_000),
    paymentMode: "advance" as const,
    quantityCap: 5,
    remainingQuantity: 5,
    startAt: new Date(Date.now() - 60_000),
  };
  const products: Record<
    string,
    { _id: Types.ObjectId; gstRate: number; hsnCode: string; variants: unknown[] }
  > = {
    [String(regularProductId)]: {
      _id: regularProductId,
      gstRate: 5,
      hsnCode: "6204",
      variants: [{ _id: regularVariantId, active: true, sku: regularSku, stockPlaceholder: 5 }],
    },
    [String(preOrderProductId)]: {
      _id: preOrderProductId,
      gstRate: 5,
      hsnCode: "6204",
      variants: [
        { _id: preOrderVariantId, active: true, preOrder, sku: preOrderSku, stockPlaceholder: 0 },
      ],
    },
  };
  const inventoryLogs: Array<Record<string, unknown>> = [];
  const productionTrackers: Array<Record<string, unknown>> = [];

  function buildMixedCart() {
    const cart = new Cart({
      items: [
        {
          currencyCode: "INR",
          productId: regularProductId,
          productName: "Cotton Saree",
          quantity: 1,
          sku: regularSku,
          slug: "cotton-saree",
          stockSnapshot: 5,
          unitPrice: 2000,
          variantId: regularVariantId,
        },
        {
          currencyCode: "INR",
          preOrder,
          productId: preOrderProductId,
          productName: "Bridal Lehenga",
          quantity: 1,
          sku: preOrderSku,
          slug: "bridal-lehenga",
          stockSnapshot: 5,
          unitPrice: 8000,
          variantId: preOrderVariantId,
        },
      ],
      userId,
    });
    cart.save = async () => cart;
    return cart;
  }

  (Cart as unknown as { findOne: unknown }).findOne = () => Promise.resolve(buildMixedCart());
  (Product as unknown as { findOne: unknown }).findOne = (filter: { _id: unknown }) =>
    chain(products[String(filter._id)] ?? null);
  (Product as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    _filter: Record<string, unknown>,
    update: { $inc?: Record<string, number> },
  ) => {
    preOrder.remainingQuantity += update.$inc?.["variants.$.preOrder.remainingQuantity"] ?? 0;
    return Promise.resolve({ _id: preOrderProductId });
  };
  (StockLedger as unknown as { find: unknown }).find = (filter: { sku?: string }) =>
    chain(filter.sku === regularSku ? [regularLedger] : []);
  (StockLedger as unknown as { findOne: unknown }).findOne = (filter: LedgerFilter) => ({
    lean() {
      return Promise.resolve(
        matchesLedgerFilter(regularLedger, filter) ? { ...regularLedger } : null,
      );
    },
    sort() {
      return Promise.resolve(matchesLedgerFilter(regularLedger, filter) ? regularLedger : null);
    },
  });
  (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    filter: LedgerFilter,
    update: { $inc?: Partial<Record<"available" | "reserved", number>> },
  ) => {
    if (!matchesLedgerFilter(regularLedger, filter)) {
      return Promise.resolve(null);
    }
    for (const [field, amount] of Object.entries(update.$inc ?? {})) {
      (regularLedger as unknown as Record<string, number>)[field] += amount;
    }
    return Promise.resolve(regularLedger);
  };
  (Order as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    const order = new Order(payload);
    order.save = async () => order;
    return Promise.resolve(order);
  };
  (PaymentSession as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    const session = new PaymentSession(payload);
    session.save = async () => session;
    return Promise.resolve(session);
  };
  (PaymentHistory as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve(payload);
  (InventoryLog as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    inventoryLogs.push(payload);
    return Promise.resolve(payload);
  };
  (ProductionTracker as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    productionTrackers.push(payload);
    return Promise.resolve(payload);
  };

  t.after(() => {
    (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
    (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
    (Product as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
      originalProductFindOneAndUpdate;
    (Order as unknown as { create: unknown }).create = originalOrderCreate;
    (PaymentSession as unknown as { create: unknown }).create = originalPaymentCreate;
    (PaymentHistory as unknown as { create: unknown }).create = originalHistoryCreate;
    (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
    (StockLedger as unknown as { findOne: unknown }).findOne = originalStockLedgerFindOne;
    (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
      originalStockLedgerFindOneAndUpdate;
    (InventoryLog as unknown as { create: unknown }).create = originalInventoryLogCreate;
    (ProductionTracker as unknown as { create: unknown }).create = originalProductionTrackerCreate;
  });

  const result = await createOrderFromCheckout({
    paymentMethod: "cod",
    paymentMode: "advance",
    payableNow: 4000,
    shippingAddress: buildAddress(),
    shippingMethod: "standard",
    userId,
  });

  assert.equal(result.order.status, "pre_order_confirmed");
  assert.equal(result.order.stockReservations.length, 1);
  assert.equal(result.order.stockReservations[0].sku, regularSku);
  assert.equal(result.order.stockReservations[0].status, "deducted");
  assert.equal(regularLedger.available, 4);
  assert.equal(regularLedger.reserved, 0);
  assert.equal(productionTrackers.length, 1);
  assert.equal(
    inventoryLogs.some((log) => log.eventType === "deduct"),
    true,
  );
});

test("checkout order API creates orders for all four payment methods", async (t) => {
  const ctx = patchCheckoutModels();
  t.after(ctx.restore);
  const { close, url } = await listen();
  t.after(close);
  const token = signAccessToken({ sub: ctx.userId, type: "customer" });
  const cases: Array<[CheckoutInput["paymentMethod"], string]> = [
    ["razorpay", "pending_payment"],
    ["cod", "cod_confirmed"],
    ["manual_bank_transfer", "payment_verification_pending"],
    ["upi", "pending_payment"],
  ];

  for (const [paymentMethod, expectedStatus] of cases) {
    const response = await fetch(`${url}/api/${API_VERSION}/checkout/orders`, {
      body: JSON.stringify({
        manualScreenshot:
          paymentMethod === "manual_bank_transfer"
            ? {
                type: "image",
                url: "https://res.cloudinary.com/demo/image/authenticated/payment-proof.jpg",
              }
            : undefined,
        paymentMethod,
        shippingAddress: buildAddress(),
        shippingMethod: "standard",
        upiReference: paymentMethod === "upi" ? "UTR-P11" : undefined,
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as {
      order: { orderNumber: string; status: string; totals: { grandTotal: number } };
      paymentSession: { orderReference: string };
    };

    assert.equal(response.status, 201);
    assert.equal(payload.order.status, expectedStatus);
    assert.equal(payload.order.totals.grandTotal, 3599);
    assert.equal(payload.paymentSession.orderReference, payload.order.orderNumber);
  }
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

function patchCheckoutModels(
  options: {
    inventoryAvailable?: number;
    preOrderClosed?: boolean;
    preOrderRemaining?: number;
  } = {},
) {
  const userId = String(new Types.ObjectId());
  const productId = new Types.ObjectId();
  const variantId = new Types.ObjectId();
  const warehouseId = String(new Types.ObjectId());
  const originalCartFindOne = Cart.findOne;
  const originalProductFindOne = Product.findOne;
  const originalProductFindOneAndUpdate = Product.findOneAndUpdate;
  const originalProductionTrackerCreate = ProductionTracker.create;
  const originalOrderCreate = Order.create;
  const originalPaymentCreate = PaymentSession.create;
  const originalHistoryCreate = PaymentHistory.create;
  const originalStockLedgerFind = StockLedger.find;
  const originalStockLedgerFindOne = StockLedger.findOne;
  const originalStockLedgerFindOneAndUpdate = StockLedger.findOneAndUpdate;
  const originalInventoryLogCreate = InventoryLog.create;
  const orders: InstanceType<typeof Order>[] = [];
  const paymentSessions: InstanceType<typeof PaymentSession>[] = [];
  const inventoryLedger =
    options.inventoryAvailable === undefined
      ? undefined
      : {
          _id: new Types.ObjectId(),
          available: options.inventoryAvailable,
          damaged: 0,
          incoming: 0,
          lowStockThreshold: 0,
          reserved: 0,
          returned: 0,
          sku: "TVH-SILK-M-0001",
          warehouseId,
        };
  const inventoryLogs: Array<Record<string, unknown>> = [];
  const productionTrackers: Array<Record<string, unknown>> = [];
  const preOrderStart = new Date(Date.now() - 60_000);
  const preOrderEnd = new Date(Date.now() + 60_000);
  let preOrderRemaining = options.preOrderRemaining ?? 0;
  const preOrder =
    options.preOrderRemaining === undefined
      ? undefined
      : {
          advancePercent: 50,
          enabled: true,
          endAt: options.preOrderClosed ? new Date(Date.now() - 60_000) : preOrderEnd,
          expectedDeliveryAt: new Date(Date.now() + 7 * 86_400_000),
          expectedDispatchAt: new Date(Date.now() + 5 * 86_400_000),
          paymentMode: "advance" as const,
          quantityCap: options.preOrderRemaining,
          remainingQuantity: preOrderRemaining,
          startAt: preOrderStart,
        };
  (Cart as unknown as { findOne: unknown }).findOne = () =>
    Promise.resolve(buildCart(userId, productId, variantId, preOrder));
  (Product as unknown as { findOne: unknown }).findOne = () =>
    chain({
      _id: productId,
      gstRate: 5,
      hsnCode: "6204",
      variants: [
        {
          _id: variantId,
          active: true,
          preOrder,
          sku: "TVH-SILK-M-0001",
          stockPlaceholder: 8,
        },
      ],
    });
  (Product as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    filter: Record<string, unknown>,
    update: { $inc?: Record<string, number> },
  ) => {
    if (!preOrder || options.preOrderClosed || preOrderRemaining < 2) {
      return Promise.resolve(null);
    }
    preOrderRemaining += update.$inc?.["variants.$.preOrder.remainingQuantity"] ?? 0;
    preOrder.remainingQuantity = preOrderRemaining;
    return Promise.resolve({ _id: productId });
  };
  (StockLedger as unknown as { find: unknown }).find = (filter: { sku?: string }) =>
    chain(
      inventoryLedger && (!filter.sku || filter.sku === inventoryLedger.sku)
        ? [inventoryLedger]
        : [],
    );
  (StockLedger as unknown as { findOne: unknown }).findOne = (filter: LedgerFilter) => {
    const ledger = matchesLedgerFilter(inventoryLedger, filter) ? inventoryLedger : null;

    return {
      lean() {
        return Promise.resolve(ledger ? { ...ledger } : null);
      },
      sort() {
        return Promise.resolve(ledger);
      },
    };
  };
  (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = (
    filter: LedgerFilter,
    update: { $inc?: Partial<Record<"available" | "reserved", number>> },
  ) => {
    if (!matchesLedgerFilter(inventoryLedger, filter)) {
      return Promise.resolve(null);
    }

    for (const [field, amount] of Object.entries(update.$inc ?? {})) {
      inventoryLedger![field as "available" | "reserved"] += amount;
    }

    return Promise.resolve(inventoryLedger);
  };
  (Order as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    const order = new Order(payload);
    order.save = async () => order;
    orders.push(order);
    return Promise.resolve(order);
  };
  (PaymentSession as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    const session = new PaymentSession(payload);
    session.save = async () => session;
    paymentSessions.push(session);
    return Promise.resolve(session);
  };
  (PaymentHistory as unknown as { create: unknown }).create = (payload: unknown) =>
    Promise.resolve(payload);
  (InventoryLog as unknown as { create: unknown }).create = (payload: Record<string, unknown>) => {
    inventoryLogs.push(payload);
    return Promise.resolve(payload);
  };
  (ProductionTracker as unknown as { create: unknown }).create = (
    payload: Record<string, unknown>,
  ) => {
    productionTrackers.push(payload);
    return Promise.resolve(payload);
  };

  return {
    inventoryLedger,
    inventoryLogs,
    orders,
    paymentSessions,
    productionTrackers,
    get preOrderRemaining() {
      return preOrderRemaining;
    },
    userId,
    warehouseId,
    restore() {
      (Cart as unknown as { findOne: unknown }).findOne = originalCartFindOne;
      (Product as unknown as { findOne: unknown }).findOne = originalProductFindOne;
      (Product as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
        originalProductFindOneAndUpdate;
      (Order as unknown as { create: unknown }).create = originalOrderCreate;
      (PaymentSession as unknown as { create: unknown }).create = originalPaymentCreate;
      (PaymentHistory as unknown as { create: unknown }).create = originalHistoryCreate;
      (StockLedger as unknown as { find: unknown }).find = originalStockLedgerFind;
      (StockLedger as unknown as { findOne: unknown }).findOne = originalStockLedgerFindOne;
      (StockLedger as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate =
        originalStockLedgerFindOneAndUpdate;
      (InventoryLog as unknown as { create: unknown }).create = originalInventoryLogCreate;
      (ProductionTracker as unknown as { create: unknown }).create =
        originalProductionTrackerCreate;
    },
  };
}

type LedgerFilter = {
  available?: { $gt?: number; $gte?: number };
  reserved?: { $gte?: number };
  sku?: string;
  warehouseId?: string;
};

function matchesLedgerFilter(
  ledger:
    | {
        available: number;
        reserved: number;
        sku: string;
        warehouseId: string;
      }
    | undefined,
  filter: LedgerFilter,
) {
  if (!ledger) {
    return false;
  }
  if (filter.sku && filter.sku !== ledger.sku) {
    return false;
  }
  if (filter.warehouseId && String(filter.warehouseId) !== ledger.warehouseId) {
    return false;
  }
  if (filter.available?.$gt !== undefined && ledger.available <= filter.available.$gt) {
    return false;
  }
  if (filter.available?.$gte !== undefined && ledger.available < filter.available.$gte) {
    return false;
  }
  if (filter.reserved?.$gte !== undefined && ledger.reserved < filter.reserved.$gte) {
    return false;
  }
  return true;
}

function buildCart(
  userId: string,
  productId: Types.ObjectId,
  variantId: Types.ObjectId,
  preOrder?: Record<string, unknown>,
) {
  const cart = new Cart({
    giftCardRedemptions: [{ amount: 500, code: "GIFT500", currencyCode: "INR" }],
    giftPackaging: { enabled: true, fee: 99 },
    items: [
      {
        currencyCode: "INR",
        productId,
        productName: "Silk Kurti",
        quantity: 2,
        sku: "TVH-SILK-M-0001",
        slug: "silk-kurti",
        stockSnapshot: 8,
        preOrder,
        unitPrice: 2000,
        variantId,
      },
    ],
    userId,
  });
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

function buildAddress() {
  return {
    city: "Jaipur",
    countryCode: "IN",
    fullName: "Ananya Sharma",
    line1: "Bapu Bazaar",
    phone: "9999999999",
    postalCode: "302001",
    region: "RJ",
  };
}
