# 20–23. Security, Scalability, Mobile Readiness, Future Expansion

## 20. Security Requirements

### 20.1 Authentication & Session
- JWT access tokens, short-lived (e.g., 15 min), signed with a rotating secret/key.
- Refresh tokens, long-lived, stored hashed server-side (revocation list), rotated on each use (refresh-token rotation to detect reuse/theft).
- Refresh tokens bound to device/session metadata; suspicious reuse triggers forced re-authentication.
- Passwords hashed with a strong adaptive algorithm (bcrypt/argon2); never logged or returned in any API response.
- OTP codes time-limited, single-use, rate-limited per phone/email.

### 20.2 Authorization
- Role-Based Access Control enforced server-side on every protected route — never trust client-side role checks alone.
- Permission model: role → set of (module, action) permissions; supports per-user permission overrides for edge cases without creating a new role.
- Resource-level checks where applicable (e.g., a Support Agent can view but not edit financial settings even if UI is hidden).

### 20.3 Auditability
- Audit Log: every create/update/delete on financially or operationally sensitive entities (orders, payments, invoices, inventory adjustments, role/permission changes) recorded with actor, timestamp, before/after state.
- Activity Log: broader admin activity stream (logins, exports, bulk actions) for operational visibility.
- Admin Login History: IP, device/user-agent, success/failure, retained for a defined retention window.
- Audit/activity logs are append-only and not editable/deletable via the application layer.

### 20.4 Rate Limiting & Abuse Prevention
- Rate limiting on authentication endpoints (login, OTP request, password reset) to prevent brute force/enumeration.
- Rate limiting on public-write endpoints (review submission, contact form, newsletter signup) to prevent spam/abuse.
- CAPTCHA or equivalent challenge on repeated failures (future-extensible hook, not necessarily v1).

### 20.5 Data Protection
- All traffic over HTTPS/TLS; HSTS enabled.
- Sensitive config (DB credentials, JWT secrets, payment keys, API keys) via environment variables/secret manager, never committed to source.
- Payment card data never touches Vastra House servers — Razorpay handles card capture/tokenization (PCI scope minimized).
- File uploads (payment screenshots, review photos, product media) validated for type/size and scanned/sanitized before storage; served from Cloudinary, not application servers.
- Input validation and output encoding at every API boundary to prevent injection (NoSQL injection, XSS via stored content like reviews/blog).

### 20.6 Infrastructure Security
- Principle of least privilege for service-to-service credentials (DB user scoped to required operations only).
- Dependency vulnerability scanning as part of CI.
- Regular backups of MongoDB with tested restore procedure; backups encrypted at rest.

## 21. Scalability Requirements

### 21.1 Application Tier
- Stateless Express API processes — horizontally scalable behind a load balancer; no in-memory session/cart state that would break with multiple instances.
- Heavy/slow operations (PDF generation, email/WhatsApp dispatch, sitemap regeneration, image transformation triggers, campaign sends) offloaded to a background job queue rather than blocking request threads.

### 21.2 Data Tier
- MongoDB schema designed with multi-warehouse, multi-brand, and multi-currency as additive fields/references from day one (even though only one brand/currency/warehouse set ships at launch), avoiding a future migration that touches every collection.
- Indexes planned around actual query patterns (catalog filtering, order lookup by customer/status, inventory lookup by SKU+warehouse) to keep query latency flat as data grows.
- Read-heavy storefront queries (catalog browse) architected to tolerate caching/CDN-layer insertion later without API contract changes.

### 21.3 Multi-Brand Readiness
- Every brand-owned entity (Product, Collection, Order, Invoice numbering sequence, CMS content, SEO settings) carries a brand reference from v1, even with a single brand seeded — so a second brand is a new brand record + scoped content, not a schema change.
- Admin RBAC designed so brand-scoping can be added to roles (a user limited to Brand B) without redesigning the permission model.

### 21.4 Wholesale/B2B Readiness
- Pricing model supports a price-list/tier concept beyond a single retail price per SKU, so B2B tiered pricing is additive.
- Order model supports a customer-type flag (retail/wholesale) influencing payment terms and invoice template without forking the order pipeline.

### 21.5 International Shipping & Multi-Currency Readiness
- Address model supports international address formats (not India-only fields hardcoded).
- All monetary values stored with an explicit currency reference (even if always "INR" at launch) and formatted through a centralized currency/locale layer, so adding a second currency is configuration, not a data migration.
- Tax/duty calculation isolated behind a service boundary (currently GST-only logic) so VAT/customs logic can be added per-region later without rewriting checkout.

### 21.6 Traffic & Load
- CDN-fronted static/media assets (Cloudinary + Next.js asset optimization) to absorb traffic spikes (festival sales) without backend load.
- Database connection pooling and query timeouts configured to fail gracefully under load rather than cascading failures.

## 22. Mobile App Readiness Requirements

- All customer-facing functionality exposed through a versioned, documented REST API consumed identically by the Next.js web app and any future mobile app — no logic embedded only in web frontend components.
- Authentication (JWT + refresh token) designed to work over a mobile client (token storage in secure device storage, not cookie-only assumptions) — i.e., avoid web-only session mechanisms for core auth.
- Push-notification-ready event model: order/payment/production-stage/shipment events already exist as discrete, loggable events (for email/WhatsApp today), making device push a future additive channel rather than a new event system.
- Media delivery via Cloudinary already responsive/format-negotiated, suitable for mobile bandwidth/screen constraints without separate mobile-specific media pipeline.
- API responses paginated and filterable in a way that suits mobile infinite-scroll patterns, not just desktop table/grid assumptions.

## 23. Future Expansion Opportunities

| Opportunity | Architectural hook already in place |
|---|---|
| Native Mobile App (iOS/Android) | Versioned REST API + mobile-ready auth (§22). |
| Multi-Brand Operation | Brand-scoped entities across catalog, CMS, invoicing, RBAC (§21.3). |
| Wholesale/B2B Channel | Customer-type flag, tiered pricing model, bulk-order UI hooks (§21.4, [05-modules.md](05-modules.md) §15). |
| International Shipping | Locale-flexible address model, region-isolated tax/duty service (§21.5). |
| Multi-Currency Pricing | Currency-tagged monetary fields + centralized formatting layer (§21.5). |
| Marketplace Channel Integration (Amazon/Myntra/Flipkart) | Inventory module's warehouse/stock abstraction can extend to a "channel" concept reserving stock per sales channel. |
| Vendor Self-Service Portal | Manufacturing module's vendor master records are structured to later support vendor login/portal access without remodeling. |
| Subscription/Membership Commerce | Loyalty/reward infrastructure provides the points/tier substrate a subscription perk system could reuse. |
| Advanced Personalization/Recommendation Engine | Recently Viewed, FBT, and Complete-the-Look are seeded as explicit relationships, providing training data for a future ML-based recommender. |
| Multi-Warehouse Smart Fulfillment Routing | Multi-warehouse stock model (§21.2) is the prerequisite for future order-to-nearest-warehouse routing logic. |
