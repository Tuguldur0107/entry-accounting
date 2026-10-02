import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeTaxSales,
  taxReceiptKindOf,
  taxSaleMatchOf,
  taxSalesBackfillNeeded,
  type EbarimtTaxSaleRow,
} from "../lib/ebarimt/tax-sales";

test("ТЕГ-ийн баримтын төрөл: нэхэмжлэх > төлөлт > ААН > иргэн", () => {
  assert.equal(taxReceiptKindOf({ isInvoice: true, parentDdtd: null, buyerRegNo: "1234567" }), "invoice");
  assert.equal(taxReceiptKindOf({ isInvoice: false, parentDdtd: "D3", buyerRegNo: "1234567" }), "payment");
  assert.equal(taxReceiptKindOf({ isInvoice: false, parentDdtd: null, buyerRegNo: "00000543***" }), "b2b", "далдлагдсан регистр");
  assert.equal(taxReceiptKindOf({ isInvoice: false, parentDdtd: null, buyerRegNo: " " }), "b2c");
});

test("Entry-тэй тулгалт: төлөлтийн submission > POS > АР > гар ДДТД; эс бөгөөс Entry-д алга", () => {
  const none = { submissionKind: null, submissionSaleId: null, submissionArapId: null, manualSaleId: null };
  assert.equal(taxSaleMatchOf(none), null);
  assert.equal(taxSaleMatchOf({ ...none, submissionKind: "payment", submissionArapId: "a" }), "payment");
  assert.equal(taxSaleMatchOf({ ...none, submissionKind: "send", submissionSaleId: "s" }), "pos");
  assert.equal(taxSaleMatchOf({ ...none, submissionKind: "cancel", submissionSaleId: "s" }), "pos");
  assert.equal(taxSaleMatchOf({ ...none, submissionKind: "send", submissionArapId: "a" }), "arap");
  assert.equal(taxSaleMatchOf({ ...none, manualSaleId: "s" }), "pos");
});

test("Хураангуй: нэхэмжлэхийн төлөлт борлуулалтын нийлбэрт давхар орохгүй, Entry-д алга тоологдоно", () => {
  const row = (partial: Partial<EbarimtTaxSaleRow>): EbarimtTaxSaleRow => ({
    ddtd: "D",
    taxDate: "2026-10-01",
    receiptDate: "2026-10-01",
    kind: "b2c",
    parentDdtd: null,
    buyerRegNo: "",
    buyerName: "",
    posNo: "",
    total: 0,
    vat: 0,
    cityTax: 0,
    match: null,
    entryDocumentNo: null,
    saleId: null,
    arapDocumentId: null,
    ...partial,
  });
  const summary = summarizeTaxSales([
    row({ ddtd: "D1", kind: "b2c", total: 1_100, vat: 100, match: "pos" }),
    row({ ddtd: "D2", kind: "b2b", total: 5_000 }),
    row({ ddtd: "D3", kind: "invoice", total: 2_200, vat: 200, cityTax: 20, match: "arap" }),
    row({ ddtd: "D4", kind: "payment", total: 2_200, vat: 200, match: "payment" }),
  ]);
  assert.equal(summary.count, 4);
  assert.equal(summary.total, 8_300);
  assert.equal(summary.vat, 300);
  assert.equal(summary.cityTax, 20);
  assert.equal(summary.unmatched, 1);
  assert.equal(summary.unmatchedTotal, 5_000);
  assert.deepEqual(summary.byKind, { invoice: 1, payment: 1, b2b: 1, b2c: 1 });
});

test("Хуучин холболт (allReceiptsFrom null) бүх баримтыг эхнээс дахин татна", () => {
  assert.equal(taxSalesBackfillNeeded({ allReceiptsFrom: null }), true);
  assert.equal(taxSalesBackfillNeeded({ allReceiptsFrom: "2026-09-01" }), false);
});
