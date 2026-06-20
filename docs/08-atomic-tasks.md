# Atomic Task Breakdown (Phase 4 of the planning exercise)

Every phase from [07-project-phases.md](07-project-phases.md) is decomposed into atomic tasks — each small enough to be picked up and completed independently by one engineer. Tasks are numbered `P{phase}.T{task}` for traceability back to the phase's Objective/Acceptance Criteria.

---

## Phase 1 — Project Setup & Architecture Foundation
1. Initialize frontend repo: Next.js 15 + TypeScript project scaffold.
2. Initialize backend repo: Node.js + Express + TypeScript project scaffold.
3. Set up shared module folder structure (catalog, inventory, manufacturing, orders, payments, crm, marketing, seo, cms) in backend.
4. Configure Tailwind CSS + Shadcn UI in frontend.
5. Configure React Query provider and Zustand store scaffold in frontend.
6. Set up MongoDB connection module with retry/error handling.
7. Define environment variable strategy (.env.example, per-environment config loader).
8. Configure ESLint + Prettier for both repos.
9. Configure Git hooks (pre-commit lint/format).
10. Set up base CI pipeline: lint, type-check, build for both repos.
11. Implement centralized backend error-handling middleware.
12. Implement centralized backend request logger.
13. Implement a `/health` check endpoint.
14. Implement a sample end-to-end page (frontend) calling the health endpoint.
15. Write README with local setup instructions for both repos.

## Phase 2 — Core Data Model & Shared Backend Infrastructure
1. Design and implement Brand schema (name, slug, settings, active flag).
2. Design and implement Currency schema (code, symbol, decimal precision, active flag).
3. Design and implement Warehouse schema (name, address, brand reference, active flag).
4. Design and implement locale-flexible Address schema (country-agnostic fields).
5. Design Media reference sub-schema (used by other models; full Media model in Phase 4).
6. Implement shared pagination utility (limit/offset or cursor-based).
7. Implement shared filter/sort query-builder utility.
8. Implement shared request-body validation middleware (schema-based).
9. Implement Audit Log schema (actor, entity, action, before/after, timestamp).
10. Implement Audit Log write service (importable by any module).
11. Implement Activity Log schema and write service.
12. Write unit tests for pagination/filter utilities.
13. Write unit tests for audit log service against a sample entity.

## Phase 3 — Authentication, Authorization & RBAC
1. Design User schema (shared fields) with discriminator/type for customer vs. admin.
2. Implement password hashing utility (bcrypt/argon2).
3. Implement JWT access token issuance service.
4. Implement refresh token schema (hashed storage) and issuance service.
5. Implement refresh token rotation + reuse-detection logic.
6. Implement registration endpoint (customer).
7. Implement email verification token + verification endpoint.
8. Implement login endpoint.
9. Implement OTP schema and generation/validation service.
10. Implement OTP request endpoint (rate-limited).
11. Implement forgot-password endpoint (emailed reset link).
12. Implement reset-password endpoint (token validation + expiry).
13. Define Role schema and seed the 7 roles from [02-goals-and-users.md](02-goals-and-users.md) §5.
14. Define Permission schema (module + action grain).
15. Implement RBAC middleware (role/permission check on route).
16. Implement per-user permission override support.
17. Implement Admin Login History schema and write-on-login-attempt logic.
18. Build frontend Login page.
19. Build frontend Register page.
20. Build frontend Forgot Password page.
21. Build frontend OTP verification page/component.
22. Implement Zustand auth store (access token, user, role).
23. Implement React Query session/me hook with auto-refresh-token handling.
24. Implement protected-route wrapper (frontend) keyed by role/permission.
25. Write RBAC test matrix covering all 7 roles against representative endpoints.

## Phase 4 — Media & Aspect-Ratio Governance System
1. Design Media schema (original asset URL, selected aspect ratio, derived renditions, tags, type).
2. Integrate Cloudinary SDK in backend.
3. Implement upload endpoint accepting file + aspect-ratio selection.
4. Implement server-side validation of allowed aspect ratios (1:1, 4:5, 9:16, 16:9, 21:9, 3:2, 2:3, Custom).
5. Implement Cloudinary transformation logic to derive ratio-cropped renditions without discarding original.
6. Implement responsive `srcset`/sizes generation per rendition.
7. Build frontend `<ResponsiveImage>` component (lazy loading, object-fit cover/contain prop).
8. Build frontend `<ResponsiveVideo>` component (responsive, lazy-loaded).
9. Build Media Library admin screen: grid view, search, tag filter.
10. Implement Media tagging endpoint.
11. Implement Media deletion (soft-delete, reference-check before hard delete).
12. Implement reusable Media Picker component for use in other admin modules.
13. Write Lighthouse/CLS verification checklist for the responsive media components.

## Phase 5 — Product Catalog Core (Data Model + Admin CRUD)
1. Design Product schema (name, slug, description, short description, highlights, fabric details, wash care, brand ref).
2. Design Variant schema (color, size, SKU, barcode, price override, stock placeholder).
3. Design Collection schema and Tag schema.
4. Design Category schema.
5. Implement SKU prefix-aware generator utility.
6. Implement slug auto-generation + uniqueness validation.
7. Implement HSN code and GST rate fields with validation.
8. Implement Product create endpoint (with nested variants).
9. Implement Product update endpoint.
10. Implement Product list endpoint (paginated, filterable).
11. Implement Product detail (by slug) endpoint.
12. Implement Product delete (soft-delete) endpoint.
13. Build admin Product list screen (table + mobile card view, filters, search, pagination).
14. Build admin Product create/edit form (multi-step: details, variants, media, SEO).
15. Wire Media Picker (Phase 4) into product image/video assignment.
16. Implement Collection admin CRUD screen.
17. Implement Category admin CRUD screen.
18. Implement Tag admin CRUD (inline create from product form).
19. Write integration tests for product create-with-variants flow.

## Phase 6 — Advanced Product Features (Badges, Recommendations)
1. Design badge fields on Product (manual override flags: New Arrival, Best Seller, Trending, Limited Edition).
2. Define and implement auto-badge computation rule for New Arrival (date-based).
3. Define and implement auto-badge computation rule for Best Seller (sales-velocity-based, pending business threshold sign-off).
4. Define and implement auto-badge computation rule for Trending (recent-view/sales-based).
5. Implement scheduled job to recompute auto-badges.
6. Design Related Products field/relationship on Product.
7. Design Recommended Products field/relationship.
8. Design Frequently Bought Together field/relationship.
9. Design Complete The Look field/relationship.
10. Build admin curation UI for the four relationship types (product picker + ordering).
11. Implement PDP-facing API endpoint aggregating badges + all relationship sets for a product.
12. Write tests validating relationship data shape returned to storefront.

## Phase 7 — Customer Website Foundation (Layout, Home, Navigation)
1. Define design tokens (colors, type scale, spacing, radii, shadow levels) in Tailwind config.
2. Configure Shadcn theme to match the soft-luxury light design tokens.
3. Build responsive Header component (logo, nav, search trigger, cart/wishlist icons, mobile menu).
4. Build responsive Footer component.
5. Build mobile navigation drawer component.
6. Build Home page hero banner section (static/seed data).
7. Build Home page featured collections section.
8. Build Home page new arrivals section.
9. Build Home page testimonials section (seed data).
10. Build Home page newsletter signup section.
11. Build shared `<LoadingState>` component.
12. Build shared `<EmptyState>` component.
13. Build shared `<ErrorState>` component.
14. Verify Home page responsiveness across mobile/tablet/laptop/desktop/large-screen breakpoints.
15. Run Lighthouse audit on Home page and address findings against §8.1/8.5 targets.

## Phase 8 — Shop, Category, Collection & Product Detail Pages
1. Build Shop (PLP) page layout with grid/list toggle.
2. Implement filter sidebar (size, color, price range, fabric, collection, tag).
3. Implement sort control (price, newest, best-selling).
4. Wire filters/sort to Product list API with correct query params.
5. Implement pagination/infinite-scroll on Shop page.
6. Build Category page (reuses Shop components, scoped query).
7. Build Collection page (reuses Shop components, scoped query).
8. Build PDP layout: media gallery, variant selector, price, CTA.
9. Implement color/size variant selector logic (stock-aware disabling).
10. Build PDP size guide modal/section.
11. Build PDP highlights/fabric-details/wash-care accordion sections.
12. Build PDP related/recommended/FBT/complete-the-look sections (Phase 6 API).
13. Implement Recently Viewed tracking (guest session + logged-in persistence).
14. Build Recently Viewed display component.
15. Implement Product Comparison feature (selection + comparison table page).
16. Design and implement Review schema (rating, text, photos, verified-purchase flag, moderation status).
17. Implement review submission endpoint (rate-limited, auth-required).
18. Build PDP reviews display + submission form.
19. Build admin review moderation screen.
20. Add MongoDB indexes supporting the filter/sort query patterns identified above.

## Phase 9 — Cart, Wishlist & Gift Features
1. Design Cart schema (user ref or guest session id, line items, timestamps).
2. Implement add-to-cart endpoint (basic stock check against placeholder stock).
3. Implement update-quantity / remove-line-item endpoints.
4. Implement guest-cart-to-user-cart merge logic on login.
5. Build Cart page UI (line items, quantity controls, totals summary).
6. Design Wishlist schema.
7. Implement wishlist add/remove endpoints.
8. Implement wishlist stock/price-change detection job.
9. Build Wishlist page UI with stock/price-change indicators.
10. Implement Gift Packaging as a cart-level add-on flag + fee.
11. Design Gift Card schema (code, balance, currency, status) — issuance flow deferred to Phase 24.
12. Implement Gift Card redemption check in cart total calculation (read-only validation here).
13. Implement Abandoned Cart event emission (inactivity-threshold scheduled job).
14. Write integration test for guest-to-user cart merge.

## Phase 10 — Payments Integration (Razorpay, COD, Manual, UPI)
1. Integrate Razorpay SDK and configure API keys via env/secrets.
2. Implement Razorpay order-creation endpoint.
3. Implement Razorpay payment-capture confirmation endpoint.
4. Implement Razorpay webhook endpoint with signature verification.
5. Implement webhook idempotency handling (dedupe by event/payment id).
6. Implement COD payment-method flow (no gateway call, sets COD-specific status).
7. Implement direct UPI payment-method flow.
8. Implement Manual Bank Transfer flow: screenshot upload endpoint (uses Phase 4 media pipeline).
9. Implement "Payment Verification Pending" order status transition on manual payment submission.
10. Build admin Payment Verification queue screen.
11. Implement Approve Payment endpoint (status transition + audit log).
12. Implement Reject Payment endpoint (mandatory reason, status transition + audit log).
13. Design Payment History schema and write service.
14. Build customer-facing Payment History view (within order detail).
15. Implement partial/advance-payment capture and outstanding-balance tracking.
16. Write tests simulating Razorpay test-mode webhook events end-to-end.

## Phase 11 — Checkout & Order Creation
1. Design Order schema with full status enum.
2. Build Checkout page: address selection/entry step.
3. Build Checkout page: shipping method selection step.
4. Build Checkout page: payment method selection step.
5. Build Checkout page: order review/summary step.
6. Implement order total calculation service (items + GST).
7. Extend total calculation service: shipping charge logic.
8. Extend total calculation service: discount/coupon precedence (coupon module stub until Phase 23).
9. Extend total calculation service: store credit/reward redemption precedence (stub until Phase 24).
10. Extend total calculation service: gift packaging fee inclusion.
11. Implement order-creation endpoint mapping payment method → correct initial status.
12. Implement stock-reservation call on order creation (interim placeholder until Phase 12 integration).
13. Build order-confirmation page (post-checkout).
14. Write integration tests for order creation across all four payment methods.

## Phase 12 — Inventory Management
1. Design Stock Ledger schema (SKU, warehouse, available, reserved, damaged, returned, incoming).
2. Implement stock-read service (available-for-sale computation).
3. Implement stock-reserve operation (atomic, race-condition-safe).
4. Implement stock-deduct operation (on order confirmation).
5. Implement stock-release operation (on cancellation/expiry of reservation).
6. Implement Inventory Log schema and write-on-every-stock-event service.
7. Implement Low Stock Alert threshold config (per SKU/warehouse) and trigger job.
8. Build admin Low Stock Alerts screen.
9. Implement Stock Transfer schema/endpoint (source/destination warehouse, in-transit state).
10. Build admin Stock Transfer UI.
11. Implement Stock Adjustment endpoint (reason code, role-restricted).
12. Build admin Stock Adjustment UI.
13. Build admin Inventory dashboard (stock by warehouse, by SKU).
14. Retrofit Cart (Phase 9) add-to-cart check to use Reserved/Available stock.
15. Retrofit Order creation (Phase 11) to use real stock-reserve/deduct operations.
16. Write regression tests for Cart and Order flows post-integration.
17. Write concurrency test for simultaneous reservation of last-available-unit stock.

## Phase 13 — Order Lifecycle, Status Timeline & Shipment Tracking
1. Define valid order-status transition graph (sign-off artifact, then implement as config).
2. Implement order-status transition service enforcing the valid-transition graph.
3. Design Status Timeline schema (order ref, status, actor, timestamp, note).
4. Implement timeline write-on-every-transition logic.
5. Build admin Order Management list screen (filters, search, pagination, bulk actions).
6. Build admin Order detail screen (timeline, items, payment, actions).
7. Implement bulk order-status-update endpoint.
8. Add Shipment fields to Order schema (carrier, tracking number, dispatched-at).
9. Implement shipment-update endpoint.
10. Build customer-facing Track Order page (by order id/lookup).
11. Implement customer-initiated cancellation endpoint (pre-dispatch, policy check).
12. Implement admin-initiated cancellation endpoint (any stage).
13. Wire cancellation to Phase 12 stock-release operation.
14. Write tests covering invalid-transition rejection.

## Phase 14 — Returns & Refunds
1. Define return policy window rules (sign-off artifact, then implement as config).
2. Design Return Request schema (order/item ref, reason, status, requested-at).
3. Implement customer return-request endpoint (policy-window validated).
4. Build customer-facing return-request UI (within order detail).
5. Build admin Return processing screen (approve/reject).
6. Implement return-approval logic routing stock to restock vs. damaged (Phase 12 integration).
7. Design Refund schema (order/return ref, amount, method, status).
8. Implement refund-to-original-payment-method logic (where eligible per policy).
9. Implement refund-to-store-credit logic (stub interface until Phase 24 ledger exists).
10. Implement Return Invoice / Credit Note generation trigger (stub interface until Phase 17 exists).
11. Write tests covering refund-method eligibility rules per payment method.

## Phase 15 — Pre-Order System & Production Tracker
1. Add pre-order fields to Product/Variant schema (enable flag, start/end date, expected dispatch/delivery date, payment mode, quantity cap).
2. Build admin pre-order configuration UI on product form.
3. Implement pre-order availability-window enforcement (storefront query + checkout validation).
4. Implement pre-order quantity-cap enforcement with atomic/race-safe decrement.
5. Implement auto-close logic when cap reached or end-date passed (scheduled job).
6. Implement advance-payment checkout path (integrates Phase 10 partial-payment capture).
7. Implement full-payment checkout path for pre-orders.
8. Build storefront Pre-Order listing page.
9. Build PDP pre-order panel (dates, payment mode, remaining quantity indicator).
10. Design Production Tracker schema (order/item ref, current stage, stage history).
11. Implement the 9-stage transition service (Order Received → ... → Dispatch).
12. Build customer-facing Production Tracker UI (within order detail).
13. Build admin single-item production-stage update UI.
14. Build admin bulk production-stage update UI (batch selection).
15. Wire stage-transition events to notification triggers (stub interface until Phase 21 exists).
16. Write concurrency test for simultaneous orders against the last pre-order quantity slot.

## Phase 16 — Manufacturing Management
1. Design Fabric Vendor schema and admin CRUD screen.
2. Design Tailor schema and admin CRUD screen.
3. Design Printing Vendor schema and admin CRUD screen.
4. Design Embroidery Vendor schema and admin CRUD screen.
5. Design Packaging Vendor schema and admin CRUD screen.
6. Design Fabric Inventory schema (raw material, distinct from finished-goods stock).
7. Implement Fabric Inventory stock-level tracking and threshold alert.
8. Design Production Order schema (demand ref, vendor/tailor assignment, stage, cost fields).
9. Implement Production Order creation endpoint (linking pre-order/restock demand).
10. Build admin Production Order list/detail screens.
11. Implement Costing Engine: fabric cost input.
12. Implement Costing Engine: labor cost input.
13. Implement Costing Engine: printing cost input.
14. Implement Costing Engine: packaging cost input.
15. Implement Costing Engine: courier cost input.
16. Implement margin computation (cost inputs vs. selling price).
17. Build admin Costing view per Production Order/style.
18. Wire Production Order stage updates to the Phase 15 Production Tracker.
19. Write tests for margin computation against known cost/price fixtures.

## Phase 17 — Invoicing System
1. Design Invoice/Document schema (type enum, line items, tax breakdown, totals, immutability flag).
2. Implement numbering/prefix configuration schema (Invoice/Proforma/Order/SKU, financial-year-aware).
3. Implement gapless sequence-generation service per document type.
4. Build Puppeteer PDF rendering service (base template: logo, company info, GST details).
5. Extend PDF template: customer info, order info, line items with SKU/HSN.
6. Extend PDF template: tax breakdown, discounts, shipping, grand total.
7. Implement Tax Invoice auto-generation trigger (on order confirmation).
8. Implement Proforma Invoice generation (on-demand, pre-confirmation).
9. Implement Receipt generation (on payment capture).
10. Implement Credit Note generation (on return/refund approval — Phase 14 integration).
11. Implement Debit Note generation (on order correction scenarios).
12. Implement Delivery Challan generation (on dispatch — Phase 13 integration).
13. Implement Return Invoice generation (on return processing).
14. Implement immutable document store (write-once, linked to order/return).
15. Build admin document history/list screen.
16. Implement resend-via-email action (Phase 21 integration stub).
17. Write tests validating numbering sequence gaplessness under concurrent generation.

## Phase 18 — SEO Management & Structured Data
1. Add SEO metadata fields (title, description, OG image, canonical) to Product schema.
2. Add SEO metadata fields to Category/Collection schema.
3. Add SEO metadata fields to Blog Post schema (dependency: Phase 20 schema must exist or be stubbed).
4. Build Global SEO Settings admin screen (site-wide defaults, verification tags).
5. Build per-entity SEO fields UI within Product/Category/Blog admin forms.
6. Implement Sitemap Generator: Product sitemap.
7. Implement Sitemap Generator: Category sitemap.
8. Implement Sitemap Generator: Blog sitemap.
9. Implement Sitemap Generator: Image sitemap.
10. Implement sitemap index assembly and regeneration trigger on content change.
11. Implement robots.txt management (admin-editable, served correctly).
12. Implement canonical URL resolution logic for filtered/paginated Shop/Category pages.
13. Implement Organization schema markup.
14. Implement Website schema markup.
15. Implement Product schema markup (PDP).
16. Implement Review schema markup (PDP).
17. Implement FAQ schema markup (FAQ page).
18. Implement Breadcrumb schema markup (site-wide).
19. Implement Article schema markup (Blog detail).
20. Validate all schema output against structured-data testing tools.

## Phase 19 — Admin CMS (Home Builder, Banners, Navigation, Content)
1. Design Home Page Section schema (type, order, config payload).
2. Build Home Page Builder admin UI (add/reorder/configure sections).
3. Implement Home page frontend integration consuming Section data (replacing Phase 7 seed content).
4. Design Banner schema (media ref, link, schedule start/end, placement).
5. Build admin Banner Management CRUD screen.
6. Implement banner scheduling logic (show/hide by date) on storefront.
7. Build admin Collection presentation management screen (curated product ordering, banner).
8. Design Testimonial schema and admin CRUD screen.
9. Build storefront Testimonials display component.
10. Design FAQ schema and admin CRUD screen.
11. Build storefront FAQ page.
12. Design Policy (Privacy/Terms/Shipping/Return) schema and admin CRUD screen.
13. Build storefront Policy pages.
14. Design Footer content schema and admin CRUD screen.
15. Design Header/Navigation Menu schema and admin CRUD screen (nested menu support).
16. Build storefront Header/Footer integration consuming admin-managed nav data.
17. Implement cache-invalidation strategy for CMS content changes.

## Phase 20 — Blog System
1. Design Blog Post schema (title, slug, content, category, tags, author ref, featured image, status).
2. Design Blog Category schema.
3. Design Blog Author schema (or reuse admin User with author profile fields).
4. Integrate rich text editor in admin Blog authoring screen.
5. Implement content sanitization on save/render (XSS prevention).
6. Build admin Blog list/create/edit screens.
7. Implement Blog publish/draft/schedule workflow.
8. Build storefront Blog listing page (pagination, category/tag filter).
9. Build storefront Blog detail page.
10. Wire Blog SEO metadata fields (Phase 18 integration).
11. Wire Article/FAQ/Breadcrumb schema output on Blog detail (Phase 18 integration).

## Phase 21 — Notification System (Email, WhatsApp, Templates)
1. Set up background job queue infrastructure (for async dispatch).
2. Integrate SMTP/Brevo SDK for transactional email.
3. Integrate WhatsApp Business API client.
4. Design Notification Template schema (event type, channel, content, variables).
5. Build admin Template Manager screen.
6. Design Notification Log schema (customer/order ref, channel, status, timestamp).
7. Implement core dispatch service (template resolution + send + log).
8. Wire OTP/password-reset email triggers (Phase 3 integration).
9. Wire order-confirmation email/WhatsApp triggers (Phase 13 integration).
10. Wire payment-status email/WhatsApp triggers (Phase 10 integration).
11. Wire shipment-update email/WhatsApp triggers (Phase 13 integration).
12. Wire production-stage email/WhatsApp triggers (Phase 15 integration).
13. Wire invoice-email triggers (Phase 17 integration).
14. Implement WhatsApp opt-in preference capture and enforcement.
15. Build admin Notification Log viewer (per customer/order).
16. Submit WhatsApp message templates for provider approval (process task, track lead time).

## Phase 22 — CRM Module
1. Design Customer Profile extension schema (tags, consent flags, notes).
2. Build admin Customer Profile screen (contact, addresses, consent, tags).
3. Implement Customer Timeline aggregation service (orders, support notes, campaign touches, reviews).
4. Build admin Customer Timeline UI component.
5. Implement Lifetime Value computation service.
6. Define segment rules (sign-off artifact: New/Repeat/VIP/Wholesale/Inactive thresholds).
7. Implement Segment Engine (scheduled recomputation per customer).
8. Build admin Customer list screen with segment filter/search/pagination.
9. Implement custom segment rule builder (Marketing Manager facing).
10. Build admin custom segment management UI.
11. Write tests verifying segment transitions on test order-history fixtures.

## Phase 23 — Marketing Automation & Coupons
1. Design Coupon schema (type, value, min cart, max discount, usage limits, validity window).
2. Implement coupon validation service (rule evaluation against cart/order).
3. Wire coupon application into Checkout total calculation (Phase 11 integration, resolving stacking precedence).
4. Build admin Coupon create/edit/list screen.
5. Implement coupon usage tracking (single-use/multi-use enforcement).
6. Design Newsletter Subscriber schema and signup endpoint.
7. Build admin Newsletter subscriber list/export screen.
8. Design Email Campaign schema (template, segment target, schedule).
9. Build admin Campaign builder UI.
10. Implement Campaign send/schedule dispatch (Phase 21 integration).
11. Implement Festival Campaign bundling (banner + email + coupon association).
12. Implement Abandoned Cart Recovery automation rule + sequenced email job (consumes Phase 9 event).
13. Implement Win-Back Campaign automation (targets Inactive segment, Phase 22 integration).
14. Implement Review Request automation (post-delivery delay job).
15. Implement Back-In-Stock notification dispatch (consumes Phase 12 restock event, targets Notify-Me opt-ins).
16. Build admin Campaign performance view (sends, opens/clicks if available, attributed revenue).

## Phase 24 — Loyalty, Referral, Store Credit & Gift Cards
1. Design Reward Points ledger schema (earn/redeem transactions, balance).
2. Implement earn-on-purchase rule engine.
3. Implement redeem-at-checkout logic (Phase 11 total-calculation integration).
4. Implement points expiry job.
5. Design Loyalty Tier schema and tier-assignment logic (based on spend/points).
6. Build customer-facing points/tier display (My Account).
7. Build admin loyalty configuration screen (earn rates, tier thresholds).
8. Design Referral Code schema and generation logic per customer.
9. Implement referral attribution tracking (link click → signup → qualifying purchase).
10. Implement referral reward issuance on qualifying purchase.
11. Build customer-facing referral dashboard (code/link, status, rewards earned).
12. Design Store Credit ledger schema.
13. Implement store credit issuance (admin manual + Phase 14 return integration).
14. Implement store credit redemption at checkout (Phase 11 integration).
15. Design Gift Card schema completion (purchase flow, code generation, balance).
16. Implement Gift Card purchase flow (as a purchasable product/checkout item).
17. Implement Gift Card redemption at checkout (completing the Phase 9 stub).
18. Build admin Gift Card management screen (issue, view balance, deactivate).

## Phase 25 — Wholesale/B2B Module
1. Add wholesale customer-type flag to User schema and onboarding/approval workflow.
2. Build admin Wholesale account approval screen.
3. Design tiered/negotiated Price List schema layered on Product pricing.
4. Implement price-resolution service (retail vs. wholesale-tier price by customer).
5. Build admin Price List management screen (assign tiers to wholesale accounts).
6. Build Wholesale bulk-order UI (per-style quantity grid by size).
7. Implement bulk-order submission endpoint (creates Order with wholesale flag).
8. Implement B2B payment terms (advance+balance / credit terms) extending Phase 10.
9. Implement B2B invoice template variant extending Phase 17.
10. Write authorization tests confirming wholesale pricing/UI is inaccessible to retail sessions.

## Phase 26 — Static & Policy Content Pages
1. Build About Us page (CMS-driven content blocks, Phase 19 integration).
2. Build Contact Us page with contact form.
3. Implement contact-form submission endpoint routing to Support (Phase 21 integration).
4. Build FAQ page (Phase 19 data + Phase 18 schema integration).
5. Build Privacy Policy page (Phase 19 data).
6. Build Terms & Conditions page (Phase 19 data).
7. Build Shipping Policy page (Phase 19 data).
8. Build Return Policy page (Phase 19 data).
9. Verify all pages for responsiveness and SEO metadata presence.

## Phase 27 — Customer Account Dashboard Completion
1. Build My Account overview screen (profile summary, quick links).
2. Build Profile edit screen.
3. Build Address Book management screen (add/edit/delete/default address).
4. Integrate Orders list/detail into My Account navigation (Phase 13).
5. Integrate Invoices list/download into My Account navigation (Phase 17).
6. Integrate Reward Points/Loyalty Tier display (Phase 24).
7. Integrate Store Credit balance display (Phase 24).
8. Integrate Gift Card balance display (Phase 24).
9. Verify full My Account responsiveness across breakpoints.

## Phase 28 — Analytics & Reporting Dashboard
1. Design reporting aggregation schema/strategy (scheduled materialization vs. live query, decided per metric).
2. Implement Revenue/Orders KPI aggregation job.
3. Implement Customers KPI aggregation (new/repeat counts).
4. Implement Conversion Rate computation (requires funnel event capture — retrofit task if not already present).
5. Implement Top Products/Categories/Collections aggregation.
6. Implement Traffic Source attribution capture (UTM/referrer logging across storefront entry points).
7. Implement Abandoned Cart Rate computation (Phase 9 integration).
8. Implement Repeat Customer Rate computation (Phase 22 integration).
9. Build Admin Dashboard UI (KPI cards, charts, date-range selector).
10. Build Top Products/Categories/Collections report screens.
11. Implement CSV export for each report.
12. Load-test dashboard queries at representative data volume and optimize as needed.

## Phase 29 — Security Hardening, Audit & Rate Limiting
1. Audit every sensitive entity's write paths and confirm Audit Log coverage (orders, payments, invoices, inventory adjustments, role/permission changes).
2. Close any gaps found in Audit Log coverage.
3. Implement rate limiting middleware (configurable per-route).
4. Apply rate limiting to login, OTP request, password reset.
5. Apply rate limiting to review submission, contact form, newsletter signup.
6. Integrate dependency vulnerability scanning into CI.
7. Document and test database backup procedure.
8. Document and test database restore procedure.
9. Conduct a security review pass (auth, RBAC, input validation, file upload handling, payment webhook security) against [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §20.
10. Remediate findings from the security review pass.

## Phase 30 — Performance Optimization, QA, and Launch Readiness
1. Run performance audit against LCP/CLS targets on all primary storefront pages.
2. Optimize any pages/queries failing performance targets.
3. Run admin data-table performance test at 100k-row scale; optimize pagination/indexing as needed.
4. Execute full regression test pass across every module (use [05-modules.md](05-modules.md) as the checklist).
5. Set up staging and production deployment pipelines.
6. Document and test rollback procedure.
7. Set up error monitoring/alerting.
8. Set up uptime monitoring/alerting.
9. Set up job-queue health monitoring/alerting.
10. Review as-built API against the mobile-app-readiness checklist in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §22.
11. Remediate any mobile-readiness gaps found.
12. Conduct final go-live checklist review with stakeholders.
