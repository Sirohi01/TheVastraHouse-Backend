# Security Architecture — Security-First Requirements

> **Governing principle:** Security is not Phase 29. Every phase in [07-project-phases.md](07-project-phases.md) carries security work from its first task (see [11-security-per-phase.md](11-security-per-phase.md) for the per-phase breakdown). This document is the canonical security requirement set that every phase, module, and code review is checked against. [09-estimation-and-priority.md](09-estimation-and-priority.md)'s old framing — "security hardening" as a single late phase — is **superseded**: that phase (now renumbered, see §Note below) is a *closure/audit* pass, not the only place security work happens.

> **Note on renumbering:** What was "Phase 29 — Security Hardening, Audit & Rate Limiting" is retained as a final audit/penetration-test/closure gate, but its scope is now narrower (verify, not originate). Security origination happens inside every phase per [11-security-per-phase.md](11-security-per-phase.md).

---

## 1. Authentication Security

| Concern | Requirement |
|---|---|
| JWT Best Practices | Short-lived access tokens (10–15 min); signed with RS256/ES256 (asymmetric) rather than HS256 where feasible, so verification keys are not the same as signing secrets; `aud`/`iss` claims validated; token payload carries no PII beyond user id + role; key rotation procedure documented. |
| Refresh Token Strategy | Long-lived (7–30 day), stored **hashed** server-side (never plaintext), rotated on every use (rotation-on-use), old token immediately invalidated; reuse of an already-rotated token triggers full session-family revocation (theft signal) and forces re-login + optional user alert email. |
| Session Management | Refresh tokens scoped per device/session record (device fingerprint, user-agent, IP at issuance); "active sessions" list and "log out of all devices" exposed to the customer in My Account and to admins for their own account. |
| Password Hashing | Argon2id (preferred) or bcrypt with a vetted work factor; unique salt per password (library-default); never log raw passwords; password field never selected by default in queries (`select: false` at schema level). |
| Account Lockout | Progressive lockout after N consecutive failed login attempts (e.g., 5) — temporary (15 min) escalating to longer lockout on repeated abuse; lockout state visible to Support Agent to manually clear after identity verification. |
| Brute Force Protection | Rate limiting on login/OTP/reset endpoints (see §4 API Security) **combined with** account lockout — rate limiting alone is insufficient against distributed attempts. |
| Secure Password Reset Flow | Reset token is single-use, expires in ≤30 min, invalidated immediately on use or on password change; reset does not reveal whether an email exists in the system (generic "if an account exists, an email was sent" response) to prevent account enumeration. |
| Email Verification | Required before first checkout (configurable: required before *any* purchase, optional for browsing); verification token single-use, expiring; resend is rate-limited. |
| **Admin-specific addition** | Admin accounts (all 7 roles) require **mandatory 2FA/TOTP** at login — not optional. This is a gap in the original requirements (only customer OTP was specified) and is added here because admin accounts hold the highest blast radius (financial data, customer PII, role management). See [12-architect-review.md](12-architect-review.md) §Missing Controls. |

## 2. Authorization Security

| Concern | Requirement |
|---|---|
| RBAC | Server-side enforcement only; client-side role checks are UX convenience, never the security boundary. Every route/controller declares its required role(s)/permission(s) declaratively (decorator/middleware), not via ad-hoc `if` checks scattered in handlers. |
| Permission-Based Access | Beyond role, fine-grained (module, action) permissions support per-user overrides (e.g., a specific Support Agent granted read access to Inventory) without inventing a new role per exception. |
| Route Protection | Every Express route passes through an auth-required + role/permission-check middleware chain by default (deny-by-default); public routes are an explicit allow-list, not an opt-out. |
| API Protection | Same enforcement applies to every API consumer (web, future mobile, internal scripts) — no "trusted internal network" bypass that would break when mobile/multi-brand consumers are added. |
| Admin Privilege Control | Role/permission changes themselves require Super Admin and are double-logged (Audit Log + a dedicated Privilege Change Log with old/new permission diff); a Super Admin cannot demote/delete the last remaining Super Admin account (prevents accidental lockout). |
| Principle of Least Privilege | Default new admin account starts with **zero** module access; access is explicitly granted, never inherited from a broad default role. |
| **IDOR Prevention (added)** | Every resource-fetch-by-id endpoint (order, invoice, address, return) must verify the requesting user owns or is authorized for that resource — object-level authorization checked on every request, not just route-level RBAC. This is the single most common real-world vulnerability class in ecommerce platforms and is called out explicitly because it is easy to omit when RBAC "passes." |

## 3. Application Security

| Concern | Requirement |
|---|---|
| XSS Prevention | All user-generated/rich content (reviews, blog body, CMS rich-text fields) sanitized server-side on write (allow-list HTML sanitizer, e.g., DOMPurify server-side equivalent) **and** output-encoded on render; React's default escaping is not sufficient alone for `dangerouslySetInnerHTML` paths (blog/CMS) — those paths get explicit sanitization. |
| CSRF Protection | Primary auth model is JWT-in-Authorization-header (not cookie-based), which is inherently CSRF-resistant for API calls; if any cookie-based session is introduced (e.g., for SSR convenience), CSRF tokens are mandatory on state-changing requests from that flow. |
| NoSQL Injection Prevention | All Mongoose queries built from validated/typed input only; never pass raw `req.body`/`req.query` objects directly into query operators; disable/avoid `$where`; use schema-level validation (Phase 2's shared validation middleware) before any DB call. |
| Command Injection Prevention | No shell/`exec` calls driven by user input anywhere in the stack (Puppeteer invocation, Cloudinary calls use SDKs, not shell); if a future feature requires shell invocation, input is allow-list validated, never interpolated into a command string. |
| File Upload Security | See dedicated §9 below. |
| Input Validation | Centralized schema-based validation (already scoped in Phase 2) applied to every mutating endpoint — type, length, format, and business-rule validation, rejecting unknown fields (no mass-assignment). |
| Output Sanitization | API responses never leak internal fields (password hash, refresh token hash, internal cost/margin data to non-authorized roles) — enforced via explicit response DTOs/serializers, not by trusting the schema's default `toJSON`. |
| Secure Error Handling | Production error responses never leak stack traces, internal file paths, or DB error text to the client; detailed errors go to the centralized logger (Phase 1) only; client receives a generic, correlation-id-tagged error message for support traceability. |

## 4. API Security

| Concern | Requirement |
|---|---|
| Rate Limiting | Tiered: strict limits on auth/OTP/password-reset (per §1), moderate limits on public-write endpoints (review, contact form, newsletter), generous but present limits on general authenticated API traffic (abuse/scraping protection) and on webhook receivers (replay-flood protection). |
| Request Validation | Every endpoint validates content-type, payload size limits (especially file upload endpoints), and schema shape before business logic executes. |
| API Versioning | All routes versioned from day one (`/api/v1/...`) even with a single version live — required precisely because [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) commits to a future mobile app consuming this API; breaking changes get a `v2` path, never an in-place breaking change to `v1`. |
| API Abuse Protection | Anomaly detection on request patterns (e.g., single account hitting price-sensitive endpoints — coupon validation, gift card balance check — at high frequency) flagged for review; CAPTCHA-class challenge hook reserved for repeated abuse triggers (extensible, not mandatory v1 UI). |
| Webhook Verification | Every inbound webhook (Razorpay payment events, future WhatsApp delivery receipts) verifies the provider's cryptographic signature before processing; unsigned/invalid-signature requests are rejected and logged as a security event, not silently dropped. |
| Secure Headers | `Helmet`-equivalent middleware enforcing `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, and a `Content-Security-Policy` tuned to allow only required origins (Cloudinary, Razorpay, Brevo) — applied globally in Phase 1, not retrofitted. |
| CORS Configuration | Explicit allow-list of origins (storefront domain, admin domain, future mobile app origin pattern) — never `*` with credentials; preflight responses scoped to required methods/headers only. |

## 5. Database Security

| Concern | Requirement |
|---|---|
| Sensitive Data Protection | PII (email, phone, address, payment screenshots) and financial data (invoice amounts, GST details) classified explicitly; access to raw customer PII in admin screens scoped by role (Support Agent sees what's needed for support, not full export capability). |
| Encryption Strategy | Encryption-in-transit (TLS) everywhere by default. Encryption-at-rest via the managed MongoDB provider's native at-rest encryption; additionally, **field-level encryption for highest-sensitivity fields** (bank transfer reference numbers if ever stored, any future stored payment identifiers) is recommended over relying on at-rest disk encryption alone — see [12-architect-review.md](12-architect-review.md). |
| Backup Strategy | Automated daily backups, encrypted, retained per a defined window (e.g., 30 days rolling + monthly long-term); restore procedure tested on a schedule (not just documented — see Phase 29's acceptance criteria), not only after an incident. |
| Audit Logs | Per [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §20.3, append-only, covering every sensitive entity mutation; audit log storage is itself access-restricted (Super Admin only) and excluded from standard data-retention deletion (kept for compliance/forensics per a defined retention policy, distinct from customer-data retention below). |
| Soft Deletes | Customer-facing entities (Product, Collection, Blog Post, Customer account on self-closure) use soft-delete (status flag + timestamp) by default, preserving referential integrity for historical orders/invoices that reference them; hard-delete is a separate, deliberate, audited operation reserved for compliance-driven erasure (§Compliance below). |
| Data Retention Policy | Explicit, documented retention windows per data class: transactional/financial records retained per statutory minimum (GST record-keeping requirements), marketing-consent data deleted/anonymized on opt-out + retention expiry, abandoned/guest cart data purged after a defined inactivity window. |

## 6. Payment Security

| Concern | Requirement |
|---|---|
| Razorpay Best Practices | Server-side order creation and payment verification only — client never directly trusted for "payment succeeded" state; Razorpay's signature-verification utility used to validate the `payment_id`/`order_id`/`signature` triple server-side before marking an order Confirmed. |
| Webhook Signature Validation | Mandatory (see §4); webhook secret stored via secrets management (§11), rotated per provider guidance; webhook endpoint is otherwise unauthenticated (per Razorpay's model) but signature-gated — must not be confused with an open endpoint. |
| Payment Verification | Order is marked Confirmed/paid **only** after server-side verification succeeds (signature + webhook/API confirmation), never on client-side redirect callback alone (client redirect is a UX signal, not a trust signal). |
| Fraud Prevention | Velocity checks (multiple failed payment attempts, multiple accounts/orders from same device/IP in a short window) flagged for review; high-value COD orders above a configurable threshold routed to manual confirmation call (operational control, not purely technical) — see [12-architect-review.md](12-architect-review.md)'s recommended Fraud & Risk module. |
| Refund Protection | Refund issuance requires Order Manager/Admin role + is double-checked against the original payment amount (cannot refund more than was paid); refund-to-original-method calls are idempotent (cannot be triggered twice for the same return); every refund is audit-logged with actor. |

## 7. Manual Payment Security

| Concern | Requirement |
|---|---|
| Screenshot Verification Workflow | Uploaded screenshot is immutable once submitted (customer cannot silently replace it after admin review starts); file goes through the full File Upload Security pipeline (§9) before being shown to an admin. |
| Approval Audit Trail | Every Approve/Reject action records actor, timestamp, and (on reject) mandatory reason; an order cannot be Approved twice or re-Rejected after Approval (state-machine-enforced, not just UI-enforced). |
| Payment Status Integrity | "Payment Verification Pending" → "Confirmed" transition is restricted to Order Manager/Admin/Super Admin roles only; a customer cannot self-transition their own order's payment status under any circumstance, including via direct API call (object-level authorization, §2). |

## 8. Invoice Security

| Concern | Requirement |
|---|---|
| Invoice Tampering Prevention | Finalized invoice documents (PDF) are generated once, hashed, and stored immutably; the stored PDF is the source of truth for any later dispute — re-rendering on demand must reproduce byte-identical output from the same underlying data, or the original stored PDF is served rather than regenerated. |
| Secure Invoice Generation | Puppeteer rendering runs in a sandboxed/isolated process with no access to unrelated request data; template injection (untrusted data interpolated into the HTML template) is prevented by escaping all dynamic fields before rendering. |
| Sequential Invoice Management | Numbering sequence generation is atomic (DB-level increment, not read-then-write in application code) to prevent gaps or duplicate numbers under concurrent invoice generation — this is also a GST compliance requirement, not just a technical one. |

## 9. File Upload Security

| Concern | Requirement |
|---|---|
| Image/Video Validation | Validate actual file content (magic-byte/signature check), not just file extension or client-provided MIME type, before accepting an upload. |
| MIME Type Validation | Allow-list of accepted MIME types per upload context (product media: images/video only; payment screenshot: images only; catalog PDF/lookbook: PDF only) — reject everything else. |
| File Size Restrictions | Per-context max file size enforced both client-side (UX) and server-side (security boundary — client-side limits are advisory only). |
| Malware Scanning Strategy | Uploaded files scanned (AV/malware scan integration, e.g., ClamAV or a cloud scanning API) before being persisted/served, particularly for customer-uploaded content (review photos, payment screenshots) where the upload source is least trusted. |
| Cloudinary Security Considerations | Uploads go through the backend (signed upload), never direct unsigned client-to-Cloudinary upload, so validation/scanning above happens before the asset reaches storage; Cloudinary access keys scoped to upload-only where possible, with delivery URLs using signed/authenticated delivery for any non-public asset class (e.g., payment screenshots are never publicly accessible by guessable URL). |

## 10. SEO & CMS Security

| Concern | Requirement |
|---|---|
| Rich Text Sanitization | All CMS/blog rich-text content sanitized server-side on save (allow-listed tags/attributes only — no `<script>`, no inline event handlers, no `javascript:` URLs). |
| Content Injection Prevention | SEO meta fields (title/description) and structured-data fields are escaped when emitted into `<head>`/JSON-LD — a malicious "product description" cannot inject script via meta tags or schema markup. |
| Script Injection Prevention | No admin-configurable field is ever rendered as raw, unescaped HTML on the storefront except through the explicitly sanitized rich-text pipeline above; banner/CMS "custom HTML" blocks, if ever added, are treated as a high-risk feature requiring Super-Admin-only access and a stricter sanitizer profile. |

## 11. Infrastructure Security

| Concern | Requirement |
|---|---|
| Environment Variables Management | Per-environment `.env` files never committed; local `.env.example` documents required keys without values; environment separation (dev/staging/prod) enforced at deploy config level. |
| Secrets Management | Production secrets (DB credentials, JWT signing keys, Razorpay keys, Cloudinary keys, SMTP/Brevo keys, WhatsApp API tokens) stored in a managed secrets store (cloud provider secrets manager / vault), injected at runtime, not baked into images or repo config. |
| HTTPS Enforcement | TLS enforced at the load balancer/CDN edge; HTTP requests redirected to HTTPS; HSTS header set (§4). |
| Security Headers | Centralized middleware (§4) applied identically across all environments, verified in CI (a smoke test asserting required headers are present). |
| Backup & Disaster Recovery | Documented RPO/RTO targets; backup restore tested on a recurring schedule (Phase 29 acceptance criteria, repeated post-launch on a calendar cadence, not a one-time check). |
| Monitoring & Alerting | Security-relevant events (repeated auth failures, webhook signature failures, rate-limit triggers, privilege changes) feed into the same monitoring/alerting pipeline as uptime/error monitoring (Phase 30), routed to an on-call/security-aware recipient. |

## 12. Compliance Considerations

| Concern | Requirement |
|---|---|
| GDPR Readiness | Even though the initial market is India (DPDP Act applies more directly than GDPR), the data model and consent flows are built GDPR-compatible from day one — this is cheap to do now and expensive to retrofit if/when international customers (per [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §21.5 international-shipping expansion) are onboarded. |
| Privacy Policy Requirements | Privacy Policy page (Phase 26) explicitly documents what data is collected, why, retention period, and third parties data is shared with (Razorpay, Cloudinary, Brevo, WhatsApp provider) — legal content, but the *system* must actually match what the policy claims. |
| Data Deletion Requests | **Missing from original requirements — added.** Customer-initiated account/data deletion request flow: customer requests erasure → system soft-deletes/anonymizes PII while preserving financial records required for statutory retention (order/invoice line items retained in anonymized form: "Customer #12345" instead of name) → completion confirmation sent. This requires a dedicated workflow, not just a database script run manually. |
| Customer Data Protection | Data minimization (don't collect/store fields not actually used); marketing consent stored as an explicit, timestamped, revocable flag (not inferred from "didn't unsubscribe"); data export ("download my data") self-service capability in My Account, paired with the deletion flow above. |

---

## Risks
- Treating any single layer (e.g., RBAC) as sufficient without the others (object-level/IDOR checks, audit logging) creates a false sense of security — defense must be layered, and reviews must explicitly test for IDOR, not just role coverage.
- Admin accounts are the highest-value target in this system (financial + PII + operational control); the original requirements specified OTP only for customers — admin-side 2FA was missing and is the single highest-leverage addition in this document.
- Manual payment and COD flows are the most fraud-exposed parts of an apparel D2C business; under-investing in velocity/anomaly checks here is the most likely real-world loss vector, more so than sophisticated technical attacks.

## Improvements
- Move from HS256 to RS256/ES256 JWT signing to decouple signing and verification keys, reducing blast radius if a verifying service is compromised.
- Adopt atomic DB-level sequence generation for invoice numbering rather than application-level read-then-increment, closing a concurrency/compliance gap simultaneously.
- Require signed (backend-mediated) Cloudinary uploads universally rather than allowing any direct unsigned client uploads, so the malware/MIME-validation pipeline cannot be bypassed.

## Recommendations
- Add mandatory TOTP-based 2FA for all admin roles before launch (not deferred) — see [12-architect-review.md](12-architect-review.md).
- Stand up a lightweight Fraud & Risk module (velocity checks, COD-value thresholds, device/IP heuristics) as part of the Payments phase rather than as an afterthought — see [12-architect-review.md](12-architect-review.md).
- Run a third-party penetration test before the first real-customer launch and before any major subsequent release that touches auth/payments/PII.

## Future Enhancements
- WAF (Web Application Firewall) in front of the API for managed protection against common attack patterns as traffic scales.
- Hardware-key (WebAuthn/FIDO2) support for admin login as a stronger alternative/complement to TOTP.
- Automated dependency + container image scanning gating every deploy (extending Phase 29's CI dependency scan to image-level scanning once containerized).
- Customer-facing security features: login-notification emails, "new device" alerts, and self-service active-session management (already designed for in §1, can be made more prominent post-launch).
