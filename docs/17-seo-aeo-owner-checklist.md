# SEO / AEO / GEO: owner checklist, content plan and deployment

Written after the October 2026 SEO audit and hardening pass. Nothing here is invented: every
item below is either something only the business can supply, or a task that needs an off-site
action.

## A. Facts only the owner can supply (the site renders these only when filled in)

| Item | Where to enter it | Why it matters |
| --- | --- | --- |
| **Stock for every SKU** and a warehouse | Admin > Inventory | **Launch blocker.** The `warehouses` and `stockledgers` collections are empty, so every variant reads "out of stock" and cannot be bought. |
| Whether items are stocked, pre-order or made-to-order | Admin > Products / Pre-orders | The home page says pieces are "crafted after your order is placed", but the data model only knows stock and pre-order windows. Decide the real model, then the availability markup follows. |
| Exact fabric composition per product (e.g. "% cotton") | Product > Fabric details | Do not guess. Currently "cotton-based". |
| Founder / team name and story, founding year | Admin > Content > About (founder, foundedYear) | The About page renders them only when filled. Strongest entity signal still missing. |
| Street address / PIN (only if you want it public) | Admin > SEO > Organization | Enables `PostalAddress` detail and Local SEO. |
| Real social profiles (Facebook, Pinterest, YouTube, Google Business Profile) | Admin > SEO > Organization > sameAs | Only `instagram.com/support_tvh` exists. Add profiles only once they are real. |
| Exchange policy (yes/no, window) | Policies / FAQ | No exchange policy exists, so none is stated. |
| Delivery time by region | Shipping policy | The policy states dispatch time only. |
| Verify the size-chart numbers | Size guide page | The numbers come from `vastraMedia/sizechart.png`. Confirm they are real garment measurements. |
| Real GTIN/barcodes (if products have them) | Variant barcode | Current barcodes are system generated; the feed declares `identifier_exists=no`. |

## B. Off-site / marketing work (cannot be done in code)

- Google Search Console + Bing Webmaster: verify the domain, submit `https://thevastrahouse.co.in/sitemap.xml`, check Page indexing.
- Google Business Profile (if there is a public address) and consistent name/phone/email everywhere.
- Merchant Center: create the account, then add the feed `https://thevastrahouse.co.in/feeds/google-merchant.xml` (set stock first).
- Collect genuine reviews after delivery (review flow, moderation and verified-purchase labelling already exist). Never seed reviews.
- Earn mentions: fashion bloggers, creators, Indian ethnic-wear roundups, marketplaces. Brand authority is the main AI-citation lever and is earned, not coded.
- Keep the Instagram handle consistent (profile is `support_tvh`; the site previously also showed `@VastraHouse`).

## C. Editorial plan (write only with real information)

Publish through Admin > Blog (the model, article schema, sitemap and noindex-while-empty logic are ready).
The blog stays `noindex` and out of the sitemap until the first article is published.

1. How to choose your kurti size (uses the size guide) 
2. Care guide: washing cotton-based and rayon-blend kurtis (from product wash-care text)
3. How to style a co-ord set for office
4. Everyday vs office vs festive kurtis: what to pick
5. Floral-print kurtis: styling and care
6. Pre-order explained: how made-after-order pieces work (from the real process)

Each article: one H1, a 2 to 3 sentence direct answer first, short H2 sections, a table where useful,
internal links to the relevant category/product, size guide and policies, an author, a publish date.

## D. Deployment checklist

1. Backend (api.thevastrahouse.co.in): deploy the backend changes. Content validation, public-text scrub,
   `inventoryTracked` flag, category/collection names in the sitemap feed, slug indexes, `/catalog/admin/content-quality`.
   Until this ships the new schema omits nothing and `OutOfStock` is still emitted for untracked SKUs.
2. Frontend (Vercel/host): deploy. Confirm `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_API_BASE_URL` are production values.
3. After deploy, verify with curl: unknown URL returns 404; `/llms.txt` is `text/plain`; `/faq` and `/pages/size-guide` 200 and indexable; product JSON-LD is a `ProductGroup`.
4. Security headers: `Content-Security-Policy-Report-Only` is a monitor-only policy. Watch the browser console for violations for a release (Razorpay checkout, GA4, Instagram), then enforce. HSTS stays at the Cloudflare edge, unchanged.
5. Cloudflare: purge cache after deploy (the old soft-404 may be cached).
6. DB: data migration (`seoContentMigration.ts`) was already applied on 2026-10-06; it is idempotent. A full export is in `backend/backups/` (gitignored, contains customer data: keep private).
7. Admin: open Admin > SEO and review the new page-level overrides for /shop, /about, /contact, /pre-order and /policies.
