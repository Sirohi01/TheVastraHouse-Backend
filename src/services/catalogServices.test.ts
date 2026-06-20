import assert from "node:assert/strict";
import test from "node:test";
import { createSlug, assertValidSlug } from "./slugService.js";
import { generateSku } from "./skuService.js";
import { validateGstRate, validateHsnCode } from "./taxValidationService.js";

test("createSlug normalizes product names into stable URL slugs", () => {
  assert.equal(createSlug("  Red Silk Kurti / Festive Edit  "), "red-silk-kurti-festive-edit");
});

test("assertValidSlug rejects unsafe slugs", () => {
  assert.throws(() => assertValidSlug("Red Kurti"), /Slug must contain/);
  assert.doesNotThrow(() => assertValidSlug("red-kurti"));
});

test("generateSku builds prefix-aware product variant SKUs", () => {
  const sku = generateSku({
    prefix: "TVH",
    productSlug: "red-silk-kurti",
    color: "Wine Red",
    size: "XL",
    sequence: 7,
  });

  assert.equal(sku, "TVH-REDSILKUR-WINE-XL-0007");
});

test("tax validation accepts only supported GST rates and valid HSN codes", () => {
  assert.equal(validateHsnCode("6204"), true);
  assert.equal(validateHsnCode("62AB"), false);
  assert.equal(validateGstRate(5), true);
  assert.equal(validateGstRate(7), false);
});
