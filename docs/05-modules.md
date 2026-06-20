# 10–19. Module Breakdown

Each module lists its sub-systems/screens. This is the architectural decomposition used to scope Admin Panel navigation and backend service boundaries.

## 10. Website Modules

| Sub-module | Responsibility |
|---|---|
| Home | Hero banners, featured collections, new arrivals, testimonials, newsletter signup — all sourced from CMS. |
| Shop (PLP) | Full catalog browse with filter/sort/pagination. |
| Category & Collection Pages | Curated/categorized product listings with their own SEO metadata and banner. |
| Product Detail (PDP) | Variant selector, media gallery (aspect-ratio governed), size guide, reviews, related/recommended/FBT/complete-the-look, pre-order panel when applicable. |
| Pre-Order Listing | Filtered view of all active pre-order products with countdown/availability state. |
| Cart | Line items, quantity edit, coupon entry, gift packaging toggle, store credit/reward redemption. |
| Checkout | Address selection, shipping method, payment method selection (Razorpay/COD/Manual/UPI), order review. |
| Wishlist | Saved products with stock/price-change indicators. |
| My Account | Profile, addresses, saved payment preferences, reward points balance, store credit balance, gift cards. |
| Orders | Order history list + detail with status timeline. |
| Invoices | Customer-facing list/download of invoices tied to their orders. |
| Track Order | Public/account order tracking by order ID + shipment carrier status. |
| About Us / Contact Us | CMS-managed static content + contact form (routed to support). |
| Blogs | Listing + detail pages with schema markup. |
| FAQs | CMS-managed, with FAQ schema. |
| Policies (Privacy, Terms, Shipping, Return) | CMS-managed static legal/policy pages. |

## 11. Admin Panel Modules

| Sub-module | Responsibility |
|---|---|
| Dashboard | Role-aware landing screen: KPIs, alerts (low stock, pending payment verification, production bottlenecks). |
| Product Management | CRUD for products/variants, media assignment, badges, SEO, pre-order config. |
| Order Management | Order queue, status transitions, payment verification, shipment tracking, returns/refunds, invoice actions. |
| Inventory Management | Stock by warehouse, transfers, adjustments, alerts, logs. |
| Manufacturing Management | Vendors, production orders, costing, production-stage updates. |
| CRM | Customer list, profile/timeline, segments. |
| Marketing | Campaigns, coupons, newsletter, automation rules. |
| SEO | Global/page/product/category/blog SEO settings, sitemap status. |
| Content/CMS | Home builder, banners, collections, navigation, footer/header, testimonials, FAQs, policies. |
| Media Library | Upload, tag, search, aspect-ratio assignment, reuse across modules. |
| Invoicing | Document templates, numbering config, document history/reissue. |
| Analytics & Reports | Dashboards + CSV export. |
| Settings | Roles/permissions, brand/company info, GST config, payment gateway keys, notification templates, audit logs. |
| User & Role Management | Admin user CRUD, role assignment, permission overrides (Super Admin only). |

## 12. CRM Modules
- Customer Profile (contact, addresses, consent, tags)
- Customer Timeline (orders, support notes, campaign touches, reviews submitted)
- Purchase History (full order list with totals/status)
- Lifetime Value computation
- Segment Engine (New / Repeat / VIP / Wholesale / Inactive, rule-configurable)
- Customer Notes & Support Flags (internal-only annotations for Support Agent/Order Manager)

## 13. Inventory Modules
- Warehouse Master (multi-warehouse registry)
- Stock Ledger (Available / Reserved / Damaged / Returned / Incoming per SKU per warehouse)
- Low Stock Alert Engine (threshold-based, per SKU/warehouse)
- Inventory Log (immutable event log: sale, return, adjustment, transfer, damage-write-off)
- Stock Transfer (inter-warehouse, with in-transit state)
- Stock Adjustment (manual correction with reason code, role-restricted)

## 14. Manufacturing Modules
- Fabric Inventory (raw material stock, distinct from finished-goods inventory)
- Vendor Masters: Fabric Vendors, Tailors, Printing Vendors, Embroidery Vendors, Packaging Vendors
- Production Orders (linking demand → vendor/tailor assignment → production stage)
- Production Stage Tracker (9-stage pipeline, cascades to linked pre-orders)
- Costing Engine (Fabric/Labor/Printing/Packaging/Courier cost inputs → computed margin vs. selling price, per style/production order)

## 15. Marketing Modules
- Newsletter (subscriber list, double opt-in)
- Email Campaign Builder (template + audience/segment selection + schedule)
- Coupon Engine (flat/percentage/free-shipping, min cart, max discount, usage limits)
- Festival Campaign Orchestration (banner + email + coupon bundle, scheduled)
- Abandoned Cart Recovery (trigger rules + sequenced emails)
- Win-Back Campaigns (targets Inactive segment)
- Review Request Automation (post-delivery delay trigger)
- Back-In-Stock Notification Dispatch (triggered by inventory replenishment event)
- Referral Program Engine (code generation, attribution, reward issuance)
- Loyalty/Reward Points Engine (earn rules, redemption rules, expiry rules)
- Store Credit Ledger
- Gift Card Engine (issuance, balance, redemption)

## 16. SEO Modules
- Global SEO Settings (site-wide defaults, social/OG defaults, verification tags)
- Page SEO override (per static page)
- Product / Category / Collection / Blog SEO override
- Sitemap Generator (Product, Category, Blog, Image sitemaps + sitemap index)
- robots.txt Manager
- Canonical URL Resolver (handles filter/pagination params)
- Structured Data Emitter (Organization, Website, Product, Review, FAQ, Breadcrumb, Article schema)

## 17. Reporting Modules
- Revenue & Orders Dashboard (date-range comparisons)
- Customer Analytics (new vs repeat, lifetime value distribution)
- Conversion Funnel (visit → cart → checkout → order)
- Product/Category/Collection Performance
- Traffic Source Attribution
- Abandoned Cart Rate
- Repeat Customer Rate
- Export Engine (CSV)

## 18. Notification Modules
- Transactional Email (order/payment/production/shipment/account events) via SMTP/Brevo
- Transactional WhatsApp (order/payment/production/shipment events) via WhatsApp Business API
- Marketing Email dispatch (campaigns, newsletters) via Brevo
- Notification Template Manager (admin-editable templates per event type, per channel)
- Notification Log (per customer/order audit trail of what was sent, when, delivery status)

## 19. Invoice Modules
- Document Generator (Tax Invoice, Proforma Invoice, Receipt, Credit Note, Debit Note, Delivery Challan, Return Invoice) via Puppeteer PDF rendering
- Numbering/Prefix Configuration (Invoice, Proforma, Order, SKU sequences, independently configurable, financial-year-aware, atomic/gapless)
- Document Store (immutable PDF archive, linked to order/return/customer)
- Reissue/Resend flow (email PDF on demand, without altering the original document)

## 20. Search & Discovery Modules (added — [12-architect-review.md](12-architect-review.md))
- Search Index Sync Pipeline (catalog change → index update, with scheduled reconciliation re-index)
- Search/Autocomplete API (typo-tolerant, synonym-aware, relevance-ranked)
- Admin Synonym & Boost Configuration

## 21. Fraud & Risk Modules (added — [12-architect-review.md](12-architect-review.md))
- Risk-Scoring Service (payment velocity, multi-account/device heuristics, high-value-COD flagging)
- Flagged Orders Review Queue (manual hold/release, audit-logged)

## 22. Support & Helpdesk Modules (added — [12-architect-review.md](12-architect-review.md))
- Ticket Management (creation, assignment, priority, status, SLA/age indicators)
- Contact-Form-to-Ticket Pipeline
- Resolution-to-CRM-Timeline Sync

## 23. Data Privacy & Compliance Modules (added — [12-architect-review.md](12-architect-review.md))
- Customer Data Export ("download my data") Self-Service
- Account/Data Deletion Request Workflow (with PII anonymization preserving statutory financial records)
- Admin Fulfillment Queue for Privacy Requests

## 24. Logistics & Courier Modules (added — [12-architect-review.md](12-architect-review.md))
- Courier API Integration Layer (multi-carrier abstraction)
- Rate Shopping (checkout-time shipping option comparison)
- Label Generation & Pickup Scheduling
- Tracking Webhook Ingestion (auto-updates Order Management's shipment fields)
- Manual-Entry Fallback (carrier-outage resilience)
