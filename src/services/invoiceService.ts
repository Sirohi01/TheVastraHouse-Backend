import puppeteer from "puppeteer";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { AppError } from "../middleware/errorHandler.js";
import { DocumentSequence } from "../models/DocumentSequence.js";
import { Order } from "../models/Order.js";
import { OrderDocument, type orderDocumentTypes } from "../models/OrderDocument.js";
import { Refund } from "../models/Refund.js";
import { ReturnRequest } from "../models/ReturnRequest.js";
import { logger } from "../utils/logger.js";
import { enqueueNotification } from "./notificationDispatchService.js";
import { getRuntimeSetting } from "./runtimeSettingsService.js";

type DocumentType = (typeof orderDocumentTypes)[number];
type OrderSnapshot = {
  _id: unknown;
  userId?: unknown;
  guestEmail?: string;
  orderNumber: string;
  billingAddress?: unknown;
  shippingAddress?: unknown;
  items: Array<{
    productName: string;
    sku: string;
    hsnCode: string;
    gstRate: number;
    quantity: number;
    unitPrice: number;
    taxableAmount: number;
    gstAmount: number;
    lineSubtotal: number;
  }>;
  taxBreakdown: unknown[];
  totals: Record<string, unknown> & { grandTotal: number; currencyCode: string };
};
type AddressSnapshot = {
  fullName?: string;
  company?: string;
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  countryCode?: string;
  phone?: string;
};
type PdfSnapshot = {
  billingAddress?: unknown;
  shippingAddress?: unknown;
  customerEmail?: string;
  taxBreakdown?: unknown[];
  metadata?: Record<string, unknown>;
  company: { name: string; address: string; gstin: string; email: string; state?: string };
  currencyCode: string;
  documentNumber: string;
  issuedAt: Date;
  lines: Array<{
    productName: string;
    sku: string;
    hsnCode?: string;
    gstRate: number;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  orderNumber: string;
  totals: Record<string, unknown> & { grandTotal: number };
  type: DocumentType;
};
type StoredDocument = {
  _id: unknown;
  customerEmail?: string;
  documentNumber: string;
  orderNumber: string;
  type: string;
};

export async function generateOrderDocument(input: {
  orderId: unknown;
  type: DocumentType;
  returnRequestId?: unknown;
  amountOverride?: number;
  metadata?: Record<string, unknown>;
}) {
  const identity = {
    orderId: new Types.ObjectId(String(input.orderId)),
    type: input.type,
    ...(input.returnRequestId
      ? { returnRequestId: new Types.ObjectId(String(input.returnRequestId)) }
      : {}),
  };
  const existing = await OrderDocument.findOne(identity).lean();
  if (existing) return existing;

  const order = (await Order.findById(input.orderId).lean()) as OrderSnapshot | null;
  if (!order) throw new AppError("Order not found for document generation", 404);
  const issuedAt = new Date();
  const financialYear = financialYearFor(issuedAt);
  const documentNumber = await nextDocumentNumber(input.type, financialYear);
  const amountFactor = input.amountOverride
    ? Math.min(1, input.amountOverride / Math.max(1, order.totals.grandTotal))
    : 1;
  const lines = order.items.map((item) => ({
    gstAmount: money(item.gstAmount * amountFactor),
    gstRate: item.gstRate,
    hsnCode: item.hsnCode,
    lineTotal: money(item.lineSubtotal * amountFactor),
    productName: item.productName,
    quantity: item.quantity,
    sku: item.sku,
    taxableAmount: money(item.taxableAmount * amountFactor),
    unitPrice: money(item.unitPrice * amountFactor),
  }));
  const company = await companySnapshot();
  const buyer = await buyerSnapshot(order);
  const snapshot = {
    billingAddress: order.billingAddress,
    company,
    currencyCode: order.totals.currencyCode,
    customerEmail: order.guestEmail ?? (await accountEmail(order.userId)),
    documentNumber,
    financialYear,
    issuedAt,
    lines,
    metadata: { ...(input.metadata ?? {}), ...buyer },
    orderId: order._id,
    orderNumber: order.orderNumber,
    returnRequestId: input.returnRequestId,
    shippingAddress: order.shippingAddress,
    taxBreakdown: order.taxBreakdown,
    totals: input.amountOverride
      ? { ...order.totals, grandTotal: money(input.amountOverride) }
      : order.totals,
    type: input.type,
    userId: order.userId,
  };
  const pdfData = await renderDocumentPdf(snapshot);
  return OrderDocument.create({
    ...snapshot,
    pdf: { data: pdfData, mimeType: "application/pdf", size: pdfData.length },
  });
}

export async function generateReturnDocuments(input: {
  orderId: unknown;
  returnRequestId: unknown;
  refundAmount: number;
  refundMethod: string;
}) {
  if (isTestRuntime()) return [];
  const common = {
    amountOverride: input.refundAmount,
    metadata: { refundMethod: input.refundMethod },
    orderId: input.orderId,
    returnRequestId: input.returnRequestId,
  };
  void Promise.all([
    generateOrderDocument({ ...common, type: "credit_note" }),
    generateOrderDocument({ ...common, type: "return_invoice" }),
  ])
    .then(() =>
      ReturnRequest.findByIdAndUpdate(input.returnRequestId, {
        $set: { creditNoteStatus: "generated" },
      }),
    )
    .catch((error) =>
      logger.warn(
        { error, returnRequestId: input.returnRequestId },
        "Return document generation failed; reconciliation will retry",
      ),
    );
  return [];
}

export async function generateConfirmationDocuments(orderId: unknown) {
  if (isTestRuntime()) return [];
  void Promise.all([
    generateOrderDocument({ orderId, type: "tax_invoice" }),
    generateOrderDocument({ orderId, type: "receipt" }),
  ]).catch((error) =>
    logger.warn(
      { error, orderId },
      "Confirmation document generation failed; reconciliation will retry",
    ),
  );
  return [];
}

export async function generateDispatchDocument(orderId: unknown) {
  if (isTestRuntime()) return null;
  void generateOrderDocument({ orderId, type: "delivery_challan" }).catch((error) =>
    logger.warn(
      { error, orderId },
      "Dispatch document generation failed; reconciliation will retry",
    ),
  );
  return null;
}

export async function reconcileOrderDocuments() {
  const orders = await Order.find({
    status: {
      $in: [
        "confirmed",
        "pre_order_confirmed",
        "cod_confirmed",
        "in_production",
        "packed",
        "ready_to_dispatch",
        "shipped",
        "delivered",
        "returned",
        "refunded",
      ],
    },
  })
    .select("_id status")
    .limit(100)
    .lean();
  let generated = 0;
  let failed = 0;
  for (const order of orders as unknown as Array<{ _id: unknown; status: string }>) {
    const types: DocumentType[] = ["tax_invoice", "receipt"];
    if (["shipped", "delivered", "returned", "refunded"].includes(order.status))
      types.push("delivery_challan");
    for (const type of types) {
      try {
        await generateOrderDocument({ orderId: order._id, type });
        generated += 1;
      } catch (error) {
        failed += 1;
        logger.warn({ error, orderId: order._id, type }, "Document reconciliation item failed");
      }
    }
  }
  const returns = await ReturnRequest.find({ status: { $in: ["approved", "refunded"] } })
    .select("_id orderId")
    .limit(100)
    .lean();
  for (const returnRequest of returns as unknown as Array<{ _id: unknown; orderId: unknown }>) {
    const refund = (await Refund.findOne({ returnRequestId: returnRequest._id }).lean()) as {
      amount: number;
      method: string;
    } | null;
    if (!refund) continue;
    let returnDocumentsFailed = false;
    for (const type of ["credit_note", "return_invoice"] as const) {
      try {
        await generateOrderDocument({
          amountOverride: refund.amount,
          metadata: { refundMethod: refund.method },
          orderId: returnRequest.orderId,
          returnRequestId: returnRequest._id,
          type,
        });
        generated += 1;
      } catch (error) {
        failed += 1;
        returnDocumentsFailed = true;
        logger.warn(
          { error, returnRequestId: returnRequest._id, type },
          "Return document reconciliation item failed",
        );
      }
    }
    if (!returnDocumentsFailed) {
      await ReturnRequest.findByIdAndUpdate(returnRequest._id, {
        $set: { creditNoteStatus: "generated" },
      });
    }
  }
  return { failed, generated };
}

export function startDocumentReconciliationJob(intervalMs = 10 * 60 * 1000) {
  const run = () =>
    void reconcileOrderDocuments().catch((error) =>
      logger.warn({ error }, "Document reconciliation failed"),
    );
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

export async function resendOrderDocument(documentId: string, to?: string) {
  const document = (await OrderDocument.findById(documentId).select("+pdf.data").lean()) as
    | (StoredDocument & { pdf?: { data?: Buffer } })
    | null;
  if (!document) throw new AppError("Document not found", 404);
  const recipient = to?.trim().toLowerCase() || document.customerEmail;
  if (!recipient) throw new AppError("Customer email is unavailable", 409);
  const variables = {
    documentNumber: document.documentNumber,
    documentType: title(document.type),
    orderNumber: document.orderNumber,
  };
  await enqueueNotification({
    channel: "email",
    deduplicate: false,
    eventType: "invoice_available",
    fallback: {
      attachments: document.pdf?.data
        ? [
            {
              content: Buffer.from(document.pdf.data),
              filename: `${document.documentNumber.replace(/\//g, "-")}.pdf`,
              mimeType: "application/pdf",
            },
          ]
        : undefined,
      subject: `${variables.documentType}: ${document.documentNumber}`,
      text: `Your ${variables.documentType} ${document.documentNumber} for order ${document.orderNumber} is ready in your account.`,
    },
    relatedEntity: { id: String(document._id), type: "order-document" },
    to: recipient,
    variables,
  });
  return document;
}

export async function nextDocumentNumber(type: DocumentType, financialYear: string) {
  const key = `${type}:${financialYear}`;
  const sequence = await DocumentSequence.findOneAndUpdate(
    { key },
    { $inc: { value: 1 }, $setOnInsert: { key } },
    { new: true, upsert: true },
  );
  if (!sequence) throw new AppError("Document sequence could not be allocated", 500);
  return `${await documentPrefix(type)}/${financialYear}/${String(sequence.value).padStart(6, "0")}`;
}

export function financialYearFor(date: Date) {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export async function renderDocumentPdf(snapshot: PdfSnapshot) {
  if (isTestRuntime()) return Buffer.from(`%PDF-TEST ${snapshot.documentNumber}`);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(renderHtml(snapshot), { waitUntil: "domcontentloaded" });
    const bytes = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(bytes);
  } finally {
    await browser.close();
  }
}

/**
 * GST invoice layout: supplier and buyer blocks (buyer GSTIN for B2B), place of supply,
 * HSN-wise lines, CGST+SGST for intra-state supplies or IGST for inter-state, charges,
 * discounts, credits applied and payment terms. Shared by every document type.
 */
export function renderHtml(value: PdfSnapshot) {
  const money = (amount: unknown) => formatMoney(Number(amount ?? 0), value.currencyCode);
  const buyer = (value.metadata ?? {}) as {
    buyerGstin?: string;
    buyerBusinessName?: string;
    paymentTerms?: string;
    dueAt?: string | Date;
  };
  const billing = (value.billingAddress ?? value.shippingAddress ?? {}) as AddressSnapshot;
  const shipping = (value.shippingAddress ?? {}) as AddressSnapshot;
  const placeOfSupply = billing.region || shipping.region || "";
  const intraState =
    Boolean(value.company.state) &&
    placeOfSupply.trim().toLowerCase() === String(value.company.state).trim().toLowerCase();
  const lines = value.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.productName)}</td><td>${escapeHtml(line.sku)}</td><td>${escapeHtml(line.hsnCode ?? "-")}</td><td class="n">${line.quantity}</td><td class="n">${money(line.unitPrice)}</td><td class="n">${line.gstRate}%</td><td class="n">${money(line.lineTotal)}</td></tr>`,
    )
    .join("");
  const taxRows = (
    (value.taxBreakdown ?? []) as Array<{
      gstRate: number;
      taxableAmount: number;
      gstAmount: number;
    }>
  )
    .map((row) =>
      intraState
        ? `<tr><td>${row.gstRate}%</td><td class="n">${money(row.taxableAmount)}</td><td class="n">${money(row.gstAmount / 2)}</td><td class="n">${money(row.gstAmount / 2)}</td><td class="n">-</td></tr>`
        : `<tr><td>${row.gstRate}%</td><td class="n">${money(row.taxableAmount)}</td><td class="n">-</td><td class="n">-</td><td class="n">${money(row.gstAmount)}</td></tr>`,
    )
    .join("");
  const totals = value.totals as Record<string, number>;
  const summary = [
    ["Items (incl. GST)", totals.itemSubtotal],
    ["Discount", totals.discountTotal ? -totals.discountTotal : 0],
    ["Shipping", totals.shippingFee],
    ["Gift packaging", totals.giftPackagingFee],
    ["Paid by gift card", totals.giftCardDiscount ? -totals.giftCardDiscount : 0],
    ["Paid by store credit", totals.storeCreditApplied ? -totals.storeCreditApplied : 0],
    ["Paid by reward points", totals.rewardValueApplied ? -totals.rewardValueApplied : 0],
  ]
    .filter(([, amount]) => Number(amount))
    .map(([label, amount]) => `<tr><td>${label}</td><td class="n">${money(amount)}</td></tr>`)
    .join("");
  const address = (entry: AddressSnapshot) =>
    [
      entry.fullName,
      entry.company,
      entry.line1,
      entry.line2,
      [entry.city, entry.region, entry.postalCode].filter(Boolean).join(", "),
      entry.phone,
    ]
      .filter(Boolean)
      .map((part) => escapeHtml(String(part)))
      .join("<br>");

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font:12px Arial;color:#2c231d;padding:28px}header{border-bottom:3px solid #8b1e2d;margin-bottom:18px;padding-bottom:12px;display:flex;justify-content:space-between}h1{color:#8b1e2d;margin:0}h2{margin:0 0 8px}table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f6f3ee}.n{text-align:right}.grid{display:flex;gap:24px}.grid>div{flex:1}.total{font-size:15px;font-weight:bold}.muted{color:#6b625a}</style></head><body>
<header><div><h1>${escapeHtml(value.company.name)}</h1><p>${escapeHtml(value.company.address)}<br>GSTIN: ${escapeHtml(value.company.gstin || "Not configured")}${value.company.email ? `<br>${escapeHtml(value.company.email)}` : ""}</p></div><div style="text-align:right"><h2>${title(value.type)}</h2><p><strong>No.</strong> ${escapeHtml(value.documentNumber)}<br><strong>Date:</strong> ${new Date(value.issuedAt).toLocaleDateString("en-IN")}<br><strong>Order:</strong> ${escapeHtml(value.orderNumber)}</p></div></header>
<div class="grid"><div><strong>Bill to</strong><br>${buyer.buyerBusinessName ? `${escapeHtml(buyer.buyerBusinessName)}<br>` : ""}${address(billing)}${buyer.buyerGstin ? `<br>GSTIN: ${escapeHtml(buyer.buyerGstin)}` : ""}${value.customerEmail ? `<br>${escapeHtml(value.customerEmail)}` : ""}</div><div><strong>Ship to</strong><br>${address(shipping)}</div><div><strong>Place of supply</strong><br>${escapeHtml(placeOfSupply || "-")}<br><span class="muted">${intraState ? "Intra-state supply (CGST + SGST)" : "Inter-state supply (IGST)"}</span>${buyer.paymentTerms ? `<br><strong>Payment terms:</strong> ${escapeHtml(String(buyer.paymentTerms).replace("_", " ").toUpperCase())}` : ""}${buyer.dueAt ? `<br><strong>Due:</strong> ${new Date(buyer.dueAt).toLocaleDateString("en-IN")}` : ""}</div></div>
<table><thead><tr><th>Item</th><th>SKU</th><th>HSN</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th></tr></thead><tbody>${lines}</tbody></table>
${taxRows ? `<table><thead><tr><th>GST rate</th><th class="n">Taxable value</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">IGST</th></tr></thead><tbody>${taxRows}</tbody></table>` : ""}
<table style="width:50%;margin-left:50%"><tbody>${summary}<tr><td class="total">Grand total</td><td class="n total">${money(value.totals.grandTotal)}</td></tr></tbody></table>
<p class="muted">Prices are inclusive of GST. This is a computer-generated document.</p></body></html>`;
}

async function accountEmail(userId: unknown) {
  if (!userId) return undefined;
  const { User } = await import("../models/User.js");
  const user = (await User.findById(userId).select("email").lean()) as unknown as {
    email?: string;
  } | null;
  return user?.email;
}

async function buyerSnapshot(order: OrderSnapshot) {
  const record = order as unknown as {
    userId?: unknown;
    customerType?: string;
    paymentTerms?: string;
    paymentSessionId?: unknown;
  };
  if (record.customerType !== "wholesale" || !record.userId) {
    return {};
  }
  const { User } = await import("../models/User.js");
  const { PaymentSession } = await import("../models/PaymentSession.js");
  const [user, session] = await Promise.all([
    User.findById(record.userId).select("wholesaleProfile").lean() as unknown as Promise<{
      wholesaleProfile?: { gstin?: string; businessName?: string };
    } | null>,
    record.paymentSessionId
      ? (PaymentSession.findById(record.paymentSessionId)
          .select("dueAt")
          .lean() as unknown as Promise<{ dueAt?: Date } | null>)
      : Promise.resolve(null),
  ]);
  return {
    buyerBusinessName: user?.wholesaleProfile?.businessName,
    buyerGstin: user?.wholesaleProfile?.gstin,
    dueAt: session?.dueAt,
    paymentTerms: record.paymentTerms,
  };
}

async function companySnapshot() {
  return {
    address: (await getRuntimeSetting("COMPANY_ADDRESS")) ?? env.COMPANY_ADDRESS,
    email: (await getRuntimeSetting("COMPANY_EMAIL")) || env.COMPANY_EMAIL || env.SMTP_FROM_EMAIL,
    gstin: (await getRuntimeSetting("COMPANY_GSTIN")) ?? env.COMPANY_GSTIN,
    name: (await getRuntimeSetting("COMPANY_NAME")) ?? env.COMPANY_NAME,
    state: (await getRuntimeSetting("COMPANY_STATE")) ?? env.COMPANY_STATE,
  };
}

async function documentPrefix(type: DocumentType) {
  const defaults = {
    tax_invoice: "INV",
    proforma_invoice: "PRO",
    receipt: "RCT",
    credit_note: "CN",
    debit_note: "DN",
    delivery_challan: "DC",
    return_invoice: "RET",
  } as const;
  const key = `DOCUMENT_PREFIX_${type.toUpperCase()}`;
  return (await getRuntimeSetting(key)) || defaults[type];
}
function title(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function money(value: number) {
  return Math.round(value * 100) / 100;
}
function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(value);
}
function escapeHtml(value: string) {
  return String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char,
  );
}
function isTestRuntime() {
  return (
    env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.env.npm_lifecycle_event === "test"
  );
}
