import mongoose from "mongoose";
import { env } from "../config/env.js";
import { findInternalNote, stripInternalNotes } from "../services/contentGuardService.js";

/**
 * One-off, idempotent content migration for the SEO/AEO clean-up.
 *
 *   npm run db:backup                      # always take a backup first
 *   tsx src/scripts/seoContentMigration.ts          # dry run: prints what would change
 *   tsx src/scripts/seoContentMigration.ts --apply  # writes
 *
 * Rules: only facts already present in the store's own data/policies are used; existing,
 * owner-edited content is never overwritten (updates are guarded by "old value equals X").
 */

const APPLY = process.argv.includes("--apply");
const SIZE_CHART_URL =
  "https://res.cloudinary.com/dzxlcorcf/image/upload/v1782014898/vastra-house/media/e70dhxtwi4ejx2ya1wcs.png";
const SIZE_CHART_ALT =
  "Size chart for The Vastra House kurtis and co-ord sets: bust, waist, hip, shoulder and length in inches for sizes XS to 3XL";

const log = (message: string) => console.info(`${APPLY ? "[apply]" : "[dry-run]"} ${message}`);

const faqBody = `
<p>Answers to common questions about ordering, payment, shipping, returns, sizing and care at The Vastra House. Each answer reflects our published policies; the full wording is on the <a href="/policies">policy pages</a>.</p>

<h2>Orders and payment</h2>
<h3>How do I place an order?</h3>
<p>Choose your size on a product page, add it to your cart and check out with your delivery address. You can pay online through Razorpay or choose Cash on Delivery (COD).</p>
<h3>Which payment methods are available?</h3>
<p>Online payments are processed by Razorpay, and we never see or store your card details. Cash on Delivery is available at checkout.</p>
<h3>How does Cash on Delivery work?</h3>
<p>COD orders are secured: half of the order value is paid online at checkout through Razorpay and the balance is paid on delivery.</p>
<h3>Do prices include GST?</h3>
<p>Yes. Prices on the website include GST.</p>
<h3>Why does a product show as out of stock?</h3>
<p>The size or colour you selected is currently unavailable. Use the "Notify me" form on the product page to receive an email when it is back.</p>

<h2>Shipping and delivery</h2>
<h3>How much does shipping cost?</h3>
<p>Standard shipping is free above the order value shown in the site header and at checkout; below that a standard shipping fee applies. Express shipping is charged at checkout. See the <a href="/policies/shipping-policy">shipping policy</a>.</p>
<h3>How long does dispatch take?</h3>
<p>In-stock orders are dispatched within 2–4 business days. Pre-order items ship on the expected dispatch date shown on the product page.</p>
<h3>How can I track my order?</h3>
<p>You receive tracking details by email once your order ships. You can also follow it on the <a href="/track-order">Track Order</a> page or under My Account &gt; Orders.</p>

<h2>Pre-orders</h2>
<h3>What is a pre-order?</h3>
<p>Pre-order items are made after you order. Expected dispatch dates are estimates, and we keep you updated at each production stage. Browse current pre-orders on the <a href="/pre-order">pre-order page</a>.</p>

<h2>Returns, refunds and cancellation</h2>
<h3>What is the return window?</h3>
<p>You can request a return within 7 days of delivery from My Account &gt; Orders. Items must be unused, unwashed and have their original tags.</p>
<h3>How do refunds work?</h3>
<p>Online payments are refunded to the original payment method. COD orders are refunded by bank transfer or as store credit. Refunds are processed after the returned item passes quality check. Read the <a href="/policies/return-policy">return and refund policy</a>.</p>
<h3>Which items cannot be returned?</h3>
<p>Custom and made-to-measure pieces cannot be returned unless they arrive damaged or defective.</p>
<h3>Can I cancel my order?</h3>
<p>You can cancel from My Account &gt; Orders until the order is dispatched. After dispatch an order cannot be cancelled, but you can request a return after delivery. See the <a href="/policies/cancellation-policy">cancellation policy</a>.</p>

<h2>Sizing, fabric and care</h2>
<h3>How do I choose my size?</h3>
<p>Compare your bust, waist and hip measurements with our <a href="/pages/size-guide">size guide</a>. Measurements can vary by about 1 inch, and if you prefer a relaxed fit the guide suggests choosing one size up.</p>
<h3>Where do I find fabric and care details?</h3>
<p>Every product page lists its fabric details, wash care instructions and available sizes.</p>

<h2>Support</h2>
<h3>How do I contact The Vastra House?</h3>
<p>Email support@thevastrahouse.co.in or call +91 8868979485. You can also use the <a href="/contact">contact form</a>.</p>
`;

const sizeGuideBody = `
<p>Use this guide to choose your size for The Vastra House kurtis and co-ord sets. All measurements are in inches. Each product page lists the sizes currently available for that style.</p>
<img src="${SIZE_CHART_URL}" alt="${SIZE_CHART_ALT}" width="1536" height="1024" loading="lazy" />

<h2>Size chart (inches)</h2>
<table>
<thead><tr><th scope="col">Size</th><th scope="col">Bust</th><th scope="col">Waist</th><th scope="col">Hip</th><th scope="col">Shoulder</th><th scope="col">Length</th></tr></thead>
<tbody>
<tr><th scope="row">XS (34)</th><td>34</td><td>32</td><td>38</td><td>13.5</td><td>34</td></tr>
<tr><th scope="row">S (36)</th><td>36</td><td>34</td><td>40</td><td>14</td><td>34</td></tr>
<tr><th scope="row">M (38)</th><td>38</td><td>36</td><td>42</td><td>14.5</td><td>35</td></tr>
<tr><th scope="row">L (40)</th><td>40</td><td>38</td><td>44</td><td>15</td><td>35</td></tr>
<tr><th scope="row">XL (42)</th><td>42</td><td>40</td><td>46</td><td>15.5</td><td>36</td></tr>
<tr><th scope="row">XXL (44)</th><td>44</td><td>42</td><td>48</td><td>16</td><td>36</td></tr>
<tr><th scope="row">3XL (46)</th><td>46</td><td>44</td><td>50</td><td>16.5</td><td>37</td></tr>
</tbody>
</table>

<h2>How to measure</h2>
<ul>
<li><strong>Bust:</strong> measure around the fullest part of your bust.</li>
<li><strong>Waist:</strong> measure around the narrowest part of your waist.</li>
<li><strong>Hip:</strong> measure around the fullest part of your hips.</li>
<li><strong>Shoulder:</strong> measure from one shoulder end to the other.</li>
<li><strong>Length:</strong> measure from the highest point of the shoulder to the hem.</li>
</ul>

<h2>Fit guidance</h2>
<h3>What if I am between two sizes?</h3>
<p>Measurements may vary by about 1 inch. For a relaxed fit, choose one size up.</p>
<h3>Do all styles have the same measurements?</h3>
<p>This chart is our general size guide. Product measurements may vary slightly due to manual measurement, so check the size notes on the product page, and contact us if you want help with a specific style.</p>

<h2>Need help choosing?</h2>
<p>Email support@thevastrahouse.co.in or call +91 8868979485, or visit the <a href="/contact">contact page</a>. See also our <a href="/faq">FAQs</a> and <a href="/policies/return-policy">return policy</a>.</p>
`;

const aboutSections = [
  {
    body: "The Vastra House is an Indian ethnic wear brand for women, based in Gurugram, Haryana. We sell kurtis and co-ord sets online and ship within India.",
    heading: "Who we are",
  },
  {
    body: "Our range covers everyday wear, office wear and festive wear: floral-print kurtis and co-ord sets in breathable cotton-based and rayon-blend fabrics. Each product page lists its fabric, wash care and available sizes.",
    heading: "What we make",
  },
  {
    body: "Some pieces are available as pre-orders and are made after you order. Expected dispatch dates are shown on the product page, and we update you at each production stage.",
    heading: "How orders work",
  },
  {
    body: "Pay online through Razorpay or choose secured Cash on Delivery. Standard shipping is free above the order value shown at checkout, and you can return unused items with original tags within 7 days of delivery.",
    heading: "Payment, shipping and returns",
  },
  {
    body: "Email support@thevastrahouse.co.in or call +91 8868979485 for help with orders, sizing, shipping and returns. Follow new styles on Instagram at @support_tvh.",
    heading: "Contact us",
  },
];

const pageSeo = [
  {
    path: "/shop",
    seo: {
      description:
        "Shop kurtis and co-ord sets for women at The Vastra House: floral prints in breathable fabrics, with prices, sizes and care details on every product page.",
      title: "Shop Kurtis & Co-ord Sets for Women | The Vastra House",
    },
  },
  {
    path: "/about",
    seo: {
      description:
        "The Vastra House is an Indian ethnic wear brand for women, based in Gurugram, Haryana, offering kurtis and co-ord sets in breathable fabrics.",
      title: "About The Vastra House | Indian Wear for Women",
    },
  },
  {
    path: "/contact",
    seo: {
      description:
        "Contact The Vastra House by email or phone for help with orders, sizing, shipping and returns.",
      title: "Contact The Vastra House | Order, Shipping & Returns Help",
    },
  },
  {
    path: "/pre-order",
    seo: {
      description:
        "Pre-order kurtis and co-ord sets from The Vastra House. Pre-order pieces are made after you order, with expected dispatch dates on each product.",
      title: "Pre-order Kurtis & Co-ord Sets | The Vastra House",
    },
  },
  {
    path: "/policies",
    seo: {
      description:
        "Shipping, return, cancellation, privacy and terms for orders at The Vastra House.",
      title: "Store Policies | The Vastra House",
    },
  },
];

const policySummaries: Record<string, string> = {
  "cancellation-policy":
    "Cancel an order from My Account until it is dispatched; online payments are refunded to the original payment method.",
  "privacy-policy":
    "What personal data The Vastra House collects, how it is used, and how to manage or delete it.",
  "return-policy":
    "Return unused, unwashed items with original tags within 7 days of delivery. How refunds work for online and COD orders.",
  "shipping-policy":
    "Dispatch times, shipping charges and order tracking for The Vastra House orders.",
  "terms-and-conditions": "Terms for orders, pre-orders and use of The Vastra House website.",
};

const categoryCopy: Record<string, { from: RegExp; to: string }> = {
  "everyday-wear": {
    from: /^Discover the latest additions to The Vastra House\./,
    to: "Comfortable kurtis and co-ord sets for daily wear, in breathable cotton-based and rayon-blend fabrics with floral prints. Each product page lists fabric details, wash care and available sizes.",
  },
  "new-arrival": {
    from: /^Discover premium women's kurtis crafted/,
    to: "The newest additions to The Vastra House: floral kurtis and co-ord sets for women. Check each product page for fabric details, wash care and sizes.",
  },
  "our-fav": {
    from: /^Our Fav collection is here$/,
    to: "Handpicked favourites from The Vastra House: kurtis and co-ord sets for everyday and office wear that we recommend first.",
  },
};

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db!;
  console.info(`Database: ${db.databaseName} (${APPLY ? "APPLY" : "dry run"})`);

  // 1. Products: remove leaked internal notes, fix the size chart alt text.
  for (const product of await db.collection("products").find({}).toArray()) {
    const set: Record<string, unknown> = {};
    for (const field of [
      "fabricDetails",
      "washCare",
      "sizeGuide",
      "shortDescription",
      "description",
    ]) {
      const value = product[field];
      if (typeof value === "string" && findInternalNote(value)) {
        set[field] = stripInternalNotes(value);
        log(
          `product ${product.slug}.${field}: "${value.slice(0, 70)}…" -> "${String(set[field]).slice(0, 70)}"`,
        );
      }
    }
    if (product.sizeGuideMedia?.altText && product.sizeGuideMedia.altText !== SIZE_CHART_ALT) {
      set["sizeGuideMedia.altText"] = SIZE_CHART_ALT;
      log(`product ${product.slug}: size chart alt text`);
    }
    if (APPLY && Object.keys(set).length) {
      await db.collection("products").updateOne({ _id: product._id }, { $set: set });
    }
  }

  // 2. CMS pages: FAQ and size guide (insert only when missing), policy summaries.
  const pages = db.collection("cmspages");
  const now = new Date();
  for (const page of [
    {
      body: faqBody,
      slug: "faq",
      summary:
        "Answers about ordering, Cash on Delivery, shipping, returns, sizing and care at The Vastra House.",
      title: "Frequently Asked Questions",
    },
    {
      body: sizeGuideBody,
      slug: "size-guide",
      summary:
        "Size chart in inches (XS to 3XL) with bust, waist, hip, shoulder and length, plus how to measure.",
      title: "Size Guide",
    },
  ]) {
    if (await pages.findOne({ slug: page.slug })) {
      log(`cmspage ${page.slug}: already exists, left untouched`);
      continue;
    }
    log(`cmspage ${page.slug}: create (published)`);
    if (APPLY) {
      await pages.insertOne({
        ...page,
        createdAt: now,
        faqs: [],
        kind: "page",
        pageStatus: "published",
        publishedAt: now,
        seo: { robotsFollow: true, robotsIndex: true, schemaEnabled: true },
        showInFooter: true,
        sortOrder: 0,
        status: "active",
        updatedAt: now,
      });
    }
  }
  for (const [slug, summary] of Object.entries(policySummaries)) {
    const page = await pages.findOne({ slug });
    if (page && (page.summary?.length ?? 0) < 60) {
      log(`cmspage ${slug}: summary -> "${summary}"`);
      if (APPLY) await pages.updateOne({ slug }, { $set: { summary } });
    }
  }

  // 3. Category/collection copy that was misplaced or placeholder.
  for (const [slug, rule] of Object.entries(categoryCopy)) {
    const doc = await db.collection("categories").findOne({ slug });
    if (doc && rule.from.test(doc.description ?? "")) {
      log(`category ${slug}: description replaced`);
      if (APPLY)
        await db.collection("categories").updateOne({ slug }, { $set: { description: rule.to } });
    }
  }

  // 4. About content (storefront-main): customer-facing copy + entity sections.
  const cms = db.collection("cmscontents");
  const content = await cms.findOne({ key: "storefront-main" });
  if (content?.about) {
    const set: Record<string, unknown> = {};
    if (/commerce experience|cataloging/.test(content.about.description ?? "")) {
      set["about.description"] =
        "The Vastra House is an Indian ethnic wear brand for women, offering kurtis and co-ord sets for everyday, office and festive dressing.";
    }
    if (/international shopping experience/.test(content.about.storyCopy ?? "")) {
      set["about.storyCopy"] =
        "We make Indian wear for women who want comfortable, easy-to-style kurtis and co-ord sets in breathable fabrics, with clear product details, secure checkout and order tracking.";
    }
    if (content.about.media?.altText === "Best Kurti and Dresses in Delhi Ncr") {
      set["about.media.altText"] =
        "Embroidered fabric detail from The Vastra House ethnic wear collection";
    }
    const values = content.about.values ?? [];
    const careIndex = values.findIndex((item: { text?: string }) =>
      /workflows are built into the platform/.test(item.text ?? ""),
    );
    if (careIndex >= 0) {
      set[`about.values.${careIndex}.text`] =
        "Reach us by email or phone for help with orders, sizing, shipping and returns.";
    }
    if (!(content.about.sections ?? []).length) set["about.sections"] = aboutSections;
    if (Object.keys(set).length) {
      log(`cmscontents about: ${Object.keys(set).join(", ")}`);
      if (APPLY) await cms.updateOne({ _id: content._id }, { $set: set });
    }
  }

  // 5. Page-level SEO overrides (only for paths that have none yet).
  const settings = await db.collection("seosettings").findOne({ key: "global" });
  if (settings) {
    const existing = new Set((settings.pages ?? []).map((page: { path: string }) => page.path));
    const additions = pageSeo
      .filter((page) => !existing.has(page.path))
      .map((page) => ({
        label: page.path,
        path: page.path,
        seo: { ...page.seo, robotsFollow: true, robotsIndex: true, schemaEnabled: true },
      }));
    if (additions.length) {
      log(`seosettings.pages: add ${additions.map((item) => item.path).join(", ")}`);
      if (APPLY)
        await db
          .collection("seosettings")
          .updateOne({ key: "global" }, { $push: { pages: { $each: additions } } } as never);
    }
  }

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
