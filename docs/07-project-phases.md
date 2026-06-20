# Project Phases (Phase 2 & 3 of the planning exercise)

The full build is decomposed into **30 delivery phases**, ordered to respect technical dependency (foundation → catalog → commerce → fulfillment → growth → hardening). Every module from [05-modules.md](05-modules.md) and every feature from [04-feature-list.md](04-feature-list.md) maps to exactly one phase below (cross-references noted). Each phase lists Objective, Deliverables, Dependencies, Risks, and Acceptance Criteria. Complexity/effort/priority/critical-path classification for each phase is in [09-estimation-and-priority.md](09-estimation-and-priority.md); atomic tasks are in [08-atomic-tasks.md](08-atomic-tasks.md).

---

## Phase 1 — Project Setup & Architecture Foundation
**Objective:** Establish the monorepo/multi-repo structure, environment configuration, coding standards, and shared infrastructure (DB connection, logging, error handling, CI) that every later phase builds on.
**Deliverables:** Repo structure (frontend, backend, shared types/config); Next.js 15 + TypeScript app scaffold; Express + TypeScript app scaffold; MongoDB connection layer; environment/config management (.env strategy per environment); base ESLint/Prettier/commit-hook standards; base CI pipeline (lint, type-check, build); centralized logging and error-handling middleware; base folder structure reflecting module boundaries (catalog, inventory, manufacturing, orders, payments, CRM, marketing, SEO, CMS).
**Dependencies:** None (first phase).
**Risks:** Wrong foundational structure compounds cost across all later phases; under-investing in config/secrets management causes rework when adding multi-brand/multi-currency later.
**Acceptance Criteria:** Both apps boot locally and in CI; lint/type-check/build pass on a clean checkout; a sample "health check" endpoint and page round-trip successfully; module folder boundaries documented and enforced by lint rules where possible.

## Phase 2 — Core Data Model & Shared Backend Infrastructure
**Objective:** Define the foundational Mongoose models and shared backend services (not yet feature-complete) that most modules depend on: Brand, Warehouse, Currency, Address, User (base), Media reference shape, audit/activity log primitives.
**Deliverables:** Base schemas for Brand, Warehouse, Currency, Address (locale-flexible), Media reference; shared audit-log/activity-log service; shared pagination/filter/query utilities; shared validation layer (request schema validation).
**Dependencies:** Phase 1.
**Risks:** Designing these too narrowly (e.g., India-only address, single-brand assumption) creates the exact rework the architecture goals exist to avoid — extra design review time budgeted here deliberately.
**Acceptance Criteria:** Brand/Warehouse/Currency/Address models support the multi-brand/multi-warehouse/multi-currency requirements in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) without placeholder-only fields; audit log captures actor/timestamp/before-after on a test entity.

## Phase 3 — Authentication, Authorization & RBAC
**Objective:** Deliver full authentication (registration, login, OTP, forgot password, JWT + refresh tokens) and the RBAC permission engine for all 7 admin roles plus customer/wholesale account types.
**Deliverables:** User model (customer + admin, role field); JWT access/refresh token issuance and rotation; OTP service (email/SMS-ready); forgot-password flow + email template; RBAC middleware (role + permission check); role/permission seed data for the 7 roles in [02-goals-and-users.md](02-goals-and-users.md) §5; admin login history logging; frontend login/register/forgot-password/OTP pages; Zustand auth store + React Query session handling.
**Dependencies:** Phase 1, Phase 2.
**Risks:** Refresh-token rotation/reuse-detection is easy to get subtly wrong (security-critical); under-scoping RBAC granularity now is expensive to retrofit once many modules depend on it.
**Acceptance Criteria:** Each of the 7 roles can log in and is correctly restricted from out-of-scope actions in a test matrix; refresh token rotation invalidates reused/stale tokens; OTP and forgot-password flows complete end-to-end in staging; login history visible in admin.

## Phase 4 — Media & Aspect-Ratio Governance System
**Objective:** Build the Cloudinary-backed media pipeline enforcing aspect-ratio selection, original preservation, responsive delivery, and the Media Library — a prerequisite for catalog, CMS, and blog phases.
**Deliverables:** Media model (original asset ref + selected aspect ratio + derived renditions); Cloudinary upload integration; aspect-ratio enforcement logic (1:1, 4:5, 9:16, 16:9, 21:9, 3:2, 2:3, Custom); responsive `<Image>`/`<Video>` components with lazy loading and object-fit (cover/contain) configuration; Media Library admin screen (search/filter/tag/reuse).
**Dependencies:** Phase 1, Phase 2.
**Risks:** Retrofitting aspect-ratio consistency after catalog/CMS phases are built is significantly more expensive than building it first — this phase is intentionally sequenced early.
**Acceptance Criteria:** Uploading an asset requires ratio selection; the same asset renders identically cropped on mobile/tablet/desktop; original file remains retrievable; lazy loading verified via network panel; Lighthouse CLS contribution from media is negligible.

## Phase 5 — Product Catalog Core (Data Model + Admin CRUD)
**Objective:** Implement the full Product System data model (name, slug, description, fabric details, wash care, SKU, barcode, HSN, GST, variants, collections, tags, SEO) and the admin CRUD screens to manage it.
**Deliverables:** Product, Variant (color×size), Collection, Tag, Category models; Product admin list/create/edit screens with media assignment (via Phase 4); SEO metadata fields per product (consumed by Phase 18); SKU/barcode/HSN/GST fields with prefix-aware SKU generation hook (ties to Phase 13 invoice numbering config).
**Dependencies:** Phase 1, 2, 4.
**Risks:** Variant modeling (color × size with independent stock/price) is a common source of downstream bugs if not normalized correctly before Inventory (Phase 11) and Cart (Phase 8) are built on top of it.
**Acceptance Criteria:** Admin can create a product with multiple color/size variants, each with its own SKU and stock placeholder; slug uniqueness enforced; required GST/HSN fields validated; product is retrievable via API in the shape the storefront will need.

## Phase 6 — Advanced Product Features (Badges, Recommendations)
**Objective:** Layer merchandising intelligence onto the catalog: badges (New Arrival/Best Seller/Trending/Limited Edition), Related/Recommended Products, Frequently Bought Together, Complete The Look.
**Deliverables:** Badge computation rules (auto + manual override) and admin controls; product-relationship fields (related/recommended/FBT/complete-the-look) with admin curation UI; storefront API endpoints serving these relationships.
**Dependencies:** Phase 5.
**Risks:** Auto-computed badges (e.g., "Best Seller") need a defined rule (sales velocity threshold) agreed with the business before implementation to avoid rework.
**Acceptance Criteria:** Admin can manually set/override any badge; auto-computed badges reflect defined rules on a test dataset; PDP API returns correctly curated related/FBT/complete-the-look sets.

## Phase 7 — Customer Website Foundation (Layout, Home, Navigation)
**Objective:** Build the storefront shell: global layout, header/navigation, footer, Home page consuming CMS data, and the design system (Tailwind/Shadcn tokens) applied site-wide.
**Deliverables:** Design tokens (colors, type scale, spacing, radii, shadows) implemented in Tailwind config and Shadcn theme; responsive header/nav/footer components; Home page sections (hero banner, featured collections, new arrivals, testimonials, newsletter signup) wired to CMS placeholders (full CMS admin arrives in Phase 19, so Phase 7 ships with static/seed content and an integration point); loading/empty/error state components used platform-wide.
**Dependencies:** Phase 1, 4.
**Risks:** Building Home before CMS (Phase 19) exists means content is hardcoded/seeded initially — must be designed so CMS integration in Phase 19 is a data-source swap, not a rebuild.
**Acceptance Criteria:** Home page is fully responsive (mobile/tablet/laptop/desktop/large screen) per the design system; Lighthouse performance/accessibility scores meet targets in [03-requirements.md](03-requirements.md) §8.1/8.5; shared loading/empty/error components used consistently.

## Phase 8 — Shop, Category, Collection & Product Detail Pages
**Objective:** Build the core browsing and discovery experience: Shop (PLP) with filter/sort/pagination, Category/Collection pages, and the full Product Detail Page.
**Deliverables:** Shop/Category/Collection pages with filter (size/color/price/fabric/collection/tag) and sort; PDP with variant selector, media gallery, size guide, highlights, fabric details, wash care, reviews section, related/FBT/complete-the-look sections (Phase 6 data); Recently Viewed tracking; Product Comparison feature; Reviews & Ratings submission + moderation hook (moderation UI in admin).
**Dependencies:** Phase 5, 6, 7, 4.
**Risks:** Filter/sort performance at catalog scale requires correct MongoDB indexing decided here — revisit Phase 2's indexing plan if filter combinations are broader than anticipated.
**Acceptance Criteria:** All filter/sort combinations return correct, paginated results; PDP renders all required product fields and merchandising sections; comparison and recently-viewed work for both guest and logged-in sessions; review submission enters a moderation queue.

## Phase 9 — Cart, Wishlist & Gift Features
**Objective:** Implement Cart (persisted, guest-merge-on-login), Wishlist, Gift Packaging, and the groundwork for Gift Card redemption at checkout.
**Deliverables:** Cart model/API (persisted per user, guest cart merge); Wishlist model/API with stock/price-change detection; Gift Packaging checkout add-on; Gift Card data model (issuance/balance — full marketing-side issuance flow in Phase 16) with redemption support in cart total calculation; Abandoned Cart event emission (consumed by Phase 16 marketing automation).
**Dependencies:** Phase 5, 3 (auth), 11 (stock validation needs Inventory — see note below).
**Risks:** Add-to-cart stock validation depends on Inventory's Reserved/Available stock concept (Phase 11); this phase ships with a basic stock check against Phase 5's placeholder stock field and must be revisited once Phase 11 lands (explicit integration task, not a gap).
**Acceptance Criteria:** Cart persists across devices for logged-in users and merges correctly from guest state on login; wishlist correctly flags stock/price changes; abandoned-cart event fires after the configured inactivity threshold in a test scenario.

## Phase 10 — Payments Integration (Razorpay, COD, Manual, UPI)
**Objective:** Implement all four payment methods, including the Manual Payment screenshot-upload-and-verification workflow.
**Deliverables:** Razorpay integration (order creation, payment capture, webhook handling with idempotency); COD flow; Manual Bank Transfer flow (screenshot upload via Phase 4 media pipeline, "Payment Verification Pending" order state, admin Approve/Reject UI with reason capture); direct UPI flow; Payment History model/API; partial/advance-payment support (needed by Pre-Order, Phase 12).
**Dependencies:** Phase 4 (upload), Phase 3 (auth), Phase 9 (cart→checkout context), Phase 2.
**Risks:** Razorpay webhook idempotency bugs cause double-charging or missed confirmations — requires deliberate idempotency-key design and test coverage; manual verification UX must be fast enough for daily operational volume (Priya persona, [02-goals-and-users.md](02-goals-and-users.md) §6.3).
**Acceptance Criteria:** All four payment methods complete an order in staging including Razorpay test-mode webhooks; manual payment approve/reject correctly transitions order status and is reflected in Payment History; partial/advance payment correctly tracks outstanding balance.

## Phase 11 — Checkout & Order Creation
**Objective:** Tie cart, payment, shipping, and discounts together into a complete checkout flow that creates an Order with the correct initial status.
**Deliverables:** Checkout page (address selection/entry, shipping method, payment method selection, order review); Order model (full status enum from [03-requirements.md](03-requirements.md) §7.6); order total calculation (items, GST, shipping, discounts, store credit/reward redemption, gift packaging); order creation API setting correct initial status per payment method (Pending Payment / Payment Verification Pending / COD Confirmed / Confirmed).
**Dependencies:** Phase 9, 10, 5.
**Risks:** Total calculation has many interacting inputs (coupon, store credit, reward points, gift card, shipping, GST) — sequencing/precedence rules must be explicitly defined to avoid disputed totals.
**Acceptance Criteria:** An order can be placed end-to-end via each payment method with a mathematically correct total breakdown; correct initial order status is set per payment method; stock is reserved (not yet deducted) on order creation.

## Phase 12 — Inventory Management
**Objective:** Implement multi-warehouse stock tracking (Available/Reserved/Damaged/Returned/Incoming), low-stock alerts, inventory logs, transfers, and adjustments — and retrofit Cart/Order stock checks to use it.
**Deliverables:** Warehouse model; Stock Ledger per SKU per warehouse across all five stock states; Inventory Log (immutable); Low Stock Alert engine; Stock Transfer (inter-warehouse, in-transit state); Stock Adjustment (reason-coded, role-restricted); integration of Reserved Stock into Cart (Phase 9) and Order (Phase 11) flows; Inventory Manager admin screens.
**Dependencies:** Phase 2, 5, 9, 11.
**Risks:** This phase changes stock-check behavior in two already-built phases (Cart, Order) — requires regression testing of those flows, not just new-feature testing.
**Acceptance Criteria:** Stock state transitions correctly across the full lifecycle (reserve on cart/order → deduct on confirm → restock on cancel/return → damaged/returned states reachable from returns flow); low-stock alert fires at threshold; inventory log shows a complete, accurate trail for a test SKU across multiple operations; multi-warehouse stock is independently trackable.

## Phase 13 — Order Lifecycle, Status Timeline & Shipment Tracking
**Objective:** Implement the full order status state machine, status timeline, admin order management screens, shipment tracking, and customer-facing Track Order page.
**Deliverables:** Order status transition engine enforcing valid transitions per [03-requirements.md](03-requirements.md) §7.6; Status Timeline (auditable, actor+timestamp+note); Admin Order Management screens (queue, filters, bulk actions, detail view); Shipment Tracking fields (carrier, tracking number) + Track Order customer page; Order cancellation flow (customer pre-dispatch, admin any-stage) with automatic stock release (ties to Phase 12).
**Dependencies:** Phase 11, 12.
**Risks:** Defining the complete valid-transition graph (which statuses can move to which) must be finalized with the business before building the state machine, or it will need rework as edge cases surface (e.g., can "Shipped" go directly to "Returned"?).
**Acceptance Criteria:** Invalid status transitions are rejected; every transition is recorded in the timeline; admin can bulk-update a filtered set of orders; customer Track Order page reflects live status/shipment info; cancellation correctly releases reserved/deducted stock.

## Phase 14 — Returns & Refunds
**Objective:** Implement customer-initiated returns (within policy window), admin return processing, and refund handling (to original payment method, store credit, or bank transfer).
**Deliverables:** Return request model/flow (customer-facing, policy-window-validated); admin Return processing screen (approve/reject, restock vs. damaged-stock routing); Refund model linking to original payment and/or store credit issuance; Return Invoice / Credit Note generation hook (ties to Phase 17 invoicing).
**Dependencies:** Phase 13, 12, 10.
**Risks:** Refund-to-original-method vs. store-credit policy must be defined per payment method (e.g., COD orders cannot refund "to original method") before building the UI, to avoid presenting impossible options to customers.
**Acceptance Criteria:** Customer can request a return within the policy window and not after; admin approval correctly routes stock (restock vs. damaged) per Phase 12; refund issuance correctly updates payment history/store credit and triggers Credit Note generation.

## Phase 15 — Pre-Order System & Production Tracker
**Objective:** Implement the full pre-order commerce flow (enable/dates/advance-or-full payment/limited quantity) and the customer-visible Production Tracker across the 9 production stages.
**Deliverables:** Pre-order configuration fields on Product/Variant (enable, start/end date, expected dispatch/delivery date, payment mode, quantity cap); pre-order-aware checkout (advance vs. full payment via Phase 10); pre-order quantity-cap enforcement and auto-close; Production Tracker model (9 stages) linked to pre-order line items; customer-facing tracker UI on Order detail; admin bulk production-stage update; stage-transition notifications (ties to Phase 21 notifications).
**Dependencies:** Phase 10, 11, 5, 18 (notification templates), 13.
**Risks:** This is one of the most differentiated and highest-risk modules (per [01-product-vision.md](01-product-vision.md)) — quantity-cap race conditions (two customers ordering the last pre-order slot simultaneously) must be handled with atomic stock-style locking, mirroring Phase 12's rigor.
**Acceptance Criteria:** A pre-order product correctly enforces date window and quantity cap (including concurrent-order race test); advance/full payment modes both produce correct order totals/outstanding balance; production stage updates cascade correctly to customer-visible tracker and trigger notifications; admin can batch-update stage across multiple pre-orders in one action.

## Phase 16 — Manufacturing Management
**Objective:** Implement vendor masters (Fabric/Tailor/Printing/Embroidery/Packaging), Fabric Inventory, Production Orders, and the Costing Engine — connecting production capacity/cost to the Pre-Order/Production Tracker (Phase 15).
**Deliverables:** Vendor master CRUD screens (5 vendor types); Fabric Inventory model (raw-material stock, distinct from finished-goods inventory in Phase 12); Production Order model linking demand (pre-orders/restock needs) to a vendor/tailor assignment and production stage; Costing Engine (fabric/labor/printing/packaging/courier cost inputs → computed margin against selling price) per style/production order; integration so Production Order stage updates drive the Phase 15 tracker.
**Dependencies:** Phase 15, 12, 5.
**Risks:** Costing Engine assumptions (cost-input granularity: per-style vs. per-batch) must be validated against how Karan (persona, [02-goals-and-users.md](02-goals-and-users.md) §6.4) actually plans production, or the margin numbers won't be trusted/used.
**Acceptance Criteria:** A production order can be created against a vendor, costed across all five cost categories, and its margin computed against selling price; fabric-stock-below-threshold alert fires for an open production order; production-order stage update is reflected in the linked pre-order's customer-facing tracker.

## Phase 17 — Invoicing System
**Objective:** Implement the full document-generation system (Tax Invoice, Proforma, Receipt, Credit Note, Debit Note, Delivery Challan, Return Invoice) with Puppeteer PDF rendering, configurable numbering, and an immutable document store.
**Deliverables:** Invoice/document data model (line items, GST/HSN breakdown, discounts, shipping, grand total); Puppeteer-based PDF template rendering company logo/info/GST details/customer/order/product/SKU/HSN/tax/discount/shipping/grand-total per [03-requirements.md](03-requirements.md) §7.9; configurable prefix/numbering settings (Invoice/Proforma/Order/SKU, financial-year-aware); document store (immutable, linked to order/return); resend-via-email action; auto-generation triggers (Tax Invoice on order confirmation, Credit/Debit Note on return/refund processing from Phase 14, Delivery Challan on dispatch).
**Dependencies:** Phase 13, 14, 11, 21 (email dispatch).
**Risks:** GST compliance correctness (HSN/tax-rate breakdown) must be reviewed against actual statutory invoice format requirements before launch — this is a legal/financial-correctness risk, not just a feature risk.
**Acceptance Criteria:** Every applicable order/return event auto-generates the correct document type with all required fields; numbering sequences are gapless and correctly prefixed per configuration; a finalized invoice cannot be edited (corrections only via Credit/Debit Note); resend delivers the original, unaltered PDF.

## Phase 18 — SEO Management & Structured Data
**Objective:** Implement Global/Page/Product/Category/Blog SEO settings, automatic sitemap generation, robots.txt management, canonical URL handling, and structured-data (schema) emission.
**Deliverables:** SEO metadata fields wired into Product (Phase 5), Category/Collection (Phase 5/8), and Blog (Phase 20) models and admin screens; Global SEO settings screen; Sitemap Generator (Product/Category/Blog/Image + index) regenerated on content change; robots.txt manager; canonical URL resolution for filtered/paginated catalog views (Phase 8); structured data emitters (Organization, Website, Product, Review, FAQ, Breadcrumb, Article) injected per page type.
**Dependencies:** Phase 5, 7, 8, 20.
**Risks:** Canonical URL logic for filter/sort/pagination combinations is a common SEO footgun (duplicate content) if not carefully scoped against Phase 8's filter implementation.
**Acceptance Criteria:** Sitemaps validate against the sitemap protocol and stay in sync after content changes; structured data validates via schema testing tools for each applicable page type; canonical tags correctly collapse filtered/paginated variants to the intended URL.

## Phase 19 — Admin CMS (Home Builder, Banners, Navigation, Content)
**Objective:** Build the no-code content management layer for Home Page Builder, Banner Management, Collection presentation, Testimonials, FAQs, Policies, Footer/Header, and Navigation Menus — replacing the seed content from Phase 7 with admin-managed data.
**Deliverables:** Home Page Builder (configurable sections, ordering); Banner Management (aspect-ratio governed via Phase 4, scheduled start/end); Collection presentation management; Testimonials, FAQs, Policies (Privacy/Terms/Shipping/Return) admin CRUD + storefront rendering; Footer/Header content + Navigation Menu management; integration replacing Phase 7's hardcoded Home sections with CMS-driven data.
**Dependencies:** Phase 7, 4, 18 (FAQ schema).
**Risks:** Section-ordering/builder flexibility must be bounded (a fixed set of configurable section *types*, not a fully arbitrary page builder) to keep scope and QA surface manageable.
**Acceptance Criteria:** Content Manager can fully reconfigure Home page sections, banners, navigation, and all policy/FAQ/testimonial content without a code deploy; storefront reflects changes immediately (or within defined cache-invalidation window); banner scheduling correctly shows/hides by date.

## Phase 20 — Blog System
**Objective:** Implement the blog authoring (rich text editor, categories, tags, authors, featured images) and public blog listing/detail pages with SEO/schema integration.
**Deliverables:** Blog Post model (rich content, category, tags, author, featured image via Phase 4); admin authoring screen with rich text editor; Blog listing + detail public pages; per-article SEO metadata, Article/FAQ/Breadcrumb schema (ties to Phase 18).
**Dependencies:** Phase 4, 18.
**Risks:** Rich text editor choice affects content portability and XSS risk (stored HTML must be sanitized on render) — sanitization must be explicit, not assumed.
**Acceptance Criteria:** Admin can author/publish a blog post with category/tags/author/featured image; public blog pages render correctly with working SEO metadata and validated schema; stored rich content is sanitized against injected scripts.

## Phase 21 — Notification System (Email, WhatsApp, Templates)
**Objective:** Implement transactional and marketing notification dispatch via SMTP/Brevo (email) and WhatsApp Business API, with an admin-editable template manager and per-event notification log.
**Deliverables:** Notification dispatch service (queue-based, decoupled from request cycle per [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §21.1); SMTP/Brevo integration; WhatsApp Business API integration (opt-in aware); Template Manager (admin-editable per event type/channel); Notification Log (per customer/order, delivery status); wiring of all transactional triggers (order confirmation, payment status, shipment, production-stage, password reset, OTP) defined across earlier phases.
**Dependencies:** Phase 3 (OTP/password reset triggers), 13 (order/shipment triggers), 15 (production-stage triggers), 17 (invoice email).
**Risks:** WhatsApp Business API has strict template-approval and opt-in requirements — approval lead time with the provider should be started early, in parallel with phase development, not after.
**Acceptance Criteria:** Every transactional trigger from dependent phases fires the correct templated message on the correct channel; notification log accurately reflects what was sent and its delivery status; templates are editable by admin without a code deploy; queue-based dispatch does not block the triggering request.

## Phase 22 — CRM Module
**Objective:** Build the unified Customer Profile, Timeline, Lifetime Value computation, and the auto-classifying Segment Engine (New/Repeat/VIP/Wholesale/Inactive).
**Deliverables:** Customer Profile screen (contact, addresses, consent, tags); Customer Timeline (orders, support notes, campaign touches, reviews — aggregated from Orders/Marketing/Reviews data); Lifetime Value computation; Segment Engine with configurable rules; Marketing Manager-facing custom segment builder (rule combinations).
**Dependencies:** Phase 13 (order data), 3 (customer accounts), 21 (campaign-touch data for timeline, partial dependency).
**Risks:** Segment rule definitions (what exactly makes someone "VIP" vs. "Repeat") need explicit business sign-off; building this without agreed thresholds risks segments nobody trusts for targeting.
**Acceptance Criteria:** Customer timeline correctly aggregates cross-module events chronologically; lifetime value matches manual calculation on test data; segment membership updates correctly as a test customer's order history changes; Marketing Manager can define and save a custom segment rule.

## Phase 23 — Marketing Automation & Coupons
**Objective:** Implement Newsletter, Email Campaigns, Coupon Engine, Festival Campaigns, Abandoned Cart Recovery, Win-Back Campaigns, Review Request automation, and Back-In-Stock notifications.
**Deliverables:** Newsletter subscription + management; Email Campaign builder (template + segment targeting via Phase 22 + scheduling); Coupon Engine (flat/percentage/free-shipping, min cart, max discount, single/multi-use limits) wired into Checkout (Phase 11) total calculation; Festival Campaign orchestration (banner+email+coupon bundle); Abandoned Cart Recovery automation (consuming Phase 9's abandoned-cart event); Win-Back automation (targeting Inactive segment from Phase 22); Review Request automation (post-delivery delay); Back-In-Stock notification dispatch (consuming Phase 12 restock events).
**Dependencies:** Phase 21, 22, 9, 12, 11.
**Risks:** Coupon-stacking rules (can a coupon combine with store credit/reward points/another coupon?) must be explicitly defined before implementation to avoid checkout total disputes.
**Acceptance Criteria:** A coupon of each discount type correctly applies/rejects per its rules in checkout; abandoned-cart, win-back, review-request, and back-in-stock automations correctly trigger on their respective conditions in a test scenario; festival campaign correctly bundles and schedules banner+email+coupon.

## Phase 24 — Loyalty, Referral, Store Credit & Gift Cards
**Objective:** Implement Reward Points (earn/redeem), Loyalty Program tiers, Referral Program, Store Credit ledger, and full Gift Card issuance/redemption.
**Deliverables:** Reward Points engine (earn rules on purchase/actions, redemption at checkout, expiry rules); Loyalty tier structure; Referral Program (code generation, attribution tracking, reward issuance on qualifying referred purchase); Store Credit ledger (issuance by admin or via Phase 14 returns, redemption at checkout); Gift Card engine (purchase, balance tracking, redemption at checkout — extends the Phase 9 placeholder).
**Dependencies:** Phase 9, 11 (checkout redemption), 22 (customer profile for points/tier display), 14 (store credit from returns).
**Risks:** Reward-point and store-credit redemption both modify checkout's total-calculation precedence (already non-trivial per Phase 11's risk note) — this phase must integrate with, not bypass, that established precedence logic.
**Acceptance Criteria:** Points earn/redeem correctly and reflect in customer account; referral attribution correctly credits the referrer on a qualifying purchase; store credit issued via return correctly reduces checkout total when redeemed; gift card purchase, balance check, and redemption all function end-to-end.

## Phase 25 — Wholesale/B2B Module
**Objective:** Implement Wholesale Customer accounts, tiered/negotiated pricing, bulk-ordering UI, and B2B-specific payment terms and invoicing.
**Deliverables:** Wholesale customer-type flag and onboarding/approval flow; tiered/negotiated pricing model layered on Phase 5's product pricing; bulk-order UI (per-style quantity grid by size) distinct from retail cart; B2B payment terms (advance+balance/credit terms) extending Phase 10; B2B invoice template variant extending Phase 17.
**Dependencies:** Phase 5, 10, 11, 17, 22 (Wholesale segment).
**Risks:** Must guarantee wholesale pricing is never exposed to retail sessions (data leakage/authorization risk) — requires explicit access-control testing, not just UI hiding.
**Acceptance Criteria:** A wholesale account sees only its negotiated pricing and bulk UI, never visible to retail sessions in any API response; bulk order correctly applies tiered pricing and B2B payment terms; B2B invoice renders with correct template/terms.

## Phase 26 — Static & Policy Content Pages
**Objective:** Deliver About Us, Contact Us (with working contact form), FAQs, Privacy Policy, Terms & Conditions, Shipping Policy, and Return Policy pages, fully CMS-managed.
**Deliverables:** About Us and Contact Us pages (contact form routed to Support via Phase 21 notification); FAQ page (Phase 19 FAQ data + Phase 18 FAQ schema); Privacy/Terms/Shipping/Return policy pages (Phase 19 Policies data).
**Dependencies:** Phase 19, 18, 21.
**Risks:** Low technical risk; primary risk is content/legal sign-off timing (policy text must come from legal/business, not be invented).
**Acceptance Criteria:** All listed pages are live, CMS-editable, responsive, and SEO-tagged; contact form submission correctly notifies Support Agent and confirms receipt to the customer.

## Phase 27 — Customer Account Dashboard Completion
**Objective:** Complete the My Account experience: profile, addresses, order history, invoices, reward/store-credit/gift-card balances, in one cohesive customer dashboard.
**Deliverables:** My Account overview screen aggregating profile, addresses, reward points/loyalty tier, store credit balance, gift card balances; Orders list/detail (Phase 13); Invoices list/download (Phase 17); address book management.
**Dependencies:** Phase 13, 17, 24, 3.
**Risks:** Primarily an integration phase pulling together prior phases' data — risk is inconsistent UX/data-shape across the aggregated sections if not reviewed holistically.
**Acceptance Criteria:** Customer can view/edit profile and addresses, view full order history with status, download any invoice, and see accurate real-time reward/credit/gift-card balances, all from one dashboard, fully responsive.

## Phase 28 — Analytics & Reporting Dashboard
**Objective:** Build the Admin analytics dashboard: Revenue, Orders, Customers, Conversion Rate, Top Products/Categories/Collections, Traffic Sources, Abandoned Cart Rate, Repeat Customer Rate, with CSV export.
**Deliverables:** Reporting data aggregation services (likely scheduled/materialized for performance at scale); Dashboard UI with date-range selection and KPI cards/charts; Top Products/Categories/Collections reports; Traffic Source attribution (requires UTM/referrer capture wired earlier in storefront, retrofit task if not already present); Abandoned Cart Rate and Repeat Customer Rate metrics (consuming Phase 9/22 data); CSV export.
**Dependencies:** Phase 13, 9, 22, 23.
**Risks:** Computing several KPIs live against production data at scale can be slow — likely needs scheduled aggregation/materialized views, a design decision to make explicitly rather than discover under load.
**Acceptance Criteria:** All listed KPIs match manual calculation on a test dataset within an agreed tolerance; dashboard remains responsive at representative data volume; CSV export produces correct, complete data for the selected range.

## Phase 29 — Security Hardening, Audit & Rate Limiting
**Objective:** Complete the security requirements not already delivered incidentally in earlier phases: comprehensive audit logging across all sensitive entities, rate limiting on auth/public-write endpoints, dependency scanning, and a security review pass.
**Deliverables:** Audit log coverage extended to every sensitive entity listed in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §20.3 (orders, payments, invoices, inventory adjustments, role/permission changes); rate limiting on login/OTP/password-reset/review-submission/contact-form/newsletter-signup; dependency vulnerability scan integrated into CI; backup/restore procedure tested; full security review pass against the OWASP-relevant areas of the platform.
**Dependencies:** All preceding functional phases (this is a cross-cutting hardening pass, sequenced near the end deliberately but informed throughout by [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §20, which is binding from Phase 1 onward).
**Risks:** Treating security purely as a late phase is itself a risk — mitigated by §20 requirements being enforced incrementally per-phase (e.g., RBAC in Phase 3, rate limiting groundwork in Phase 1); this phase is the audit/closure pass, not the only security work.
**Acceptance Criteria:** Every sensitive-entity mutation appears correctly in the audit log with before/after state; rate-limited endpoints correctly throttle abusive request patterns in a test; CI fails on a known-vulnerable dependency; a documented backup was successfully restored in a test environment.

## Phase 30 — Performance Optimization, QA, and Launch Readiness
**Objective:** Cross-cutting performance tuning, end-to-end QA across all modules, and final launch-readiness checks (mobile-readiness API contract review, deployment pipeline, monitoring).
**Deliverables:** Performance pass against [03-requirements.md](03-requirements.md) §8.1 targets (LCP, CLS, table responsiveness at scale); full regression test pass across every module in [05-modules.md](05-modules.md); deployment pipeline (staging/production) and rollback procedure; monitoring/alerting setup (errors, uptime, queue health); final review of the mobile-app-readiness criteria in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §22 against the as-built API.
**Dependencies:** All preceding phases.
**Risks:** Performance issues discovered only at this stage (e.g., catalog query patterns that didn't match Phase 2's indexing assumptions) may require targeted rework — budget contingency here rather than assuming zero findings.
**Acceptance Criteria:** Performance targets met under representative load; full regression suite passes; production deployment succeeds with a verified rollback path; monitoring/alerting confirmed functional via a deliberate test failure; mobile-readiness checklist fully satisfied by the as-built API.
