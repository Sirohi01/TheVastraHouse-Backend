# 7–8. Functional & Non-Functional Requirements

## 7. Functional Requirements

Functional requirements are grouped by module. Each is written as a system capability ("The system shall...").

### 7.1 Authentication & Account
- FR-AUTH-01: The system shall allow registration via email/password with mandatory email verification.
- FR-AUTH-02: The system shall support login via email+password and support future extension to OTP/mobile login.
- FR-AUTH-03: The system shall support OTP-based verification for registration, login, and sensitive actions (password reset).
- FR-AUTH-04: The system shall issue short-lived JWT access tokens and long-lived rotating refresh tokens; refresh tokens shall be revocable.
- FR-AUTH-05: The system shall support "Forgot Password" via emailed reset link with expiring token.
- FR-AUTH-06: The system shall enforce Role-Based Access Control for every Admin Panel route and API endpoint.
- FR-AUTH-07: The system shall log every admin login attempt (success/failure) with IP, device, timestamp.
- FR-AUTH-08: The system shall allow Super Admin to deactivate/reactivate any user (customer or admin) account.

### 7.2 Customer Website — Catalog & Discovery
- FR-CAT-01: The system shall display Home, Shop, Category, Collection, and Product Detail pages with server-side rendering for SEO.
- FR-CAT-02: The system shall support filtering (size, color, price, fabric, collection, tag) and sorting (price, newest, best-selling) on Shop/Category/Collection pages.
- FR-CAT-03: The system shall support product variants by color and size, each with independent SKU, stock, and (optionally) price.
- FR-CAT-04: The system shall display badges (New Arrival, Best Seller, Trending, Limited Edition) computed automatically or set manually by admin.
- FR-CAT-05: The system shall show Related Products, Recommended Products, Frequently Bought Together, and Complete The Look sections on Product Detail pages.
- FR-CAT-06: The system shall track and display Recently Viewed Products per customer (session for guests, persisted for logged-in users).
- FR-CAT-07: The system shall support a Product Comparison feature across up to N (configurable) products.
- FR-CAT-08: The system shall render a Size Guide per product/category, configurable by admin.
- FR-CAT-09: The system shall support customer Reviews & Ratings with photo upload, moderation queue, and verified-purchase flag.
- FR-CAT-10: The system shall support "Notify Me When Available" and "Back In Stock" alerts (email/WhatsApp) per out-of-stock variant.

### 7.3 Pre-Order System
- FR-PRE-01: The system shall allow any product/variant to be flagged Pre-Order with start date, end date, expected dispatch date, and expected delivery date.
- FR-PRE-02: The system shall support advance-payment and full-payment pre-order modes, configurable per product.
- FR-PRE-03: The system shall enforce a limited-quantity cap on pre-order SKUs and close ordering automatically when reached or end date passes.
- FR-PRE-04: The system shall expose a Production Tracker per pre-order item with stages: Order Received → Fabric Sourcing → Cutting → Printing → Stitching → Finishing → Quality Check → Packaging → Dispatch.
- FR-PRE-05: The system shall notify the customer (email/WhatsApp) on each production stage transition.
- FR-PRE-06: The system shall allow admin to bulk-update production stage across multiple pre-orders in the same production batch.

### 7.4 Cart, Checkout & Wishlist
- FR-CART-01: The system shall persist cart for logged-in users across sessions/devices and merge guest cart on login.
- FR-CART-02: The system shall support Wishlist with move-to-cart and stock/price-change notifications.
- FR-CART-03: The system shall validate stock availability (including reserved stock) at add-to-cart and at checkout.
- FR-CART-04: The system shall support Gift Packaging as a checkout add-on (with optional message).
- FR-CART-05: The system shall support Gift Cards as a payment instrument applicable at checkout.
- FR-CART-06: The system shall calculate shipping, GST, discounts, store credit, and reward-point redemption within the cart/checkout total.
- FR-CART-07: The system shall trigger an Abandoned Cart event (for marketing automation) when a cart with items is inactive beyond a configurable threshold.

### 7.5 Payments
- FR-PAY-01: The system shall support Razorpay (cards/netbanking/UPI via gateway), COD, Manual Bank Transfer, and direct UPI as payment methods.
- FR-PAY-02: For Manual Payment, the system shall allow customer upload of a payment screenshot and place the order in "Payment Verification Pending" status.
- FR-PAY-03: The system shall allow Order Manager/Admin to Approve or Reject a manual payment with a mandatory reason on rejection, transitioning order status accordingly.
- FR-PAY-04: The system shall maintain a complete Payment History per order, including gateway transaction IDs, verification actor, and timestamps.
- FR-PAY-05: The system shall support partial payment capture for pre-orders (advance now, balance before dispatch) and track the outstanding balance.
- FR-PAY-06: The system shall reconcile Razorpay webhook events idempotently against order payment status.

### 7.6 Order Management
- FR-ORD-01: The system shall support the full order status lifecycle: Pending Payment → Payment Verification Pending / Payment Rejected → Confirmed / Pre-Order Confirmed / COD Confirmed → In Production → Packed → Ready To Dispatch → Shipped → Delivered, with side branches Cancelled, Returned, Refunded.
- FR-ORD-02: The system shall maintain an auditable Status Timeline per order (who changed status, when, optional note).
- FR-ORD-03: The system shall generate a Tax Invoice automatically upon order confirmation.
- FR-ORD-04: The system shall support Shipment Tracking with carrier, tracking number, and a customer-facing Track Order page.
- FR-ORD-05: The system shall support Return initiation by customer (within policy window) and admin-side Return/Refund processing, generating a Return Invoice / Credit Note as applicable.
- FR-ORD-06: The system shall support order cancellation by customer (pre-dispatch, policy-permitting) and by admin at any stage, with automatic stock release.
- FR-ORD-07: The system shall support bulk order actions (status update, export, print invoices) in the Admin Panel.

### 7.7 Inventory Management
- FR-INV-01: The system shall support multiple warehouses, each tracking stock independently per SKU.
- FR-INV-02: The system shall track Available Stock, Reserved Stock (in active carts/unconfirmed orders), Damaged Stock, Returned Stock, and Incoming Stock as distinct, reconcilable states.
- FR-INV-03: The system shall trigger Low Stock Alerts at a configurable threshold per SKU/warehouse.
- FR-INV-04: The system shall maintain an immutable Inventory Log for every stock-affecting event (sale, return, adjustment, transfer, damage) with actor and timestamp.
- FR-INV-05: The system shall support manual stock adjustment with mandatory reason code, restricted to Inventory Manager/Admin/Super Admin.
- FR-INV-06: The system shall support stock transfer between warehouses with an in-transit state.

### 7.8 Manufacturing Management
- FR-MFG-01: The system shall maintain master records for Fabric Inventory, Fabric Vendors, Tailors, Printing Vendors, Embroidery Vendors, and Packaging Vendors.
- FR-MFG-02: The system shall support creation of Production Orders linked to one or more pre-order/SKU demand, assignable to a vendor/tailor.
- FR-MFG-03: The system shall track Costing per production order/style across Fabric Cost, Labor Cost, Printing Cost, Packaging Cost, and Courier Cost, computing Profit Margin against selling price.
- FR-MFG-04: The system shall alert when fabric stock falls below threshold required for open production orders.
- FR-MFG-05: The system shall let admin update Production Stage for a Production Order, cascading status to linked pre-order(s).

### 7.9 Invoicing
- FR-INVC-01: The system shall generate Tax Invoice, Proforma Invoice, Receipt, Credit Note, Debit Note, Delivery Challan, and Return Invoice document types.
- FR-INVC-02: The system shall render every invoice as a PDF (via Puppeteer) including company logo, company/GST info, customer info, order info, line items with SKU/HSN/GST, discounts, shipping, and grand total.
- FR-INVC-03: The system shall support configurable, independently-incrementing number sequences/prefixes for Invoice, Proforma, Order, and SKU.
- FR-INVC-04: The system shall allow re-sending an invoice PDF to the customer via email on demand.
- FR-INVC-05: The system shall prevent edits to a finalized invoice; corrections shall be issued as a Credit Note/Debit Note, preserving the original.

### 7.10 CRM
- FR-CRM-01: The system shall maintain a unified Customer Profile (contact info, addresses, order history, lifetime value, marketing consent).
- FR-CRM-02: The system shall render a chronological Customer Timeline (orders, support interactions, campaign sends, reviews).
- FR-CRM-03: The system shall compute and display Lifetime Value per customer.
- FR-CRM-04: The system shall auto-classify customers into Segments: New, Repeat, VIP, Wholesale, Inactive, based on configurable rules (order count, spend, recency).
- FR-CRM-05: The system shall allow Marketing Manager to define custom segments via rule combinations for campaign targeting.

### 7.11 Marketing Automation
- FR-MKT-01: The system shall support Newsletter signup/management and bulk Email Campaign sending via Brevo/SMTP.
- FR-MKT-02: The system shall support Coupon Campaigns (flat/percentage/free-shipping discount types) with min cart value, max discount cap, and usage limits (single-use/multi-use, per-customer/global).
- FR-MKT-03: The system shall support scheduled Festival Campaigns combining content (banner/email) and coupons.
- FR-MKT-04: The system shall trigger automated Abandoned Cart Recovery emails on a configurable delay/sequence.
- FR-MKT-05: The system shall trigger automated Win-Back Campaigns targeting the Inactive segment.
- FR-MKT-06: The system shall trigger Review Request emails post-delivery on a configurable delay.
- FR-MKT-07: The system shall trigger Back In Stock emails to all customers who opted into a Notify Me alert for that SKU.
- FR-MKT-08: The system shall support a Referral Program (unique referral code/link per customer, reward on qualifying referred purchase).
- FR-MKT-09: The system shall support Reward Points (earn on purchase/actions, redeem at checkout) and a Loyalty Program tier structure.
- FR-MKT-10: The system shall support Store Credits (issued by admin or via return/refund) usable at checkout.
- FR-MKT-11: The system shall support Gift Cards (purchasable, redeemable, balance-tracked).

### 7.12 Blog & Content
- FR-BLOG-01: The system shall provide a Rich Text Editor for blog authoring with Categories, Tags, Authors, and Featured Images.
- FR-BLOG-02: The system shall support per-article SEO Metadata and automatic Article Schema, FAQ Schema, and Breadcrumb Schema output.
- FR-CMS-01: The system shall provide a Home Page Builder (drag/configure sections: banner, collection grid, testimonials, etc.).
- FR-CMS-02: The system shall provide Banner Management with aspect-ratio-governed media (see §Media below) and scheduling (start/end date).
- FR-CMS-03: The system shall provide management screens for Collections, Testimonials, FAQs, Policies, Footer, Header, and Navigation Menus, all editable without code deploys.

### 7.13 SEO Management
- FR-SEO-01: The system shall provide Global, Page-level, Product-level, Category-level, and Blog-level SEO metadata fields (title, description, OG image, canonical URL).
- FR-SEO-02: The system shall auto-generate XML Sitemaps (Product, Category, Blog, Image) and `robots.txt`, kept in sync with content changes.
- FR-SEO-03: The system shall emit structured data: Organization, Website, Product, Review, FAQ, Breadcrumb, and Article schema as applicable per page type.
- FR-SEO-04: The system shall enforce canonical URLs across paginated/filtered catalog views to prevent duplicate-content issues.

### 7.14 Media Management
- FR-MED-01: The system shall require an aspect ratio selection (1:1, 4:5, 9:16, 16:9, 21:9, 3:2, 2:3, Custom) at upload time for every image/video/banner asset.
- FR-MED-02: The system shall preserve the original uploaded media file and derive ratio-cropped renditions, never destructively overwriting the source.
- FR-MED-03: The system shall render the selected aspect ratio consistently across desktop, tablet, and mobile breakpoints for a given asset placement.
- FR-MED-04: The system shall support responsive image delivery (multiple resolutions, lazy loading, modern formats) via Cloudinary transformations.
- FR-MED-05: The system shall support a Media Library (images, videos, catalog PDFs, lookbooks) with search/filter/tagging, reusable across modules.
- FR-MED-06: The system shall let admin choose `object-cover` vs `object-contain` rendering behavior per media placement.

### 7.15 Wholesale/B2B
- FR-B2B-01: The system shall support a Wholesale Customer account type with tiered/negotiated pricing invisible to retail customers.
- FR-B2B-02: The system shall support bulk-quantity ordering UI distinct from the retail cart (per-style quantity grid by size).
- FR-B2B-03: The system shall support B2B-specific payment terms (e.g., advance + balance, credit terms) and B2B-specific invoicing.

### 7.16 Analytics & Reporting
- FR-RPT-01: The system shall provide a dashboard reporting Revenue, Orders, Customers, Conversion Rate, Abandoned Cart Rate, and Repeat Customer Rate over selectable date ranges.
- FR-RPT-02: The system shall report Top Products, Top Categories, Top Collections, and Traffic Sources.
- FR-RPT-03: The system shall allow export of report data (CSV) for offline analysis.

### 7.17 Notifications
- FR-NOTIF-01: The system shall send transactional emails (order confirmation, payment status, shipment, production-stage updates, password reset, OTP) via SMTP/Brevo.
- FR-NOTIF-02: The system shall send transactional WhatsApp messages (order/payment/production/shipment updates) via WhatsApp Business API where the customer has opted in.
- FR-NOTIF-03: The system shall maintain a notification log per customer/order for support traceability.

## 8. Non-Functional Requirements

### 8.1 Performance
- NFR-PERF-01: Storefront pages (Home, Shop, Product Detail) shall achieve Largest Contentful Paint under 2.5s on a simulated mid-tier mobile connection.
- NFR-PERF-02: All list/catalog API endpoints shall support pagination and respond within 300ms server processing time at expected catalog scale (≤50k SKUs).
- NFR-PERF-03: Media shall be served via CDN (Cloudinary) with responsive sizing and lazy loading to avoid layout shift (CLS < 0.1).
- NFR-PERF-04: Admin Panel data tables (orders, products, inventory) shall remain responsive (<1s interaction) up to 100k rows via server-side pagination/filtering.

### 8.2 Scalability
- NFR-SCALE-01: The backend shall be horizontally scalable (stateless API processes behind a load balancer; session/refresh-token state in a shared store, not in-process memory).
- NFR-SCALE-02: The data model shall support multiple warehouses, multiple brands, and multiple currencies as additive fields/collections, not schema rewrites (see [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md)).
- NFR-SCALE-03: Background/async work (email sending, PDF generation, sitemap regeneration, campaign dispatch) shall run via a job queue, decoupled from request/response cycles.

### 8.3 Availability & Reliability
- NFR-AVAIL-01: Core storefront (browse, cart, checkout) shall target 99.9% uptime.
- NFR-AVAIL-02: Payment webhook processing shall be idempotent and retry-safe.
- NFR-AVAIL-03: All financial documents (invoices, credit notes) shall be generated exactly once and stored immutably (Cloudinary/object storage), independent of PDF-render service uptime at view time.

### 8.4 Security
See [06-cross-cutting-requirements.md](06-cross-cutting-requirements.md) §Security for the full requirement set (JWT/refresh token handling, RBAC, audit logs, rate limiting, input validation, PCI-aware payment handling via Razorpay tokenization).

### 8.5 Usability & Accessibility
- NFR-UX-01: All Admin Panel data tables shall provide a mobile card-view fallback below tablet breakpoint.
- NFR-UX-02: All forms shall provide inline validation and clear error states; all async actions shall provide loading and empty states.
- NFR-UX-03: Color contrast and tap-target sizing shall meet WCAG 2.1 AA where feasible within the light-theme luxury design system.

### 8.6 Maintainability
- NFR-MAINT-01: Frontend and backend shall follow a documented module boundary (catalog, inventory, manufacturing, orders, payments, CRM, marketing, SEO, CMS) so a module can be modified/extended without cross-module regressions.
- NFR-MAINT-02: Shared design tokens (color, spacing, typography) shall be centralized (Tailwind config + Shadcn theme) and not duplicated per page.

### 8.7 Compliance
- NFR-COMP-01: Invoicing shall comply with Indian GST invoicing requirements (GSTIN, HSN, tax breakdown by rate).
- NFR-COMP-02: Customer data handling shall align with applicable data-protection norms (clear consent for marketing communication, data export/delete capability for account closure requests).

### 8.8 Internationalization Readiness
- NFR-I18N-01: All currency, date, and number formatting shall route through a centralized locale-aware formatting layer, even though only one locale/currency ships in v1 (see Future Expansion).
