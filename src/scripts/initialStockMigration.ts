import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Brand } from "../models/Brand.js";
import { Product } from "../models/Product.js";
import { StockLedger } from "../models/StockLedger.js";
import { Warehouse } from "../models/Warehouse.js";
import { upsertStockLedger } from "../services/inventoryService.js";

/**
 * One-off: gives every active variant that has NO stock ledger yet `UNITS` available units, so
 * the catalogue can be purchased while the owner enters real counts.
 *
 *   npm run db:backup                               # always take a backup first
 *   tsx src/scripts/initialStockMigration.ts          # dry run
 *   tsx src/scripts/initialStockMigration.ts --apply  # writes
 *
 * Idempotent: SKUs that already have any ledger are skipped, so owner-entered counts are never
 * overwritten. Nothing is deleted.
 */
const APPLY = process.argv.includes("--apply");
const UNITS = 2;
const WAREHOUSE_NAME = "Main Warehouse";
const log = (message: string) => console.info(`${APPLY ? "[apply]" : "[dry-run]"} ${message}`);

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  let warehouse = await Warehouse.findOne({ active: true }).sort({ createdAt: 1 });
  if (warehouse) {
    log(`Using existing warehouse "${warehouse.name}" (${warehouse._id})`);
  } else {
    const referenced = await Product.findOne({ brandId: { $exists: true } })
      .select("brandId")
      .lean();
    let brandId = referenced?.brandId ?? (await Brand.findOne().sort({ createdAt: 1 }))?._id;
    log(
      `Would create warehouse "${WAREHOUSE_NAME}" (placeholder address), brand ${brandId ?? "new: The Vastra House"}`,
    );
    if (APPLY) {
      if (!brandId) {
        brandId = (await Brand.create({ name: "The Vastra House", slug: "the-vastra-house" }))._id;
        log(`Created brand ${brandId}`);
      }
      warehouse = await Warehouse.create({
        active: true,
        address: {
          city: "Update in Admin > Inventory",
          countryCode: "IN",
          line1: "Placeholder address - update in Admin > Inventory",
        },
        brandId,
        name: WAREHOUSE_NAME,
      });
      log(`Created warehouse ${warehouse._id}`);
    }
  }

  const products = await Product.find({}).select("name slug variants").lean();
  let created = 0;
  let skipped = 0;

  // A SKU shared by several variants would pool their stock (ledgers are keyed by SKU), so those
  // are left for the owner to fix instead of silently selling the same units under many sizes.
  const skuCounts = new Map<string, number>();
  for (const product of products) {
    for (const variant of product.variants ?? []) {
      const key = String(variant.sku ?? "")
        .trim()
        .toUpperCase();
      if (key) skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
    }
  }

  for (const product of products) {
    for (const variant of product.variants ?? []) {
      if (variant.active === false || !variant.sku) continue;
      const sku = String(variant.sku).trim().toUpperCase();

      if ((skuCounts.get(sku) ?? 0) > 1) {
        skipped += 1;
        log(
          `Skipped ${product.name} / ${sku} (SKU shared by ${skuCounts.get(sku)} variants; make SKUs unique first)`,
        );
        continue;
      }

      if (await StockLedger.exists({ sku })) {
        skipped += 1;
        log(`Skipped ${sku} (ledger exists)`);
        continue;
      }

      created += 1;
      log(`${product.name} / ${sku}: available ${UNITS}`);
      if (APPLY && warehouse) {
        await upsertStockLedger({
          actor: { actorType: "system" },
          available: UNITS,
          sku,
          warehouseId: String(warehouse._id),
        });
      }
    }
  }

  log(`Summary: ${created} ledger(s) ${APPLY ? "created" : "to create"}, ${skipped} skipped`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
