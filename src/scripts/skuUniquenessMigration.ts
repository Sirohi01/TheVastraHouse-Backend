import mongoose from "mongoose";
import { env } from "../config/env.js";

/**
 * One-off: gives variants that wrongly shared the SKU TVH-KUR-FLR-NVY-M their own SKU.
 *
 *   npm run db:backup                                  # always take a backup first
 *   tsx src/scripts/skuUniquenessMigration.ts            # dry run
 *   tsx src/scripts/skuUniquenessMigration.ts --apply    # writes
 *
 * Premium Floral M keeps the existing SKU. Only products.variants.sku is touched; orders (all
 * cancelled), audit logs and carts are left as they are (carts re-sync by variantId). Each rename
 * is guarded: the variant must currently hold the old SKU and the new SKU must be unused.
 */
const APPLY = process.argv.includes("--apply");
const log = (message: string) => console.info(`${APPLY ? "[apply]" : "[dry-run]"} ${message}`);

const OLD_SKU = "TVH-KUR-FLR-NVY-M";
const RENAMES = [
  { productSlug: "premium-floral-sleeveless-kurti", size: "S", sku: "TVH-KUR-FLR-NVY-S" },
  { productSlug: "premium-floral-sleeveless-kurti", size: "L", sku: "TVH-KUR-FLR-NVY-L" },
  { productSlug: "vanya-full-sleeve-kurti", size: "M", sku: "TVH-VANYA-RUST-M" },
  { productSlug: "vanya-full-sleeve-kurti", size: "S", sku: "TVH-VANYA-RUST-S" },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const products = mongoose.connection.db!.collection("products");

  for (const rename of RENAMES) {
    const taken = await products.countDocuments({ "variants.sku": rename.sku });
    if (taken) {
      log(`Skipped ${rename.productSlug}/${rename.size}: ${rename.sku} already in use`);
      continue;
    }

    const product = await products.findOne({ slug: rename.productSlug });
    const variant = product?.variants?.find(
      (item: { sku?: string; size?: string }) => item.sku === OLD_SKU && item.size === rename.size,
    );
    if (!product || !variant) {
      log(`Skipped ${rename.productSlug}/${rename.size}: no variant currently holds ${OLD_SKU}`);
      continue;
    }

    log(`${rename.productSlug}/${rename.size} (${variant._id}): ${OLD_SKU} -> ${rename.sku}`);
    if (APPLY) {
      const result = await products.updateOne(
        { _id: product._id, variants: { $elemMatch: { _id: variant._id, sku: OLD_SKU } } },
        { $set: { "variants.$.sku": rename.sku } },
      );
      log(`  modified ${result.modifiedCount}`);
    }
  }

  const stillShared = await products
    .aggregate([
      { $unwind: "$variants" },
      { $group: { _id: "$variants.sku", n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ])
    .toArray();
  log(`Remaining duplicate SKUs: ${JSON.stringify(stillShared)}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
