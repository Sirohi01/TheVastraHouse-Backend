import mongoose from "mongoose";
import { env } from "../config/env.js";

/**
 * Idempotent fix for the product-page trust badges.
 *
 *   npm run db:backup                              # always take a backup first
 *   tsx src/scripts/trustBadgesMigration.ts          # dry run
 *   tsx src/scripts/trustBadgesMigration.ts --apply  # writes
 *
 * The storefront fell back to code defaults that claimed a "12 Days Replacement" and
 * "Premium Cotton Fabric", neither of which appears in the published policies (7-day return,
 * fabric not confirmed per product). The badges below only state what the policies say. Owner
 * edits are never overwritten: the write happens only while the stored list is empty or still
 * contains the unsupported claims.
 */
const APPLY = process.argv.includes("--apply");
const log = (message: string) => console.info(`${APPLY ? "[apply]" : "[dry-run]"} ${message}`);

const UNSUPPORTED = ["12 Days Replacement", "Premium Cotton Fabric"];
const BADGES = [
  { enabled: true, icon: "truck", title: "Tracked Delivery" },
  { enabled: true, icon: "returns", subtitle: "(Conditions Apply)", title: "7-Day Returns" },
  { enabled: true, icon: "wallet", title: "Refund To Original Payment" },
  { enabled: true, icon: "shield", title: "Secure Payments" },
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const collection = mongoose.connection.db!.collection("cmscontents");
  const doc = await collection.findOne({ key: "storefront-main" });

  if (!doc) {
    log("No storefront-main CMS document; nothing to do");
  } else {
    const current = (doc.productTrustBadges ?? []) as Array<{ title?: string }>;
    const isDefault = current.length === 0;
    const hasUnsupported = current.some((badge) => UNSUPPORTED.includes(badge.title ?? ""));

    if (!isDefault && !hasUnsupported) {
      log(`Skipped: owner-edited badges kept (${current.map((b) => b.title).join(", ")})`);
    } else {
      log(`Setting productTrustBadges (was ${current.length ? JSON.stringify(current) : "empty"})`);
      if (APPLY) {
        const result = await collection.updateOne(
          { _id: doc._id },
          { $set: { productTrustBadges: BADGES } },
        );
        log(`Modified ${result.modifiedCount} document(s) (id ${doc._id})`);
      }
    }
  }

  await mongoose.disconnect();
}

void main();
