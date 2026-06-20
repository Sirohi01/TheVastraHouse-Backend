# 1. Product Vision Document

## 1.1 Vision Statement

**The Vastra House is the operating system that runs a modern fashion brand end-to-end** — from the moment fabric is sourced to the moment a customer's order lands at their door, and every loyalty point, invoice, pre-order, and marketing touch in between.

Most "ecommerce platforms" solve only the storefront problem: list products, take payment, ship a box. The Vastra House solves the **whole business problem** of running an apparel brand that:

- Sells **made-to-order and pre-order** garments alongside in-stock inventory (a reality of fashion/apparel that generic ecommerce platforms ignore).
- Manufactures in-house or through a vendor network (tailors, printers, embroidery units, fabric vendors) and needs to track a garment through **production stages**, not just "processing → shipped."
- Must reconcile **manual/offline payments** (bank transfer, UPI screenshots) common in the Indian D2C fashion market, alongside Razorpay and COD.
- Needs **GST-compliant invoicing** (HSN codes, tax breakdowns, credit/debit notes) as a first-class system, not a bolt-on PDF.
- Will eventually run **wholesale/B2B alongside retail**, sell under **multiple brands**, ship **internationally**, and price in **multiple currencies** — without a rewrite.
- Treats **SEO, content, and marketing automation** as core retention/acquisition infrastructure, not admin afterthoughts.

The platform is architected as a set of cooperating modules (Catalog, Inventory, Manufacturing, Orders, Payments, Invoicing, CRM, Marketing, SEO, Analytics) behind a single Admin Panel and a single Customer Website, so that the business can scale in complexity (more brands, more warehouses, more countries) without the underlying system being re-architected.

## 1.2 Problem Statement

Fashion/apparel D2C brands in India (and similar markets) currently stitch together:
- A generic ecommerce platform (Shopify/WooCommerce) for the storefront,
- Spreadsheets or a separate ERP-lite tool for inventory and production tracking,
- WhatsApp/manual processes for pre-orders, manual payment verification, and tailor/vendor coordination,
- A separate invoicing tool for GST compliance,
- Disconnected email tools for marketing.

This fragmentation causes: inventory mismatches between channels, no visibility into production status for pre-order customers, manual reconciliation of bank-transfer payments, inconsistent GST invoices, and no unified view of a customer across marketing, support, and orders.

**The Vastra House removes this fragmentation** by being the single system of record for product, inventory, production, order, payment, invoice, and customer data.

## 1.3 Product Description

The Vastra House consists of two primary applications sharing one backend and data layer:

1. **Customer Website** — a fast, SEO-optimized, mobile-first storefront for browsing, pre-ordering, purchasing, and tracking orders, with full account self-service (orders, invoices, wishlist, rewards, store credit, gift cards).
2. **Admin Panel** — a single operational console for every internal role (Super Admin down to Support Agent) to manage catalog, inventory, manufacturing, orders, payments, invoices, CRM, marketing, SEO, content, and analytics.

Both are powered by a common **Node.js/Express + MongoDB backend**, exposing a versioned API that is consumable by the website today and by a future mobile app without modification (see [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §Mobile App Readiness).

## 1.4 Strategic Differentiators

| Differentiator | Why it matters |
|---|---|
| Native Pre-Order + Production Tracker | Fashion brands routinely sell garments before they're made; customers need visible production-stage tracking (Fabric Sourcing → Dispatch), which generic platforms don't model. |
| Native Manufacturing Module | Vendor (tailor/printer/embroidery/fabric) management and costing (fabric/labor/printing/packaging/courier → margin) live inside the same system as the order, not a spreadsheet. |
| Manual Payment Verification Flow | UPI/bank-transfer screenshot upload → admin approval/rejection is a first-class payment method, not a workaround. |
| GST-Native Invoicing | HSN codes, GST breakdowns, credit/debit notes, delivery challans are modeled from day one, with Puppeteer-generated PDFs matching statutory requirements. |
| Aspect-Ratio-Governed Media System | Every image/video enforces an admin-selected aspect ratio consistently across desktop/tablet/mobile — protecting brand visual consistency at scale. |
| Modular, Multi-Brand-Ready Architecture | Catalog, inventory, and CRM are modeled so a second brand, a wholesale channel, a new country, or a new currency is a configuration/extension, not a rebuild. |

## 1.5 Target Outcome (12–18 months post-launch)

- Single platform replaces 4–6 disconnected tools currently used to run the brand's operations.
- Admin team can fulfill pre-orders with full production visibility and proactive customer communication (status emails/WhatsApp at each production stage).
- Finance team generates compliant tax invoices, credit notes, and reports without manual spreadsheet work.
- Marketing team runs abandoned-cart, win-back, and festival campaigns natively, without exporting customer lists to a third-party tool.
- The business can onboard a wholesale/B2B customer segment and, separately, a second sub-brand, using existing infrastructure.

## 1.6 Non-Goals (explicitly out of scope for the core platform)

- Building a generic multi-tenant SaaS for arbitrary third-party brands (the multi-brand requirement is about *this* business running multiple brands it owns, not a SaaS product).
- Native mobile apps (the API is built mobile-ready; native/cross-platform app development is a future, separate initiative).
- Marketplace integrations (Amazon/Myntra/Flipkart channel sync) — explicitly listed under Future Expansion, not core scope.
- In-house payment gateway or courier/logistics network — the platform integrates with Razorpay and (future) courier APIs, it does not become one.
