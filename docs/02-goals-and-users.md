# 2–6. Product Goals, Business Goals, User Types, User Roles, User Personas

## 2. Product Goals

1. **Unify operations** — one system of record for catalog, inventory, manufacturing, orders, payments, invoices, customers, and content; eliminate spreadsheet/WhatsApp-based workflows.
2. **Make pre-order a first-class commerce flow** — customers can browse, pay (advance/full), and track production status for made-to-order garments with the same confidence as in-stock purchases.
3. **Achieve GST-compliant, automated invoicing** — every order, return, and correction produces the correct statutory document (Tax Invoice, Credit Note, Debit Note, Delivery Challan) without manual intervention.
4. **Deliver a premium, fast, mobile-first storefront** — sub-3-second perceived load, soft-luxury visual design, zero layout shift from media, consistent aspect ratios across breakpoints.
5. **Give non-technical staff full operational control** — admins manage products, banners, pages, SEO, campaigns, and orders without engineering involvement.
6. **Build retention infrastructure natively** — wishlist, reviews, loyalty/rewards, referrals, store credit, gift cards, and abandoned-cart recovery are built-in, not bolted on.
7. **Be SEO-first by architecture** — server-rendered pages, automatic sitemaps, schema markup, and canonical URLs are systemic, not per-page afterthoughts.
8. **Be extensible without re-architecture** — support multi-warehouse, multi-brand, wholesale/B2B, multi-currency, and international shipping as additive configuration on the existing data model.
9. **Provide real-time operational visibility** — dashboards for revenue, inventory health, production pipeline, and marketing performance available to the relevant role at all times.
10. **Enforce least-privilege operational security** — every admin action is scoped by role and permission, and is auditable.

## 3. Business Goals

1. Reduce order-to-cash cycle time by removing manual payment verification and invoicing delays.
2. Increase repeat-purchase rate via loyalty points, store credit, gift cards, and personalized recommendations (Complete the Look, Frequently Bought Together).
3. Reduce cart abandonment through automated recovery campaigns and a frictionless checkout (COD, UPI, manual transfer, Razorpay).
4. Increase average order value via bundling (Complete the Look / Frequently Bought Together) and free-shipping coupon thresholds.
5. Enable pre-order revenue capture ahead of production completion (advance payment), improving cash flow for manufacturing.
6. Reduce production blind spots — manufacturing costing (fabric/labor/printing/packaging/courier vs. margin) visible per style, preventing underpriced production runs.
7. Open a wholesale/B2B revenue channel without operating a second platform.
8. Improve organic acquisition via systemic SEO (schema, sitemaps, page speed) reducing paid-acquisition dependency over time.
9. Protect brand equity through consistent, premium visual presentation across every device and every media asset.
10. De-risk future growth (new brand launch, international expansion) by avoiding technical debt that would force a rebuild.

## 4. User Types

High-level categories of humans who interact with the system:

| User Type | Description |
|---|---|
| **Guest Visitor** | Unauthenticated visitor browsing the storefront, blog, or content pages. |
| **Registered Customer (Retail)** | Authenticated retail shopper with an account, order history, wishlist, rewards. |
| **Wholesale/B2B Customer** | Authenticated business buyer with negotiated pricing, bulk ordering, and separate invoicing terms. |
| **Internal Admin User** | Any authenticated staff member operating the Admin Panel, scoped by role (see §5). |
| **External Vendor (non-system-user, referenced entity)** | Fabric vendors, tailors, printing/embroidery vendors, and courier partners — tracked as records in the system but do not log in (v1); may receive a vendor portal in a future phase. |
| **System/Automated Actor** | Cron jobs, webhooks (Razorpay, WhatsApp delivery receipts), and scheduled marketing automations acting without a human session. |

## 5. User Roles (Admin Panel RBAC)

Roles are additive and permission-scoped (see [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §Security for the permission model). A user may be assigned exactly one primary role; permission overrides at the individual-user level are supported for edge cases.

| Role | Scope / Responsibility | Typical Permissions |
|---|---|---|
| **Super Admin** | Full, unrestricted access. Owns system configuration, role/permission management, financial settings, and brand-level configuration. | All modules, all actions, including user/role management and audit log access. |
| **Admin** | Day-to-day operational owner across most modules, excluding system-level configuration and role management. | Full CRUD on catalog, orders, inventory, manufacturing, CRM, marketing, SEO, content; cannot manage roles/permissions or billing-critical system settings. |
| **Inventory Manager** | Owns stock accuracy across warehouses. | Full access to Inventory module (stock levels, transfers, adjustments, low-stock alerts, inventory logs); read-only on Orders/Products. |
| **Order Manager** | Owns order lifecycle from confirmation to delivery/return. | Full access to Order Management, Payment Verification, Shipment Tracking, Returns/Refunds, Invoice generation (view/send); read-only on Inventory/Catalog. |
| **Content Manager** | Owns customer-facing content and merchandising presentation. | Full access to CMS (home builder, banners, navigation, footer), Blog, Media Library, Collections/Category content, Testimonials, FAQs, Policies; read-only on Products. |
| **Marketing Manager** | Owns campaigns and customer acquisition/retention programs. | Full access to Marketing Automation, Coupons, Newsletter, Campaigns, CRM segments (read), SEO module; read-only on Orders/Customers for targeting. |
| **Support Agent** | Front-line customer service. | Read access to Orders, Customers, Invoices, Tickets/Timeline; limited write (add notes, initiate return/refund request for Order Manager approval, resend invoice/notification). |

> **Future role placeholders** (designed for, not built in v1): Manufacturing Manager (full Manufacturing module ownership), Wholesale Manager (B2B-specific pricing/order approval), Finance/Accounts (invoice & ledger ownership, credit/debit notes), Warehouse Staff (pick/pack/dispatch only, mobile-optimized view).

## 6. User Personas

### 6.1 Retail Customer — "Ananya, the Considered Shopper"
- 27, urban professional, shops premium ethnic/fusion wear for festivals and work events.
- Shops primarily on mobile during commute/evening; compares 3–4 products before buying; reads reviews and checks size guide carefully (sizing anxiety is her #1 hesitation).
- Wants: accurate size guide, real customer photos/reviews, wishlist to revisit later, clear delivery timeline, easy returns.
- Will pre-order a limited-edition piece if she can see expected dispatch date and gets WhatsApp updates on production status.
- Pain point platform must solve: fear of ordering wrong size/fit on apparel sold without a physical store visit.

### 6.2 Wholesale Buyer — "Rajeev, the Boutique Owner"
- 41, owns 2 boutique stores, orders in bulk every 4–6 weeks ahead of each season.
- Needs: bulk-quantity ordering UI, negotiated/tiered pricing invisible to retail customers, longer payment terms (advance + balance), GST tax invoices for his own compliance, order history exportable for his accounting.
- Pain point: doesn't want to negotiate over WhatsApp/email every cycle; wants a self-service B2B portal with his pricing pre-applied.

### 6.3 Internal Admin — "Priya, the Order Manager"
- Manages 40–80 orders/day across COD, prepaid, and pre-order; verifies manual UPI/bank-transfer payment screenshots daily.
- Needs: a single queue of "payment verification pending" orders, one-click approve/reject with reason, ability to bulk-update order status, auto-generated invoice on confirmation, clear visibility into which pre-orders are in which production stage so she can answer customer queries without calling the factory.
- Pain point platform must solve: currently reconciles payments via screenshots in a WhatsApp group — needs this inside the system with an audit trail.

### 6.4 Internal Admin — "Karan, the Inventory & Manufacturing Lead"
- Tracks fabric stock, assigns production runs to tailors/printing vendors, updates production stage per pre-order batch.
- Needs: low-stock alerts on fabric, visibility into reserved vs. available stock per SKU/warehouse, a costing view (fabric/labor/printing/packaging/courier vs. selling price) per style before greenlighting a production run.
- Pain point platform must solve: currently tracks fabric and vendor costing in Excel, disconnected from what's actually selling.

### 6.5 Internal Admin — "Meera, the Marketing Manager"
- Runs festival campaigns, manages a coupon calendar, monitors abandoned-cart recovery performance.
- Needs: segment-based targeting (VIP, repeat, inactive), one place to create a coupon + email campaign together, visibility into which campaigns drove revenue.
- Pain point platform must solve: currently exports customer lists manually to a separate email tool with no order-data feedback loop.

### 6.6 Super Admin — "Founder/Owner"
- Wants a single dashboard each morning: revenue, orders, low-stock alerts, production bottlenecks, top products — without asking each team for a report.
- Cares about long-term optionality: ability to launch a second brand or wholesale channel without re-platforming.
