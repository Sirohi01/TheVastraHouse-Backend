# Completion Progress

This ledger records continuation work after the previous staged implementation. It is intentionally incremental so future sessions can resume without restarting the audit.

## 2026-09-27 Verification Baseline

### What Was Done

- Confirmed backend and frontend are separate git repositories with staged, uncommitted work.
- Reviewed staged diff stats in both repositories before editing.
- Ran backend tests, lint, and build.
- Ran frontend typecheck, lint, and production build.
- Fixed frontend lint failures in API/catalog/commerce helpers without altering feature behavior.

### Files Touched

- `frontend/src/lib/api.ts`
- `frontend/src/lib/catalog.ts`
- `frontend/src/lib/commerce.ts`
- `backend/docs/16-completion-progress.md`

### Test Status

- Backend `npm run test`: PASS, 112 tests.
- Backend `npm run lint`: PASS.
- Backend `npm run build`: PASS.
- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.
- Frontend `npm run typecheck`: PASS after Next build generated `.next/types`.

## 2026-09-27 Customer Account Frontend

### What Was Done

- Added a typed customer account API helper for overview, profile, addresses, rewards, preferences, sessions, and privacy requests.
- Added customer account pages for dashboard, addresses, orders, rewards/store credit/gift cards, privacy/preferences, and sessions.
- Wired customer order history to the existing `/orders/me` API and account preferences to `/auth/me/preferences`.

### Files Touched

- `frontend/src/lib/account.ts`
- `frontend/src/components/account/AccountClient.tsx`
- `frontend/src/app/account/page.tsx`
- `frontend/src/app/account/addresses/page.tsx`
- `frontend/src/app/account/orders/page.tsx`
- `frontend/src/app/account/privacy/page.tsx`
- `frontend/src/app/account/rewards/page.tsx`
- `frontend/src/app/account/sessions/page.tsx`

### Test Status

- Frontend `npm run typecheck`: PASS.
- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.

## 2026-09-27 Step 0 Route Backlog

### What Was Done

- Confirmed both repos had no uncommitted work after local commits:
  - Backend commit `4aa24cf` (`Complete backend commerce platform surfaces`).
  - Frontend commit `57012d0` (`Add storefront account SEO and admin growth surfaces`).
- Scanned every backend `src/routes/*.ts` route and current frontend API callers.
- Mapped covered routes to existing frontend callers by module:
  - Auth: login/register/forgot/reset/verify/refresh/logout/me/preferences/sessions are called by auth, account, and API helpers.
  - Catalog/public: products, PDP, reviews, categories, collections, search, sitemap, SEO settings are called by shop/PDP/taxonomy/search/SEO/sitemap code.
  - Catalog admin: products/category/collection/tag lookups and CRUD are called by admin catalog/products.
  - Commerce: cart/wishlist/gift packaging/gift card validation/attribution are called by cart/header/wishlist/checkout.
  - Checkout: preview/order creation/Razorpay config/confirm/order detail/balance payment are called by checkout/confirmation.
  - Orders admin and tracking: admin list/detail/status/shipment/cancel/bulk plus public tracking are called by admin orders and tracking pages.
  - Payments admin/customer: settings, sessions, verification queue, webhook events, approve/reject/history, Razorpay/manual/COD/UPI are called by payment/admin/history components.
  - Inventory/manufacturing/documents/returns/settings/notifications/access-control/admin dashboard/media/CMS legacy are called by existing admin/customer components.
  - Account overview/addresses/rewards/privacy/sessions/preferences are called by new account pages.
  - Marketing, CRM, and content SEO routes are called by the new admin growth workspaces.

### Unused Route Backlog

- `POST /account/gift-cards/purchase`: no customer gift-card purchase UI yet.
- `POST /account/wholesale/apply`: no customer wholesale application UI yet.
- `GET /account/support`, `GET /account/support/:ticketNumber`, `POST /account/support/:ticketNumber/replies`: no customer support-ticket UI yet.
- `POST /account/privacy/export`, `GET /account/privacy/export/:requestNumber`, `POST /account/privacy/delete`: privacy page lists requests, but export/delete step-up actions are not yet wired.
- `GET /catalog/reviews/mine`, `PATCH /catalog/reviews/:id`: no customer review management UI yet.
- `POST /catalog/admin/products/recompute-badges`: no admin product badge recompute button yet.
- `GET /catalog/admin/reviews`, `PATCH /catalog/admin/reviews/:id`: no full reviews moderation screen yet.
- `GET /content/blog`, `GET /content/blog/taxonomy`, `GET /content/blog/:slug`: no public blog list/detail pages yet.
- `GET/POST/PATCH/DELETE /content/admin/pages`: no first-class CMS page editor beyond legacy section content yet.
- `GET/POST/PATCH/DELETE /content/admin/blog`, `GET /content/admin/blog/meta`, blog category/author routes: no full blog editor yet.
- `PATCH/DELETE /content/admin/redirects/:id`: SEO workspace can create/list redirects, but edit/delete controls are not wired yet.
- CRM detail/update routes (`GET /crm/customers/:id`, notes, segment recompute, ticket detail/reply/status, privacy action): admin CRM list exists, but detail/action flows are incomplete.
- Marketing detail/action routes (`coupon redemptions`, coupon edit/delete, campaign edit/audience/send/cancel, automation edit, segments preview/create/delete, newsletter CSV export): marketing workspace lists/creates basic records only.
- `GET /engagement/banner`: no storefront caller yet.
- `POST /engagement/contact`, support/newsletter/back-in-stock/public engagement routes are partially covered; contact page is still missing.
- Loyalty admin non-gift-card routes (tiers/rules/referral/store-credit actions): admin gift-card issue exists, but loyalty/referral management is incomplete.
- `POST /system/*`: maintenance/scheduler/lock routes have no admin UI and should remain operational/admin-only.

### Test Status

- Route scan only; no code checks required for this ledger update.

## 2026-09-27 Customer Order Detail Frontend

### What Was Done

- Added `/account/orders/[id]` customer order detail page.
- Wired the page to `GET /orders/me/:orderNumber` and `POST /orders/me/:orderNumber/cancel`.
- Added customer-facing order detail helpers for timeline, payment session, shipment/tracking, refunds, and issued documents.
- Added invoice/credit-note PDF download buttons via the existing documents API.
- Added customer actions for pay balance, cancel order, and request return where order status allows.
- Updated `/account/orders` links to point to the new account order detail route.

### Files Touched

- `frontend/src/lib/orders.ts`
- `frontend/src/components/account/AccountOrderDetailClient.tsx`
- `frontend/src/app/account/orders/[id]/page.tsx`
- `frontend/src/components/account/AccountClient.tsx`
- `backend/docs/16-completion-progress.md`

### Test Status

- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.
- Frontend `npm run typecheck`: PASS after build regenerated `.next/types`.

## 2026-09-27 Next Image Warning Cleanup

### What Was Done

- Replaced remaining raw review thumbnail `<img>` elements with `next/image`.
- Cleared the two persistent Next image optimization lint warnings.

### Files Touched

- `frontend/src/components/catalog/ProductDetailClient.tsx`
- `frontend/src/components/catalog/ReviewForm.tsx`
- `backend/docs/16-completion-progress.md`

### Test Status

- Frontend `npm run lint`: PASS with no warnings.
- Frontend `npm run build`: PASS.
- Frontend `npm run typecheck`: PASS after build regenerated `.next/types`.

## 2026-09-27 Production Env Hardening

### What Was Done

- Added production fail-fast validation for `SETTINGS_ENCRYPTION_KEY`.
- Added production fail-fast validation for `CRON_SECRET`.
- Added production fail-fast validation requiring `ADMIN_TOTP_REQUIRED=true`.
- Expanded backend `.env.example` to include all current keys from `src/config/env.ts`.
- Kept secret values as placeholders only.

### Files Touched

- `backend/src/config/env.ts`
- `backend/.env.example`
- `backend/docs/16-completion-progress.md`

### Test Status

- Backend `npm run lint`: PASS.
- Backend `npm run build`: PASS.
- Backend `npm run test`: PASS, 112 tests.

## 2026-09-27 Admin Reviews Moderation

### What Was Done

- Added admin reviews moderation page at `/admin/reviews`.
- Wired review listing/search/status filtering to `GET /catalog/admin/reviews`.
- Wired approve/reject/pending moderation notes to `PATCH /catalog/admin/reviews/:id`.
- Wired deletion to `DELETE /catalog/admin/reviews/:id`.
- Added Reviews to the live admin sidebar.

### Files Touched

- `frontend/src/lib/reviewsAdmin.ts`
- `frontend/src/app/admin/reviews/page.tsx`
- `frontend/src/components/admin/AdminShell.tsx`
- `backend/docs/16-completion-progress.md`

### Test Status

- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.
- Frontend `npm run typecheck`: PASS after build regenerated `.next/types`.

## 2026-09-27 Public CMS, Contact, Policies, And Blog

### What Was Done

- Added a server content helper for CMS pages, policies, blog listing/detail, taxonomy, and contact enquiry submission.
- Added `/contact` with a form that persists enquiries through `POST /engagement/contact`.
- Added CMS-driven `/faq`, `/pages/[slug]`, `/policies`, and `/policies/[slug]` pages.
- Added `/blog` listing with pagination/category/tag query support and `/blog/[slug]` detail pages.
- Added server-rendered metadata, breadcrumbs, WebPage/Article/FAQ JSON-LD where applicable.

### Files Touched

- `frontend/src/lib/content.ts`
- `frontend/src/components/content/CmsRichPage.tsx`
- `frontend/src/components/content/ContactForm.tsx`
- `frontend/src/app/contact/page.tsx`
- `frontend/src/app/faq/page.tsx`
- `frontend/src/app/policies/page.tsx`
- `frontend/src/app/policies/[slug]/page.tsx`
- `frontend/src/app/pages/[slug]/page.tsx`
- `frontend/src/app/blog/page.tsx`
- `frontend/src/app/blog/[slug]/page.tsx`
- `backend/docs/16-completion-progress.md`

### Test Status

- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.
- Frontend `npm run typecheck`: PASS after build regenerated `.next/types`.

## 2026-09-27 Checkout Saved Addresses And Discounts

### What Was Done

- Checkout now loads saved account addresses and can fill the checkout address form from a selected saved address.
- Checkout can save a newly entered address to the account via the existing checkout `saveAddress` payload.
- Added explicit coupon apply/remove controls; server preview remains the validation source and returns validation errors.
- Added gift-card application from checkout through the existing cart gift-card validation API.
- Store credit and reward redemption remain server-previewed and are presented alongside coupon/gift card controls.

### Files Touched

- `frontend/src/components/checkout/CheckoutClient.tsx`
- `frontend/src/lib/checkout.ts`
- `backend/docs/16-completion-progress.md`

### Test Status

- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.
- Frontend `npm run typecheck`: PASS after build regenerated `.next/types`.

## 2026-09-27 Admin Growth Workspaces

### What Was Done

- Added admin Marketing workspace for coupons, campaigns, newsletter subscribers, and back-in-stock records.
- Added admin CRM workspace for customers, wholesale approvals, support tickets, and privacy requests.
- Added admin SEO workspace for global SEO settings, audit rows, and redirects.
- Added live sidebar entries for Marketing, CRM / Support, and SEO.

### Files Touched

- `frontend/src/lib/adminGrowth.ts`
- `frontend/src/components/admin/GrowthWorkspaceClient.tsx`
- `frontend/src/components/admin/AdminShell.tsx`
- `frontend/src/app/admin/marketing/page.tsx`
- `frontend/src/app/admin/crm/page.tsx`
- `frontend/src/app/admin/seo/page.tsx`

### Test Status

- Frontend `npm run typecheck`: PASS.
- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
- Frontend `npm run build`: PASS with the same two warnings.

## 2026-09-27 Auth And Header Frontend

### What Was Done

- Header account icon now routes logged-out shoppers to `/login` and logged-in shoppers to `/account`, never admin login.
- Added `/verify-email` and `/reset-password` customer pages wired to backend auth endpoints.
- Updated signup success to continue into email verification.
- Reworked OTP page to use URL flow context, resend cooldown, and attempt messaging instead of a public purpose selector.
- Removed the public `/payments` harness by redirecting it to checkout with noindex metadata.

### Files Touched

- `frontend/src/components/layout/Header.tsx`
- `frontend/src/app/register/page.tsx`
- `frontend/src/app/forgot-password/page.tsx`
- `frontend/src/app/otp/page.tsx`
- `frontend/src/app/verify-email/page.tsx`
- `frontend/src/app/reset-password/page.tsx`
- `frontend/src/app/payments/page.tsx`

### Test Status

- Frontend `npm run typecheck`: PASS.
- Frontend `npm run lint`: PASS with two existing Next `<img>` warnings.
