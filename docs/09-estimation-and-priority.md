# Estimation, Priority & Critical Path (Phase 5 of the planning exercise)

## Methodology

- **Complexity**: Low / Medium / High / Very High — driven by number of integration points, concurrency/race-condition risk, and ambiguity needing business sign-off.
- **Effort**: expressed in engineer-weeks (1 engineer, full-time) for a phase's full atomic-task list in [08-atomic-tasks.md](08-atomic-tasks.md). Parallelizable phases can compress with more engineers; sequential dependencies cannot.
- **Priority**: P0 (blocks launch / foundational), P1 (required for launch, not foundational), P2 (high-value, can follow launch by a short window), P3 (post-launch acceptable).
- **Critical Path**: phases that, if delayed, directly delay every dependent phase's start. Non-critical-path phases have schedule slack relative to the longest dependency chain.

## Phase-by-Phase Estimation

| Phase | Complexity | Effort (eng-weeks) | Priority | On Critical Path? |
|---|---|---|---|---|
| 1. Project Setup & Architecture Foundation | Low | 1.5 | P0 | Yes |
| 2. Core Data Model & Shared Backend Infra | Medium | 2 | P0 | Yes |
| 3. Authentication, Authorization & RBAC | High | 3 | P0 | Yes |
| 4. Media & Aspect-Ratio Governance | Medium | 2 | P0 | Yes |
| 5. Product Catalog Core | Medium | 2.5 | P0 | Yes |
| 6. Advanced Product Features (Badges/Recs) | Medium | 1.5 | P1 | No |
| 7. Customer Website Foundation | Medium | 2 | P0 | Yes |
| 8. Shop/Category/Collection/PDP | High | 3.5 | P0 | Yes |
| 9. Cart, Wishlist & Gift Features | Medium | 2 | P0 | Yes |
| 10. Payments Integration | Very High | 3.5 | P0 | Yes |
| 11. Checkout & Order Creation | High | 2.5 | P0 | Yes |
| 12. Inventory Management | High | 3 | P0 | Yes |
| 13. Order Lifecycle, Timeline & Shipment | High | 2.5 | P0 | Yes |
| 14. Returns & Refunds | Medium | 2 | P1 | No |
| 15. Pre-Order System & Production Tracker | Very High | 3.5 | P0 | Yes |
| 16. Manufacturing Management | High | 3 | P1 | No |
| 17. Invoicing System | High | 2.5 | P0 | Yes |
| 18. SEO Management & Structured Data | Medium | 2 | P1 | No |
| 19. Admin CMS | Medium | 2.5 | P1 | No |
| 20. Blog System | Low | 1.5 | P2 | No |
| 21. Notification System | High | 2.5 | P0 | Yes |
| 22. CRM Module | Medium | 2 | P1 | No |
| 23. Marketing Automation & Coupons | High | 3 | P1 | No |
| 24. Loyalty, Referral, Store Credit, Gift Cards | High | 3 | P2 | No |
| 25. Wholesale/B2B Module | Medium | 2 | P2 | No |
| 26. Static & Policy Content Pages | Low | 0.75 | P1 | No |
| 27. Customer Account Dashboard Completion | Low | 1 | P1 | No |
| 28. Analytics & Reporting Dashboard | High | 2.5 | P1 | No |
| 29. Security Hardening, Audit & Rate Limiting | Medium | 2 | P0 | Yes |
| 30. Performance, QA & Launch Readiness | High | 2.5 | P0 | Yes |
| 31. Search & Discovery *(added, [12-architect-review.md](12-architect-review.md))* | High | 2.5 | P1 | No |
| 32. Fraud & Risk Management *(added)* | Medium | 2 | P1 | No |
| 33. Support & Helpdesk *(added)* | Medium | 1.5 | P2 | No |
| 34. Data Privacy & Compliance Center *(added)* | Medium | 1.5 | P1 | No |
| 35. Logistics & Courier Integration *(added)* | High | 3 | P1 | No |

**Total estimated effort (single engineer, sequential):** ~66 engineer-weeks for the original 30 phases, **~76.5 engineer-weeks including the 5 architect-review additions (31–35)**. With a team structured per §Sequencing below (parallel workstreams from Phase 5 onward), realistic wall-clock duration to a full-scope v1 launch is materially shorter — see §Suggested Team Shape.

> **Security note:** Per [10-security-architecture.md](10-security-architecture.md) and [11-security-per-phase.md](11-security-per-phase.md), security work is embedded inside every phase above (already reflected in each phase's effort estimate) rather than concentrated only in Phase 29 — Phase 29's effort/priority reflects its narrower role as a verification/closure gate (penetration test, consolidated checklist re-verification), not the sole place security is built.

## Critical Path

The critical path — the chain that determines the earliest possible launch date — runs:

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 7 → Phase 8
   → Phase 9 → Phase 10 → Phase 11 → Phase 12 → Phase 13 → Phase 15
   → Phase 17 → Phase 21 → Phase 29 → Phase 30
```

Rationale for inclusion:
- **Phases 1–4** are pure prerequisites with no parallel substitute (everything reads/writes through them).
- **Phase 5 → 7 → 8** is the catalog-to-storefront-browsing chain; nothing customer-facing ships without it.
- **Phase 9 → 10 → 11** is the commerce transaction chain (cart → payment → order); this is the revenue-critical path.
- **Phase 12** is on the critical path because Phase 11's stock-reservation is a placeholder until Phase 12 lands and is retrofit-tested against it — launch cannot ship with placeholder stock logic.
- **Phase 13** (order lifecycle/status) gates Phase 15 (pre-order depends on order status machinery) and Phase 17 (invoicing triggers off order/shipment events).
- **Phase 15** (Pre-Order) is on the critical path specifically because it is called out in the Product Vision as a core differentiator — the business has stated this is not deferrable, unlike e.g. Manufacturing (Phase 16) or Marketing Automation (Phase 23), which support it but can trail by a sprint.
- **Phase 17** (Invoicing) is critical because GST-compliant invoice generation is a legal/financial requirement for going live, not a nice-to-have.
- **Phase 21** (Notifications) is critical because order confirmation/payment/shipment communication is a baseline customer-trust requirement, and several earlier phases (10, 13, 15, 17) have stub integration points waiting on it.
- **Phase 29 → 30** (security hardening + launch QA) is the unavoidable closing gate.

### Phases explicitly off the critical path (parallelizable / can trail launch by design)
- **Phase 6** (badges/recommendations) — enhances but does not block PDP/checkout.
- **Phase 14** (returns/refunds) — needed for launch (P1) but can be built in parallel with Phase 12/13 by a second engineer, converging before Phase 30.
- **Phase 16** (Manufacturing) — supports Phase 15's production tracker with richer vendor/costing data, but Phase 15 can launch with manual stage updates before Manufacturing's vendor/costing layer is fully built.
- **Phase 18** (SEO) — can be developed in parallel against finished Phase 5/8/20 schemas; only needs to land before Phase 30's launch QA.
- **Phase 19** (CMS) — parallelizable once Phase 4 (media) and Phase 7 (Home shell) exist.
- **Phase 20** (Blog) — fully parallelizable; lowest interdependency of any phase.
- **Phase 22/23/24** (CRM, Marketing, Loyalty) — depend on Order/Customer data existing (Phase 13/22) but do not block the commerce critical path; sequence them after Phase 13 in a parallel stream.
- **Phase 25** (Wholesale) — explicitly scoped as a fast-follow; can ship in a post-v1 increment without delaying retail launch.
- **Phase 26/27** (static pages, account dashboard polish) — low complexity, schedule wherever capacity allows before Phase 30.
- **Phase 28** (Analytics dashboard) — needs data from many modules to be meaningful; naturally lands late but doesn't block transactional launch readiness.
- **Phase 31** (Search) — can launch v1 on Phase 8's DB filter/sort and swap in dedicated search shortly after launch; recommended as an early fast-follow (per [12-architect-review.md](12-architect-review.md) §Recommendations) given its conversion impact, but it is not a hard launch blocker.
- **Phase 32** (Fraud & Risk) — recommended to run in "log only" mode initially; can be enabled progressively post-launch rather than gating launch.
- **Phase 33** (Support/Helpdesk) — Support Agents can operate off CRM timeline notes (Phase 22) at low order volume; ticketing becomes valuable as volume grows, not before.
- **Phase 34** (Data Privacy Center) — legally prudent to have early, but a manual (admin-script-assisted) fulfillment process can bridge a short pre-launch-to-self-service gap if needed; should not be deferred long.
- **Phase 35** (Logistics/Courier) — Phase 13 ships with manual shipment-field entry; courier-API automation is an operational efficiency upgrade that can trail launch by a defined short window without blocking go-live.

## Suggested Team Shape & Parallelization

To compress the ~66 engineer-week sequential estimate, structure delivery as concurrent workstreams once Phase 4 completes:

1. **Core Commerce Stream** (critical path owner): Phases 5 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 15 → 17 → 21.
2. **Operations Stream** (starts after Phase 12/13 land): Phases 14, 16, 25.
3. **Content/Growth Stream** (starts after Phase 4/5): Phases 6, 18, 19, 20, 22, 23, 24, 26, 27, 28, 31, 33.
4. **Platform/Hardening Stream** (continuous from Phase 1, intensifies at Phase 29): security work embedded per-phase via [11-security-per-phase.md](11-security-per-phase.md), converging into Phase 29's verification/closure pass; Phase 32 (Fraud & Risk) is owned by this stream given its security/risk nature.
5. **Operations Stream (extended):** Phases 14, 16, 25, 34, 35 — fulfillment, returns, wholesale, compliance, and logistics automation, sequenced after their respective data-model dependencies land.

This shape implies a minimum viable team of ~3–4 engineers (one per stream) plus one QA/release-focused role joining from Phase 28 onward, to land the full v1 scope in a materially shorter wall-clock window than the single-engineer sequential estimate.

## Priority Summary (for scope-cutting conversations, if ever needed)

- **Never cut (P0):** Phases 1–5, 7–13, 15, 17, 21, 29, 30 — this is the minimum viable Vastra House: catalog, commerce, pre-order, invoicing, notifications, security, and launch QA.
- **Cut last, fast-follow candidates (P1):** Phases 6, 14, 16, 18, 19, 22, 23, 26, 27, 28, 31, 32, 34, 35 — meaningfully reduce launch value (or, for 31/32/34/35, operational maturity/legal posture) if cut, but the platform is operable without them for a short, defined post-launch window.
- **Genuine fast-follow (P2):** Phases 24, 25, 33 — loyalty/referral/gift-card depth, the wholesale channel, and dedicated helpdesk ticketing are explicitly designed to bolt on later without rework (per [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §23 and [12-architect-review.md](12-architect-review.md)).
- **Deferred by design (P3):** Anything in [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §23 Future Expansion Opportunities not already listed as a phase — mobile app, multi-brand activation, multi-currency activation, marketplace integration, vendor portal.
