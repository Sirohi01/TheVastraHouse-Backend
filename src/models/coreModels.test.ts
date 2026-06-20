import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { Brand } from "./Brand.js";
import { Currency } from "./Currency.js";
import { Warehouse } from "./Warehouse.js";

test("Brand model supports active state, settings, and soft-delete status default", () => {
  const brand = new Brand({
    name: "The Vastra House",
    slug: "the-vastra-house",
  });

  const validationError = brand.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(brand.active, true);
  assert.equal(brand.status, "active");
  assert.equal(brand.settings.defaultCurrencyCode, "INR");
});

test("Currency model supports explicit code, symbol, precision, and active flag", () => {
  const currency = new Currency({
    code: "usd",
    symbol: "$",
    decimalPrecision: 2,
  });

  const validationError = currency.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(currency.code, "USD");
  assert.equal(currency.active, true);
});

test("Warehouse model uses brand reference and country-agnostic address fields", () => {
  const warehouse = new Warehouse({
    name: "US Fulfillment Hub",
    brandId: new Types.ObjectId(),
    address: {
      line1: "10 Market Street",
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
      countryCode: "us",
    },
  });

  const validationError = warehouse.validateSync();

  assert.equal(validationError, undefined);
  assert.equal(warehouse.address.countryCode, "US");
  assert.equal(warehouse.status, "active");
});
