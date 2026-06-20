# 9. Complete Feature List

Master catalog of every feature in scope for v1, organized by area. This is the canonical checklist — every item here must map to at least one task in [08-atomic-tasks.md](08-atomic-tasks.md).

## 9.1 Customer Website Pages
Home · Shop · Category · Collection · Product Details · Pre-Order Products · Cart · Checkout · Wishlist · My Account · Orders · Invoices · Track Order · About Us · Contact Us · Blogs · FAQs · Privacy Policy · Terms & Conditions · Shipping Policy · Return Policy

## 9.2 Customer Account & Engagement Features
User Registration · Login · Forgot Password · OTP Verification · Wishlist · Recently Viewed Products · Product Comparison · Complete the Look Recommendations · Frequently Bought Together · Reviews & Ratings · Referral Program · Reward Points · Loyalty Program · Store Credits · Gift Cards · Gift Packaging · Notify Me When Available · Back In Stock Alerts

## 9.3 Product System Fields
Name · Slug · Description · Short Description · Highlights · Fabric Details · Wash Care · Size Guide · Images · Videos · SKU · Barcode · HSN Code · GST Rate · Variants (Color × Size) · Collections · Tags · SEO Metadata per product

## 9.4 Advanced Product Features
Related Products · Recommended Products · Frequently Bought Together · Complete The Look · New Arrival Badge · Best Seller Badge · Trending Badge · Limited Edition Badge

## 9.5 Pre-Order System
Enable Pre-Order toggle · Pre-Order Start/End Date · Expected Dispatch Date · Expected Delivery Date · Advance Payment mode · Full Payment mode · Limited Quantity cap · Production Tracker (9 stages: Order Received, Fabric Sourcing, Cutting, Printing, Stitching, Finishing, Quality Check, Packaging, Dispatch)

## 9.6 Inventory Management
Warehouse Management · Multiple Warehouses · Stock Tracking · Reserved Stock · Available Stock · Damaged Stock · Returned Stock · Incoming Stock · Low Stock Alerts · Inventory Logs

## 9.7 Manufacturing Module
Fabric Inventory · Fabric Vendors · Tailors · Printing Vendors · Embroidery Vendors · Packaging Vendors · Production Orders · Costing Management (Fabric Cost, Labor Cost, Printing Cost, Packaging Cost, Courier Cost, Profit Margin)

## 9.8 Order Management
Order Creation · Order Tracking · Status Timeline · Payment Tracking · Invoice Generation · Shipment Tracking · Return Management · Refund Management
Order Statuses: Pending Payment · Payment Verification Pending · Payment Rejected · Confirmed · Pre-Order Confirmed · COD Confirmed · In Production · Packed · Ready To Dispatch · Shipped · Delivered · Cancelled · Returned · Refunded

## 9.9 Payment System
Razorpay · COD · Manual Bank Transfer · UPI
Manual Payment Flow: Upload Payment Screenshot · Admin Verification · Approve Payment · Reject Payment · Payment History

## 9.10 Invoice System
Document types: Tax Invoice · Proforma Invoice · Receipt · Credit Note · Debit Note · Delivery Challan · Return Invoice
Configuration: Invoice Prefix · Proforma Prefix · Order Prefix · SKU Prefix
PDF contents: Company Logo · Company Information · GST Details · Customer Information · Order Information · Product Details · SKU · HSN Code · Taxes · Discounts · Shipping Charges · Grand Total

## 9.11 CRM
Customer Profiles · Customer Timeline · Purchase History · Lifetime Value · Customer Segments (New, Repeat, VIP, Wholesale, Inactive)

## 9.12 Marketing Automation
Newsletter System · Email Campaigns · Coupon Campaigns · Festival Campaigns · Abandoned Cart Recovery · Win-Back Campaigns · Review Request Emails · Back In Stock Emails
Coupon System: Flat Discount · Percentage Discount · Free Shipping · Minimum Cart Value · Maximum Discount · Usage Limits (Single Use, Multi Use)

## 9.13 Blog System
Rich Text Editor · Categories · Tags · Authors · Featured Images · SEO Metadata · Article Schema · FAQ Schema · Breadcrumb Schema

## 9.14 SEO Management
Global SEO Settings · Page SEO · Product SEO · Category SEO · Blog SEO
Automatic: XML Sitemap · Product Sitemap · Category Sitemap · Blog Sitemap · Image Sitemap · robots.txt · Canonical URLs
Schema Support: Organization · Website · Product · Review · FAQ · Breadcrumb · Article

## 9.15 Admin CMS
Home Page Builder · Banner Management · Collection Management · Testimonials · FAQs · Policies · Footer · Header · Navigation Menus

## 9.16 Media Library
Images · Videos · Catalog PDFs · Lookbooks
Aspect-ratio governance: 1:1 · 4:5 · 9:16 · 16:9 · 21:9 · 3:2 · 2:3 · Custom, with original-preservation, cross-device consistency, optimization, lazy loading, responsive images, responsive video.

## 9.17 Analytics Dashboard
Revenue · Orders · Customers · Conversion Rate · Top Products · Top Categories · Top Collections · Traffic Sources · Abandoned Cart Rate · Repeat Customer Rate

## 9.18 Security
JWT Authentication · Refresh Tokens · Role-Based Access · Permissions · Audit Logs · Activity Logs · Admin Login History · Rate Limiting

## 9.19 Wholesale/B2B
Wholesale Customer accounts · Tiered/negotiated pricing · Bulk ordering UI · B2B payment terms · B2B invoicing

## 9.20 Admin Roles
Super Admin · Admin · Inventory Manager · Order Manager · Content Manager · Marketing Manager · Support Agent

## 9.21 Architect-Review Additions (see [12-architect-review.md](12-architect-review.md))
Search & Discovery (typo-tolerant search, autocomplete, synonyms) · Fraud & Risk Management (velocity checks, flagged-order queue) · Support & Helpdesk Ticketing · Data Privacy & Compliance Center (data export, account/data deletion, anonymization) · Logistics & Courier Integration (rate shopping, label generation, tracking webhooks) · Admin Mandatory 2FA · Admin In-App Alert Center · Webhook Observability Console · Notification Preference Center · Active Session/Device Management self-service

## 9.22 Security Features (see [10-security-architecture.md](10-security-architecture.md))
Account Lockout & Brute-Force Protection · Refresh Token Rotation & Reuse Detection · IDOR/Object-Level Authorization Checks · Webhook Signature Verification · File Upload Malware Scanning · Rich-Text/CMS Sanitization · Atomic Invoice Numbering · Audit Log for Privilege Changes · Data Retention & Soft-Delete Policy · Security Headers (CSP/HSTS) · Penetration Testing (pre-launch gate)
