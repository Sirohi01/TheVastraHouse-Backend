import assert from "node:assert/strict";
import test from "node:test";
import { Product } from "../models/Product.js";
import { closeExpiredPreOrders } from "./preOrderService.js";

test("pre-order auto-close disables expired and sold-out variants atomically", async (t) => {
  const originalUpdateMany = Product.updateMany;
  let captured: unknown[] = [];
  (Product as unknown as { updateMany: unknown }).updateMany = (...args: unknown[]) => {
    captured = args;
    return Promise.resolve({ modifiedCount: 3 });
  };
  t.after(() => {
    (Product as unknown as { updateMany: unknown }).updateMany = originalUpdateMany;
  });

  const now = new Date("2026-08-04T10:00:00.000Z");
  const result = await closeExpiredPreOrders(now);

  assert.deepEqual(result, { productsUpdated: 3 });
  assert.equal(captured.length, 3);
  assert.deepEqual(captured[1], { $set: { "variants.$[variant].preOrder.enabled": false } });
  assert.deepEqual(captured[2], {
    arrayFilters: [
      {
        $or: [
          { "variant.preOrder.endAt": { $lt: now } },
          { "variant.preOrder.remainingQuantity": { $lte: 0 } },
        ],
        "variant.preOrder.enabled": true,
      },
    ],
  });
});
