# Architect Review — Gaps, Improvements & Added Scope

This document records where this blueprint goes **beyond** the original brief — acting as Principal Engineer / Enterprise Architect / Security Engineer, not just a transcriber of requirements. Every addition below is justified, not arbitrary, and is reflected in the cross-referenced docs.

## 1. Missing Modules & Features Identified

| Gap | Why it matters | Where it's added |
|---|---|---|
| **Search & Discovery Engine** | A "Shop" page with only DB filter/sort (Phase 8) degrades badly past a few thousand SKUs and can't support typo-tolerant search, autocomplete, or relevance ranking — table-stakes for a fashion catalog where customers search by loose terms ("red kurti"). Original spec never mentions search infrastructure at all. | New **Phase 31 — Search & Discovery** (§2). |
| **Fraud & Risk Module** | Manual payment + COD are the two highest fraud-exposure flows in Indian D2C fashion; the original spec treats payment purely as a happy-path integration problem. | New **Phase 32 — Fraud & Risk Management** (§2); also embedded in [10-security-architecture.md](10-security-architecture.md) §6. |
| **Customer Support / Helpdesk (Ticketing)** | A "Support Agent" role is defined, but no actual ticketing/case system exists — CRM's "Customer Timeline" (Phase 22) records history but doesn't give Support a queue, SLA, or resolution workflow. | New **Phase 33 — Support & Helpdesk** (§2). |
| **Data Privacy & Compliance Self-Service** | GDPR/DPDP-style data export and deletion requests were absent from the original spec entirely; required for any platform handling real customer PII at scale, and cheap to build now vs. retrofit later. | New **Phase 34 — Data Privacy & Compliance Center** (§2); requirements detailed in [10-security-architecture.md](10-security-architecture.md) §12. |
| **Shipping & Logistics / Courier Integration** | The original spec's "Shipment Tracking" is just status fields (Phase 13). Real fulfillment needs courier API integration (label generation, rate shopping, pickup scheduling, multi-carrier fallback) — without it, dispatch is manual data entry forever, which won't scale past a handful of orders/day. | New **Phase 35 — Logistics & Courier Integration** (§2). |
| **Admin Mandatory 2FA** | Original spec scoped OTP to customers only; admin accounts are higher blast-radius and were under-protected. | Folded into Phase 3, not a new phase — see [11-security-per-phase.md](11-security-per-phase.md). |
| **Tax/Duty Engine Abstraction** | GST logic is currently implicit inside checkout/invoicing. For the stated future goal of international shipping, tax/duty logic must be an isolated, swappable service from day one. | Architectural requirement folded into Phase 11/17; called out explicitly in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §21.5 (already present) — this review reinforces it as a **non-negotiable boundary**, not optional cleanliness. |
| **Notification Preference Center** | Original spec has a binary WhatsApp opt-in; customers should control granular categories (order updates vs. marketing vs. back-in-stock) to reduce opt-out/spam-complaint risk. | Added to Phase 27 (My Account) scope — see §3 below. |
| **Admin In-App Notification/Alert Center** | Low-stock alerts, payment-verification-pending queues, and production bottlenecks are currently email-only or buried in list screens; an in-admin alert center (bell icon, actionable) significantly improves the Priya/Karan personas' daily workflow ([02-goals-and-users.md](02-goals-and-users.md) §6.3, §6.4). | Added to Phase 11 (Admin Panel Modules — Dashboard) scope — see §3 below. |
| **Webhook Management/Observability Console** | Razorpay (and future WhatsApp/courier) webhooks are critical-path and currently invisible to admins when something fails silently. An admin-visible webhook event log (received, signature-verified, processed/failed) is needed for support and debugging. | Added to Phase 10 scope — see §3 below. |
| **Session/Device Management Self-Service** | Specified as a security requirement in [10-security-architecture.md](10-security-architecture.md) §1 but needs a customer-facing surface to be useful. | Added to Phase 27 (My Account) scope. |

## 2. New Phases Added

### Phase 31 — Search & Discovery
- **Objective:** Replace/augment DB-query catalog search with a dedicated search index (Elasticsearch/Algolia/Typesense-class) supporting typo-tolerant search, autocomplete, relevance ranking, and synonym handling (e.g., "kurti" ≈ "kurta").
- **Deliverables:** Search index sync pipeline (Product/Collection changes → index update); search API (autocomplete + full search) replacing Phase 8's basic filter for free-text queries; "no results" graceful fallback with suggested alternatives; admin-configurable synonyms/boosted terms (e.g., promote New Arrivals in ranking).
- **Dependencies:** Phase 5 (catalog data), Phase 8 (UI integration point).
- **Risks:** Index/DB drift if sync isn't transactional/near-real-time — must be designed with explicit reconciliation (scheduled full re-index) as a safety net, not sync-only.
- **Acceptance Criteria:** Typo'd/partial queries return relevant results; index stays in sync with catalog changes within a defined SLA (e.g., <30s); full re-index job completes successfully on demand.
- **Security:** Search query input validated/sanitized before reaching the index query layer (index-injection prevention, analogous to NoSQL injection); admin synonym/boost config restricted to Content Manager/Admin.

### Phase 32 — Fraud & Risk Management
- **Objective:** Add velocity-based and heuristic fraud signals across payment and pre-order/coupon/gift-card flows, surfaced to Order Manager/Admin for manual review rather than fully automated blocking (appropriate for this business's scale).
- **Deliverables:** Risk-scoring service (failed-payment velocity, multi-account-same-device signals, high-value-COD threshold flagging); admin "Flagged Orders" review queue; manual hold/release action on flagged orders, audit-logged.
- **Dependencies:** Phase 10 (Payments), Phase 23 (Coupons), Phase 24 (Gift Cards), Phase 3 (device/session metadata).
- **Risks:** Over-aggressive flagging creates customer friction/false positives — thresholds must be tunable and start conservative, validated against real order data before tightening.
- **Acceptance Criteria:** A simulated velocity-abuse pattern (e.g., rapid repeated failed payments) is correctly flagged; flagged orders are reviewable and actionable by Order Manager without blocking legitimate low-risk orders.

### Phase 33 — Support & Helpdesk
- **Objective:** Give Support Agents an actual ticketing workflow (beyond CRM timeline notes): create/assign/resolve customer support tickets linked to orders/customers, with SLA visibility.
- **Deliverables:** Ticket schema (customer/order ref, category, priority, status, assigned agent); ticket creation from Contact Us form (Phase 26) and from within Admin (agent-initiated); ticket list/detail admin screens with filters; SLA/age indicators; resolution notes feeding into Phase 22's Customer Timeline.
- **Dependencies:** Phase 22 (CRM), Phase 26 (Contact form), Phase 13 (order linkage).
- **Risks:** Scope creep toward a full helpdesk product (knowledge base, live chat) — explicitly bounded to ticket tracking + order/customer context for v1; live chat/knowledge base are Future Enhancements (§5), not in scope here.
- **Acceptance Criteria:** A contact-form submission creates a ticket visible in the Support queue; an agent can resolve a ticket and the resolution appears in the customer's CRM timeline.

### Phase 34 — Data Privacy & Compliance Center
- **Objective:** Deliver customer-initiated data export and account/data deletion requests, and the admin-side workflow to fulfill them within a defined SLA.
- **Deliverables:** Customer-facing "Download my data" and "Delete my account" requests in My Account (Phase 27 integration); admin queue for deletion requests requiring fulfillment (automated where safe, manual review where financial-record retention rules apply); anonymization logic preserving statutory financial records (per [10-security-architecture.md](10-security-architecture.md) §12) while removing/obscuring PII.
- **Dependencies:** Phase 27, Phase 17 (invoice retention rules), Phase 22 (customer profile).
- **Risks:** Incomplete anonymization (PII surviving in an overlooked collection — e.g., old marketing campaign send logs) is the most likely failure mode; requires an explicit, reviewed inventory of every collection holding customer PII.
- **Acceptance Criteria:** A data export request produces a complete, accurate export of the requesting customer's data; a deletion request anonymizes PII across every identified collection while preserving required financial records in anonymized form; both actions are audit-logged.

### Phase 35 — Logistics & Courier Integration
- **Objective:** Replace manual shipment data entry with real courier API integration: rate shopping, label generation, pickup scheduling, tracking webhook ingestion, and multi-carrier fallback.
- **Deliverables:** Courier API integration layer (abstracted behind a common interface so additional carriers/regions can be added — directly supports the international-shipping future-expansion goal); label generation triggered from Phase 13's "Ready to Dispatch" status; tracking webhook ingestion updating Phase 13's shipment fields automatically instead of manual admin entry; rate-shopping display at checkout (Phase 11) if multiple shipping options are offered.
- **Dependencies:** Phase 13, Phase 11, Phase 12 (warehouse-of-dispatch).
- **Risks:** Carrier API reliability/rate-limit variance — must design for graceful fallback to manual entry if a carrier API is degraded, not a hard dependency that blocks dispatch.
- **Acceptance Criteria:** A "Ready to Dispatch" order generates a courier label and tracking number via API without manual data entry; inbound tracking webhooks correctly update order status/timeline; a simulated carrier-API outage falls back to manual entry without blocking the dispatch workflow.

## 3. Scope Additions to Existing Phases (no new phase needed)

- **Phase 3:** Mandatory admin 2FA/TOTP (see [11-security-per-phase.md](11-security-per-phase.md)).
- **Phase 10:** Admin-visible webhook event log/observability console for Razorpay (and future provider) webhooks.
- **Phase 11 (Admin Dashboard):** In-app alert/notification center (low stock, payment-verification queue, production bottlenecks) surfaced in the admin UI itself, not email-only.
- **Phase 27 (My Account):** Notification Preference Center (granular category opt-in/out per channel) and Active Session/Device Management self-service.

## 4. Module Splits / Reorganizations Recommended

- **Pricing model pulled forward:** The tiered/negotiated pricing concept currently scoped to Phase 25 (Wholesale) should have its *data model* (a Price List/tier abstraction layered over a single base price) introduced back in **Phase 5** even though the Wholesale UI/workflow stays at Phase 25. Building Phase 5 with only a flat `price` field and retrofitting tiers later risks a migration touching every order/invoice line-item snapshot. This is a data-modeling decision, not a UI one — cheap now, expensive later.
- **Tax/Duty calculation isolated as its own service boundary**, called from both Checkout (Phase 11) and Invoicing (Phase 17), rather than GST logic being duplicated/embedded in both. This was implied by [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §21.5 but is now an explicit architectural rule: **no module computes tax independently.**
- **Coupon Engine and Loyalty/Store-Credit/Gift-Card Engine, though both "discounting" mechanisms, remain separate modules** (Phase 23 vs. 24) rather than merged — they have different fraud profiles (§Phase 32) and different ownership (Marketing Manager vs. broader CRM/finance), and merging them would blur the role-permission boundary unnecessarily.

## 5. Challenged Assumptions

| Original assumption (implicit in the brief) | Challenge | Resolution |
|---|---|---|
| Security is a late "hardening" phase. | This is the single biggest structural risk in the original plan — security debt compounds silently across 28 prior phases if deferred. | Restructured: security is embedded per-phase ([11-security-per-phase.md](11-security-per-phase.md)); the former Phase 29 is now a verification/closure gate, not the origin of security work. |
| Token/session strategy unspecified — could default to cookie sessions for simplicity. | Cookie-session auth is harder to make CSRF-safe and doesn't naturally extend to a future mobile app (stated future goal). | Standardized on JWT-in-header + rotating refresh tokens platform-wide, inherently CSRF-resistant and mobile-compatible from day one. |
| "Home Page Builder" implies a flexible, potentially arbitrary content builder. | An arbitrary builder (custom HTML/script blocks) is a major stored-XSS and admin-privilege-escalation surface, and also balloons QA surface indefinitely. | Bounded to a fixed set of configurable section *types* (already noted in [07-project-phases.md](07-project-phases.md) Phase 19 risk); explicitly **no raw HTML block** in v1 (see [10-security-architecture.md](10-security-architecture.md) §10). |
| Wholesale/B2B can be "added later" without affecting earlier phases. | True for the UI/workflow, false for the pricing data model — see §4 above. | Price-tier data model pulled forward to Phase 5; UI/workflow stays deferred to Phase 25. |
| Shipment Tracking = a status field admins update by hand. | Doesn't scale operationally past a small order volume, and the brief's own framing ("production-grade," "thousands of customers") implies it must. | Added Phase 35 for real courier integration; Phase 13 keeps the data model, Phase 35 adds the automation. |
| Catalog search = DB filter/sort. | Fine at small scale, actively harmful to conversion at the catalog size a serious fashion brand will reach. | Added Phase 31 dedicated search infrastructure. |

## 6. Workflow Completions

- **Return → Refund → Inventory loop:** originally these were each scoped (Phase 14, Phase 12) but the explicit *routing* decision (does a returned item go back to Available stock or to Damaged stock, and who decides) is now an explicit task in Phase 14's atomic breakdown rather than left implicit.
- **Pre-order → Production → Notification loop:** the chain from a production-stage update (Phase 16) to the customer-visible tracker (Phase 15) to the actual notification send (Phase 21) was previously three separately-scoped integration points; this review confirms all three are explicitly wired as dependencies in [07-project-phases.md](07-project-phases.md), closing what was originally an implicit gap.
- **Manual payment → Verification → Invoice loop:** Approve Payment (Phase 10) now explicitly triggers Tax Invoice generation (Phase 17) as a stated dependency, not an assumed side effect.

---

## Risks (platform-wide, beyond per-phase risks already listed)
- Five new phases (31–35) add real scope; underestimating them as "extras" rather than budgeting them properly would recreate the exact under-scoping problem this review exists to prevent. They are estimated and prioritized in [09-estimation-and-priority.md](09-estimation-and-priority.md).
- The biggest non-technical risk remains business sign-off latency on the rule-definition artifacts already flagged (segment thresholds, return policy window, coupon stacking, order-status transition graph, fraud-flagging thresholds) — these block multiple phases simultaneously if not resolved early.

## Improvements
- Treat [10-security-architecture.md](10-security-architecture.md) and [11-security-per-phase.md](11-security-per-phase.md) as living documents updated whenever a new phase/feature is added post-launch — security-per-phase should be a standing template for all future work, not a one-time exercise.
- Establish the Price-Tier and Tax/Duty-Service architectural rules (§4) as enforced code-review checklist items, not just documentation, so they don't erode under delivery pressure.

## Recommendations
- Prioritize Phase 31 (Search) and Phase 35 (Logistics) shortly after the core critical path (per updated [09-estimation-and-priority.md](09-estimation-and-priority.md)) — both directly affect conversion and operational scalability, respectively, more than several already-P1 phases.
- Run Phase 32 (Fraud & Risk) thresholds in "log only, don't block" mode for the first weeks post-launch before enabling any automatic holds, to calibrate against real customer behavior.

## Future Enhancements
- Live chat / knowledge base as an extension of Phase 33's helpdesk.
- Multi-language (i18n) content model, layered on top of the multi-currency readiness already designed for, ahead of actual international launch.
- ML-based personalization/recommendation engine, building on the explicit relationship data already seeded (Related/FBT/Complete-the-Look, Phase 6) and search behavior data (Phase 31).
- A/B testing / feature-flag infrastructure to de-risk rollout of future major changes (multi-brand activation, wholesale activation) without a hard cutover.
