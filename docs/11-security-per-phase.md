# Security Per Phase — Addendum to 07-project-phases.md

Every phase carries explicit security work, not just feature work. For each phase: **Security Considerations** (what could go wrong), **Security Dependencies** (what from [10-security-architecture.md](10-security-architecture.md) must be in place), **Security Checklist** (concrete build items — also folded into [08-atomic-tasks.md](08-atomic-tasks.md) where not already present), and **Security Acceptance Criteria** (how it's verified).

---

### Phase 1 — Project Setup & Architecture Foundation
- **Considerations:** Foundation mistakes (missing security headers, no secrets strategy) propagate to every later phase.
- **Dependencies:** §11 Infrastructure Security.
- **Checklist:** Secrets via env/secrets-manager from day one; Helmet-equivalent security headers middleware; HTTPS-redirect/HSTS config; centralized error handler that never leaks stack traces in production; CI dependency-scan step stubbed in.
- **Acceptance Criteria:** A test request confirms required security headers present on every response; a forced error returns a generic message + correlation id, with full detail only in server logs.

### Phase 2 — Core Data Model & Shared Backend Infrastructure
- **Considerations:** Schema-level gaps here (no `select:false` on sensitive fields, no soft-delete pattern) get inherited by every model built later.
- **Dependencies:** §5 Database Security.
- **Checklist:** Shared validation middleware rejects unknown fields (anti mass-assignment); soft-delete base pattern (status + timestamp) defined for reuse; Audit Log write service is itself access-restricted.
- **Acceptance Criteria:** A request with extra/unexpected fields is rejected, not silently stored; audit log entries are unreadable/unmodifiable via any standard CRUD endpoint.

### Phase 3 — Authentication, Authorization & RBAC
- **Considerations:** Highest-risk phase in the platform — token theft, privilege escalation, account enumeration, brute force.
- **Dependencies:** §1 Authentication Security, §2 Authorization Security.
- **Checklist:** Argon2id/bcrypt password hashing; refresh-token rotation + reuse detection; account lockout after N failed attempts; rate limiting on login/OTP/reset; generic (non-enumerating) forgot-password response; **mandatory admin 2FA/TOTP** (added per [10-security-architecture.md](10-security-architecture.md) §1); RBAC deny-by-default middleware; permission-change double-logging.
- **Acceptance Criteria:** Reused/rotated refresh token is rejected and triggers session-family revocation; lockout triggers correctly under a brute-force simulation; admin login is blocked without a valid TOTP code; RBAC test matrix (already in Phase 3's functional acceptance criteria) is extended to include negative/IDOR-style tests, not just positive role checks.

### Phase 4 — Media & Aspect-Ratio Governance System
- **Considerations:** Unrestricted upload is a common entry point for malware/XSS-via-SVG/storage abuse.
- **Dependencies:** §9 File Upload Security.
- **Checklist:** Signed (backend-mediated) Cloudinary uploads only; magic-byte content validation, not extension/MIME trust; per-context MIME allow-list; max file size enforced server-side; malware/AV scan integration before persistence; payment-screenshot asset class served via signed/authenticated delivery URLs, never public-guessable.
- **Acceptance Criteria:** A renamed malicious file (e.g., script with `.jpg` extension) is rejected by content-signature check; an oversized file is rejected server-side even if a client bypasses UI limits; a payment screenshot URL is not accessible without authorization.

### Phase 5 — Product Catalog Core (Data Model + Admin CRUD)
- **Considerations:** Admin CRUD endpoints are a common IDOR/privilege-escalation surface (e.g., editing another brand's product once multi-brand exists).
- **Dependencies:** §2 Authorization Security, §3 Application Security.
- **Checklist:** Product mutation endpoints restricted to Content Manager/Admin/Super Admin roles; slug/SKU inputs validated against injection in any downstream query; product description/short-description fields routed through the sanitization pipeline if they ever support rich text.
- **Acceptance Criteria:** A non-catalog role cannot mutate products via direct API call even with a guessed product id.

### Phase 6 — Advanced Product Features (Badges, Recommendations)
- **Considerations:** Low direct risk; main concern is data leakage of internal merchandising logic (e.g., sales-velocity thresholds) to competitors via API responses.
- **Dependencies:** §3 Output Sanitization.
- **Checklist:** Auto-badge computation internals (thresholds, raw sales figures) never exposed in public API responses — only the resulting badge flag is public.
- **Acceptance Criteria:** Public PDP API response contains badge flags only, no underlying metric values.

### Phase 7 — Customer Website Foundation (Layout, Home, Navigation)
- **Considerations:** Client-side framework misconfiguration (exposed env vars, verbose client errors) is an easy unforced error at this stage.
- **Dependencies:** §3 Secure Error Handling, §11 Infrastructure Security.
- **Checklist:** Next.js public env vars audited to confirm no secret leaks into client bundle; CSP header allows only required third-party origins (Cloudinary, Razorpay, analytics).
- **Acceptance Criteria:** Browser bundle inspection confirms no secret keys present; CSP violations are zero on a clean page load against the configured policy.

### Phase 8 — Shop, Category, Collection & Product Detail Pages
- **Considerations:** Reviews are user-generated content — the platform's primary stored-XSS surface; filter/sort query params are a NoSQL-injection surface.
- **Dependencies:** §3 XSS Prevention, NoSQL Injection Prevention; §9 File Upload Security (review photos).
- **Checklist:** Review text sanitized server-side on submit; review photo upload goes through full Phase 4 pipeline; filter/sort query params validated against an allow-list of fields/operators before query construction; review submission rate-limited per §4.
- **Acceptance Criteria:** A review containing a script payload renders as inert text, not executed markup; a crafted filter query parameter cannot alter query semantics beyond the allowed filter fields.

### Phase 9 — Cart, Wishlist & Gift Features
- **Considerations:** Cart/price manipulation (client sending an arbitrary price/quantity) is a classic ecommerce exploit.
- **Dependencies:** §2 IDOR Prevention, §3 Input Validation.
- **Checklist:** Server always recomputes price/total from the authoritative Product/Variant record — never trusts client-supplied price; cart/wishlist mutation endpoints verify ownership of the cart/session being modified.
- **Acceptance Criteria:** A manipulated client request asserting a different price for a line item is ignored; server-computed price is used regardless of client payload.

### Phase 10 — Payments Integration (Razorpay, COD, Manual, UPI)
- **Considerations:** The single highest financial-risk phase — payment spoofing, webhook forgery, double-confirmation, manual-payment fraud.
- **Dependencies:** §6 Payment Security, §7 Manual Payment Security, §4 Webhook Verification.
- **Checklist:** Razorpay signature verification server-side before confirming any order; webhook signature validation with rejection+logging of invalid signatures; webhook idempotency keyed on provider event id; manual-payment screenshot upload through Phase 4's security pipeline; Approve/Reject restricted to Order Manager/Admin/Super Admin with state-machine guard against double-approval; COD high-value threshold flagged for manual review (Fraud module integration point, see [12-architect-review.md](12-architect-review.md)).
- **Acceptance Criteria:** A forged/invalid webhook signature is rejected and logged as a security event; replaying a valid webhook event does not double-confirm or double-credit an order; a customer cannot self-approve their own manual payment via any API path.

### Phase 11 — Checkout & Order Creation
- **Considerations:** Total-calculation tampering (coupon/store-credit/reward stacking abuse) and IDOR on order creation/lookup.
- **Dependencies:** §2 IDOR Prevention, §3 Input Validation.
- **Checklist:** Final order total always recomputed and re-validated server-side immediately before persistence, independent of any client-displayed total; order-lookup-by-id endpoints verify requester owns the order (or holds an appropriate admin role).
- **Acceptance Criteria:** Attempting to fetch another customer's order by guessing/incrementing an order id returns 403/404, not the order data.

### Phase 12 — Inventory Management
- **Considerations:** Race conditions on stock reservation are both a correctness *and* a security concern (overselling can be exploited deliberately by concurrent automated requests).
- **Dependencies:** §5 Database Security (atomic operations).
- **Checklist:** Stock reserve/deduct operations are atomic at the DB level (not read-modify-write in application code); stock adjustment endpoints restricted by role and require a reason code, logged to Inventory Log + Audit Log.
- **Acceptance Criteria:** The Phase 12 concurrency test (already in [08-atomic-tasks.md](08-atomic-tasks.md)) additionally confirms no overselling occurs under a scripted concurrent-request attack against the last unit of stock.

### Phase 13 — Order Lifecycle, Status Timeline & Shipment Tracking
- **Considerations:** Status-transition tampering (a customer or low-privilege role forcing an order to "Delivered"/"Refunded" directly).
- **Dependencies:** §2 RBAC + IDOR, state-machine enforcement.
- **Checklist:** Status transition service enforces both the valid-transition graph **and** the actor's role-permission for that specific transition (e.g., only Order Manager can move to Shipped; customer can only trigger Cancelled, and only pre-dispatch).
- **Acceptance Criteria:** A direct API call attempting an out-of-role transition (e.g., customer setting their own order to Refunded) is rejected and logged.

### Phase 14 — Returns & Refunds
- **Considerations:** Return/refund fraud (claiming a return outside policy window, double-refund).
- **Dependencies:** §6 Refund Protection.
- **Checklist:** Return-window validation enforced server-side against the order's actual delivery date, not client-supplied dates; refund issuance is idempotent (cannot be triggered twice for the same return id) and capped at the original payment amount.
- **Acceptance Criteria:** A second refund attempt against an already-refunded return is rejected; refund amount cannot exceed the original payment amount even via direct API manipulation.

### Phase 15 — Pre-Order System & Production Tracker
- **Considerations:** Quantity-cap race conditions (already flagged functionally) are also an abuse vector (scripted bulk-claiming of limited-edition stock).
- **Dependencies:** §5 Database Security (atomic operations), §4 API Abuse Protection.
- **Checklist:** Pre-order quantity decrement is atomic; per-customer per-SKU pre-order quantity limit enforced (prevents one account/script claiming the entire limited-edition cap); production-stage update restricted by role.
- **Acceptance Criteria:** Concurrency test (already planned) extended to confirm a single account cannot exceed its per-SKU limit even via parallel requests.

### Phase 16 — Manufacturing Management
- **Considerations:** Costing/margin data is commercially sensitive — exposure would leak pricing strategy to competitors or vendors.
- **Dependencies:** §2 Least Privilege, §3 Output Sanitization.
- **Checklist:** Costing Engine data restricted to Admin/Super Admin/Inventory Manager (per role design); vendor-facing views (future portal) never receive other vendors' costing/competitor data.
- **Acceptance Criteria:** A role without costing access (e.g., Support Agent) receives no cost/margin fields in any API response touching Production Orders.

### Phase 17 — Invoicing System
- **Considerations:** Invoice tampering/forgery and sequence-gap exploitation (both fraud and GST-compliance risks).
- **Dependencies:** §8 Invoice Security, §5 Sequential Invoice Management.
- **Checklist:** Atomic, DB-level numbering sequence (no read-then-increment race); finalized invoice PDFs stored immutably and hashed; template rendering escapes all dynamic data (template injection prevention); document access endpoints verify requester owns the invoice or holds an appropriate admin role.
- **Acceptance Criteria:** Concurrent invoice-generation test confirms no duplicate/skipped numbers; a customer cannot fetch another customer's invoice by id manipulation; a re-fetch of a given invoice returns byte-identical content to the originally generated PDF.

### Phase 18 — SEO Management & Structured Data
- **Considerations:** SEO fields and structured data are an injection surface into page `<head>`/JSON-LD if not escaped.
- **Dependencies:** §10 SEO & CMS Security.
- **Checklist:** All SEO meta and schema field values HTML/JSON-escaped at render time regardless of source field content.
- **Acceptance Criteria:** A product/category name or SEO field containing `</script>`-style payloads renders safely with no script execution and valid (non-broken) schema output.

### Phase 19 — Admin CMS (Home Builder, Banners, Navigation, Content)
- **Considerations:** CMS is, by design, admin-controlled raw-ish content — the main risk is privilege scope (Content Manager shouldn't be able to inject arbitrary script even though they're trusted staff) and stored-XSS via any rich-text section.
- **Dependencies:** §10 SEO & CMS Security.
- **Checklist:** No "custom HTML" block in v1 (per [10-security-architecture.md](10-security-architecture.md) §10 recommendation — if added later, Super-Admin-only + strict sanitizer); all CMS rich-text fields sanitized identically to blog content (Phase 20).
- **Acceptance Criteria:** A Content Manager test account cannot produce a live page containing executable script through any available CMS field.

### Phase 20 — Blog System
- **Considerations:** Primary stored-XSS surface alongside reviews, given the rich text editor.
- **Dependencies:** §3 XSS Prevention, §10 Rich Text Sanitization.
- **Checklist:** Server-side sanitization on every save (allow-listed tags/attributes); sanitization re-applied on render as defense-in-depth, not relied on once at write-time only.
- **Acceptance Criteria:** A blog post saved with a script/event-handler payload is stripped on save and renders safely on the public page.

### Phase 21 — Notification System (Email, WhatsApp, Templates)
- **Considerations:** Template injection (user-controlled data interpolated unescaped into an email/WhatsApp template) and notification-log PII exposure.
- **Dependencies:** §3 Secure Error Handling/Input Validation, §5 Sensitive Data Protection.
- **Checklist:** Template variables escaped/encoded per channel (HTML-escape for email body, plain-text-safe encoding for WhatsApp); Notification Log access restricted by role; WhatsApp opt-in state checked before every send (compliance + abuse prevention).
- **Acceptance Criteria:** A customer name/field containing markup does not break or inject into the rendered email; a non-opted-in customer never receives a WhatsApp message regardless of trigger.

### Phase 22 — CRM Module
- **Considerations:** Centralized customer profile/timeline is a high-value PII aggregation point — the most damaging single breach target in the system.
- **Dependencies:** §5 Sensitive Data Protection, §2 Least Privilege.
- **Checklist:** Customer Profile/Timeline screens scoped by role (Support Agent sees support-relevant fields, not full financial/cost history); bulk customer-data export (if/when built) restricted to Super Admin and itself audit-logged.
- **Acceptance Criteria:** Role-scoped field visibility verified per role in a test matrix; any export action is captured in the Audit Log with actor and scope of data exported.

### Phase 23 — Marketing Automation & Coupons
- **Considerations:** Coupon abuse (stacking, brute-forcing codes, exceeding usage limits via race conditions) is a direct revenue-loss vector.
- **Dependencies:** §3 Input Validation, §5 Database Security (atomic usage counting).
- **Checklist:** Coupon usage-count increment is atomic; per-customer usage limit enforced server-side at redemption time, not just at checkout-UI level; coupon code validation rate-limited (prevent brute-force guessing of valid codes).
- **Acceptance Criteria:** Concurrent redemption attempts against a single-use coupon result in exactly one successful redemption; rapid sequential code-guessing attempts are rate-limited.

### Phase 24 — Loyalty, Referral, Store Credit & Gift Cards
- **Considerations:** Direct-monetary-value features (points, store credit, gift cards) are high-value fraud targets — referral self-abuse, gift-card brute-forcing, points double-spend.
- **Dependencies:** §4 API Abuse Protection, §5 Database Security.
- **Checklist:** Gift card code space large enough to resist brute-force guessing, and lookup is rate-limited; referral attribution validates the referred account is not the same person/device as the referrer (self-referral prevention, best-effort heuristic); points/store-credit redemption is atomic (no double-spend via concurrent checkout attempts).
- **Acceptance Criteria:** Gift card balance-check endpoint is rate-limited and does not allow practical brute-force enumeration; concurrent redemption of the same points balance across two simultaneous checkouts results in only one successful spend.

### Phase 25 — Wholesale/B2B Module
- **Considerations:** Pricing-tier data leakage to retail sessions (already flagged functionally) is fundamentally a security/authorization issue, not just a UX one.
- **Dependencies:** §2 IDOR Prevention, Least Privilege.
- **Checklist:** Price-resolution service verifies the requesting session's wholesale-approved status server-side on every price-bearing response, never trusting a client-side "I am wholesale" flag.
- **Acceptance Criteria:** A retail session, even by directly calling a wholesale-pricing endpoint, never receives wholesale price data.

### Phase 26 — Static & Policy Content Pages
- **Considerations:** Lowest-risk phase; main concern is the contact form as a spam/injection vector.
- **Dependencies:** §4 Rate Limiting, §3 Input Validation.
- **Checklist:** Contact form rate-limited and validated; submitted content sanitized before storage/forwarding to Support.
- **Acceptance Criteria:** Scripted bulk contact-form submission is throttled; a payload-laden submission is stored/forwarded as inert text.

### Phase 27 — Customer Account Dashboard Completion
- **Considerations:** Aggregation point for a customer's own PII/financial view — must not leak into other customers' data via shared components.
- **Dependencies:** §2 IDOR Prevention.
- **Checklist:** Every aggregated section (orders, invoices, balances) independently re-verifies the session's own customer id server-side, not just relying on a single top-level auth check for the whole dashboard payload.
- **Acceptance Criteria:** No sub-resource on the dashboard is fetchable for another customer id even if a request to one endpoint is manually crafted with a different id.

### Phase 28 — Analytics & Reporting Dashboard
- **Considerations:** Aggregated reports can inadvertently expose granular customer/financial data if not properly aggregated/anonymized at the role boundary.
- **Dependencies:** §2 Least Privilege, §5 Sensitive Data Protection.
- **Checklist:** Report endpoints restricted by role (Marketing Manager sees campaign/segment performance, not raw per-customer financial detail beyond what's needed); CSV export actions are audit-logged.
- **Acceptance Criteria:** Export actions appear in Audit Log with actor, scope, and timestamp; role-restricted report sections are verified unavailable to out-of-scope roles.

### Phase 29 — Security Hardening, Audit & Rate Limiting (Closure/Verification Pass)
- **Considerations:** This phase is now a **verification and closure gate**, not the origin of security work (corrected per [10-security-architecture.md](10-security-architecture.md) governing principle).
- **Dependencies:** All of [10-security-architecture.md](10-security-architecture.md).
- **Checklist:** Full audit-log-coverage verification across every sensitive entity; rate-limit verification across every endpoint class in §4; dependency + container scanning in CI; backup/restore test; **third-party penetration test** (added recommendation); remediate findings.
- **Acceptance Criteria:** Penetration test findings are triaged and high/critical findings remediated before launch; every checklist item across all 29 preceding phases' Security Checklists is independently re-verified (a consolidated checklist run, not just a sample).

### Phase 30 — Performance Optimization, QA, and Launch Readiness
- **Considerations:** Performance work (caching, query optimization) must not inadvertently reintroduce authorization bypasses (e.g., a cache key that doesn't vary by user, leaking one user's cached response to another).
- **Dependencies:** §2 IDOR Prevention.
- **Checklist:** Any caching layer introduced during performance tuning is reviewed for per-user/per-role cache-key correctness; monitoring/alerting (Phase 30) explicitly includes the security-event alerting from [10-security-architecture.md](10-security-architecture.md) §11.
- **Acceptance Criteria:** A cache-correctness test confirms no cross-user data leakage introduced by performance optimizations; security-event alerts (e.g., simulated repeated auth failures) correctly notify the on-call channel.
