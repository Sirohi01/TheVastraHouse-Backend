import assert from "node:assert/strict";
import test from "node:test";
import { Product } from "../models/Product.js";
import { closeExpiredPreOrders } from "./preOrderService.js";

test("pre-order auto-close disables expired and sold-out variants", async (t) => {
  const originalUpdateMany = Product.updateMany;
  const calls: unknown[][] = [];
  (Product as unknown as { updateMany: unknown }).updateMany = (...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve({ modifiedCount: calls.length === 1 ? 2 : 1 });
  };
  t.after(() => {
    (Product as unknown as { updateMany: unknown }).updateMany = originalUpdateMany;
  });

  const now = new Date("2026-08-04T10:00:00.000Z");
  const result = await closeExpiredPreOrders(now);

  assert.deepEqual(result, { productsUpdated: 3 });
  assert.equal(calls.length, 2);

  const [expired, soldOut] = calls;
  assert.deepEqual(expired[0], {
    variants: { $elemMatch: { "preOrder.enabled": true, "preOrder.endAt": { $lt: now } } },
  });
  assert.deepEqual(expired[1], { $set: { "variants.$[variant].preOrder.enabled": false } });
  assert.deepEqual(expired[2], {
    arrayFilters: [{ "variant.preOrder.enabled": true, "variant.preOrder.endAt": { $lt: now } }],
  });
  assert.deepEqual(soldOut[2], {
    arrayFilters: [
      { "variant.preOrder.enabled": true, "variant.preOrder.remainingQuantity": { $lte: 0 } },
    ],
  });

  // Each arrayFilter must be castable by Mongoose: plain paths only, no top-level `$or`.
  for (const call of calls) {
    const [filter] = (call[2] as { arrayFilters: Record<string, unknown>[] }).arrayFilters;
    assert.ok(Object.keys(filter).every((key) => key.startsWith("variant.")));
  }
});
