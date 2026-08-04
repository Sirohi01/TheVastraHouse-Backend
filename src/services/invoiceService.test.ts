import assert from "node:assert/strict";
import test from "node:test";
import { DocumentSequence } from "../models/DocumentSequence.js";
import { financialYearFor, nextDocumentNumber, renderDocumentPdf } from "./invoiceService.js";

test("financial year switches on April 1 in UTC", () => {
  assert.equal(financialYearFor(new Date("2026-03-31T23:59:59.000Z")), "25-26");
  assert.equal(financialYearFor(new Date("2026-04-01T00:00:00.000Z")), "26-27");
});

test("document numbering uses an atomic financial-year sequence", async (t) => {
  const original = DocumentSequence.findOneAndUpdate;
  let value = 0;
  (DocumentSequence as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = () =>
    Promise.resolve({ value: ++value });
  t.after(() => {
    (DocumentSequence as unknown as { findOneAndUpdate: unknown }).findOneAndUpdate = original;
  });

  assert.equal(await nextDocumentNumber("tax_invoice", "26-27"), "INV/26-27/000001");
  assert.equal(await nextDocumentNumber("tax_invoice", "26-27"), "INV/26-27/000002");
});

test("invoice renderer produces PDF bytes in test runtime", async () => {
  const pdf = await renderDocumentPdf({
    company: { address: "Delhi", email: "care@test.invalid", gstin: "", name: "TVH" },
    currencyCode: "INR",
    documentNumber: "INV/26-27/000001",
    issuedAt: new Date(),
    lines: [{ gstRate: 5, lineTotal: 999, productName: "Kurti", quantity: 1, sku: "K-1", unitPrice: 999 }],
    orderNumber: "TVH-1",
    totals: { grandTotal: 999 },
    type: "tax_invoice",
  });
  assert.ok(pdf.subarray(0, 4).toString().startsWith("%PDF"));
});
