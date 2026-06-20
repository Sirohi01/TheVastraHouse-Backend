# The Vastra House — Master Project Blueprint

This `docs/` folder is the single source of truth for product, architecture, and delivery planning for **The Vastra House** — a Fashion Commerce Operating System (not a simple storefront). No code, API contracts, or DB schemas are defined here; this is the documentation/planning layer that precedes implementation.

## Document Map

### Phase 1 — Documentation & Planning
| # | Document | Contents |
|---|----------|----------|
| 1 | [01-product-vision.md](01-product-vision.md) | Product Vision Document |
| 2 | [02-goals-and-users.md](02-goals-and-users.md) | Product Goals, Business Goals, User Types, User Roles, User Personas |
| 3 | [03-requirements.md](03-requirements.md) | Functional Requirements, Non-Functional Requirements |
| 4 | [04-feature-list.md](04-feature-list.md) | Complete Feature List (master catalog) |
| 5 | [05-modules.md](05-modules.md) | Website, Admin, CRM, Inventory, Manufacturing, Marketing, SEO, Reporting, Notification, Invoice Modules |
| 6 | [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) | Security, Scalability, Mobile App Readiness, Future Expansion |

### Phase 2 & 3 — Project Phases + Per-Phase Detail
| # | Document | Contents |
|---|----------|----------|
| 7 | [07-project-phases.md](07-project-phases.md) | 30 delivery phases, each with Objective / Deliverables / Dependencies / Risks / Acceptance Criteria |

### Phase 4 — Atomic Task Breakdown
| # | Document | Contents |
|---|----------|----------|
| 8 | [08-atomic-tasks.md](08-atomic-tasks.md) | Every phase decomposed into atomic, independently completable tasks |

### Phase 5 — Estimation & Sequencing
| # | Document | Contents |
|---|----------|----------|
| 9 | [09-estimation-and-priority.md](09-estimation-and-priority.md) | Complexity, effort, priority, and critical path per phase (incl. Phases 31–35) |

### Security-First Architecture & Architect Review
| # | Document | Contents |
|---|----------|----------|
| 10 | [10-security-architecture.md](10-security-architecture.md) | Dedicated security requirement set: auth, authorization, application, API, database, payment, manual-payment, invoice, admin, file-upload, SEO/CMS, infrastructure security, and compliance |
| 11 | [11-security-per-phase.md](11-security-per-phase.md) | Security Considerations / Dependencies / Checklist / Acceptance Criteria for every phase (1–30) |
| 12 | [12-architect-review.md](12-architect-review.md) | Principal-Engineer review: missing modules added (Search, Fraud & Risk, Support/Helpdesk, Data Privacy Center, Logistics — Phases 31–35), challenged assumptions, module-split recommendations |

> **Governing rule:** Security is not a separate late phase. [10-security-architecture.md](10-security-architecture.md) and [11-security-per-phase.md](11-security-per-phase.md) apply from Phase 1 onward — the former "Security Hardening" phase (now Phase 29) is a verification/closure gate, not the origin of security work.

## How to use this blueprint
- Read top-to-bottom once before development starts — each doc builds on the previous one's vocabulary (roles, modules, feature names stay consistent across all files).
- During sprint planning, pull tasks directly from [08-atomic-tasks.md](08-atomic-tasks.md) — tasks are already atomic and ordered within their phase.
- When scoping a new phase's sprint, cross-reference [07-project-phases.md](07-project-phases.md) (acceptance criteria) and [09-estimation-and-priority.md](09-estimation-and-priority.md) (priority/critical path) to decide what to pull forward.
- Architecture decisions (multi-brand, multi-currency, international shipping, mobile app, wholesale) are seeded throughout as **extension points** — see [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §Scalability and §Future Expansion before making any core design choice that could foreclose them.

## Phase Sign-off Artifacts

| # | Document | Contents |
|---|----------|----------|
| 13 | [13-order-lifecycle-transition-graph.md](13-order-lifecycle-transition-graph.md) | Phase 13 sign-off artifact for the approved order-status transition graph and actor rules |
| 14 | [14-return-refund-policy.md](14-return-refund-policy.md) | Phase 14 sign-off artifact for return-window and refund-method policy rules |
