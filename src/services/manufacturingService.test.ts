import assert from "node:assert/strict";
import test from "node:test";
import { ProductionOrder } from "../models/ProductionOrder.js";
import {
  calculateProductionCosting,
  updateProductionOrderStage,
} from "./manufacturingService.js";

test("manufacturing costing totals all five categories and computes batch margin", () => {
  const result = calculateProductionCosting({
    costs: { courier: 500, fabric: 4_000, labor: 2_000, packaging: 500, printing: 1_000 },
    quantity: 10,
    sellingPricePerUnit: 1_200,
  });

  assert.deepEqual(result, {
    grossMargin: 4_000,
    grossMarginPercent: 33.33,
    projectedRevenue: 12_000,
    totalCost: 8_000,
  });
});

test("manufacturing costing reports a negative margin without hiding loss", () => {
  const result = calculateProductionCosting({
    costs: { courier: 200, fabric: 2_000, labor: 1_000, packaging: 200, printing: 600 },
    quantity: 2,
    sellingPricePerUnit: 1_500,
  });

  assert.equal(result.totalCost, 4_000);
  assert.equal(result.grossMargin, -1_000);
  assert.equal(result.grossMarginPercent, -33.33);
});

test("production-order stage cascades to every linked customer tracker", async (t) => {
  const originalFindById = ProductionOrder.findById;
  const synced: unknown[] = [];
  const document = {
    history: [] as unknown[],
    save: async () => document,
    stage: "order_received",
    trackerIds: ["6a718e258c5404f50b0f43c0", "6a718e258c5404f50b0f43c1"],
  };
  (ProductionOrder as unknown as { findById: unknown }).findById = async () => document;
  t.after(() => {
    (ProductionOrder as unknown as { findById: unknown }).findById = originalFindById;
  });

  await updateProductionOrderStage(
    {
      actorId: "6a718e258c5404f50b0f43c2",
      id: "6a718e258c5404f50b0f43c3",
      note: "Cutting started",
      stage: "cutting",
    },
    async (input) => {
      synced.push(input);
      return [];
    },
  );

  assert.equal(document.stage, "cutting");
  assert.equal(document.history.length, 1);
  assert.deepEqual(synced, [
    {
      actor: { actorId: "6a718e258c5404f50b0f43c2", actorType: "admin" },
      note: "Cutting started",
      stage: "cutting",
      trackerIds: ["6a718e258c5404f50b0f43c0", "6a718e258c5404f50b0f43c1"],
    },
  ]);
});
