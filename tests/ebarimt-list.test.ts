import test from "node:test";
import assert from "node:assert/strict";

import { EBARIMT_RECEIPT_TYPES, EBARIMT_RECEIPT_TYPE_LABELS } from "../lib/ebarimt/constants";
import {
  canResendCorrection,
  ebarimtTypeLabel,
  posEbarimtCorrection,
  isAttentionRow,
  reportedAmounts,
  summarizeEbarimtRows,
  totalAmounts,
  type EbarimtDocumentRow,
} from "../lib/ebarimt/list-types";

function row(partial: Partial<EbarimtDocumentRow>): EbarimtDocumentRow {
  return {
    key: "pos:1",
    source: "pos",
    id: "1",
    documentNo: "POS-2609-0001",
    date: "2026-09-10",
    counterpartyName: null,
    customerTin: null,
    partiallyReturned: false,
    correction: null,
    ebarimtType: "B2C_RECEIPT",
    status: "sent",
    ebarimtId: "0".repeat(33),
    ebarimtDate: "2026-09-10 12:00:00",
    total: 11_000,
    vat: 1_000,
    cityTax: 0,
    lastError: null,
    ...partial,
  };
}

test("хураангуй: ТЕГ-д бүртгэлтэй = sent + manual; цуцлагдсан/алдаатай/хүлээгдэж буй дүнд орохгүй", () => {
  const summary = summarizeEbarimtRows([
    row({}),
    row({ source: "arap", total: 1_100_000, vat: 100_000, ebarimtType: "B2B_INVOICE" }),
    // Хэсэгчлэн буцаасан — дүн нь буцаалтын дараах засварын баримтынх (loader өгнө).
    row({ partiallyReturned: true, total: 5_500, vat: 500 }),
    row({ status: "manual", total: 2_200, vat: 200 }),
    row({ status: "failed", total: 99_999, vat: 9_999, lastError: "[EBARIMT_*] ТТД" }),
    row({ status: "skipped", total: 1 }),
    row({ status: "pending", total: 1 }),
    row({ status: "cancelled", total: 7_700, vat: 700 }),
  ]);
  assert.equal(summary.count, 8);
  assert.deepEqual(summary.reported, {
    count: 4,
    total: 11_000 + 1_100_000 + 5_500 + 2_200,
    vat: 1_000 + 100_000 + 500 + 200,
    cityTax: 0,
  });
  assert.equal(summary.attention, 3);
  assert.deepEqual(summary.byStatus, { sent: 3, manual: 1, failed: 1, skipped: 1, pending: 1, cancelled: 1 });
});

test("хөл дүн = reportedAmounts — хураангуйтай НЭГ дүрэм; хоосон → тэг", () => {
  const rows = [row({}), row({ status: "cancelled", total: 110_000, vat: 10_000 })];
  assert.deepEqual(reportedAmounts(rows), summarizeEbarimtRows(rows).reported);
  assert.deepEqual(summarizeEbarimtRows([]), {
    count: 0,
    byStatus: {},
    reported: { count: 0, total: 0, vat: 0, cityTax: 0 },
    attention: 0,
  });
});

test("баримтын төрлийн шошго НЭГ эх (constants.ts), үл мэдэгдэх код хэвээр", () => {
  for (const type of EBARIMT_RECEIPT_TYPES) assert.equal(ebarimtTypeLabel(type), EBARIMT_RECEIPT_TYPE_LABELS[type]);
  assert.equal(ebarimtTypeLabel("NEW_TYPE"), "NEW_TYPE");
  assert.equal(ebarimtTypeLabel(null), "");
});

test("засвар дуусаагүй мөр «Анхаарах»-д (төлөв нь sent/manual ч); хөл дүн = бүх харагдаж буй + ТЕГ-д бүртгэлтэй", () => {
  const rows = [
    row({}),
    row({ partiallyReturned: true, correction: "failed", total: 3_300, vat: 300 }),
    row({ status: "manual", correction: "manual", total: 2_200, vat: 200 }),
    row({ status: "failed", total: 5_000, vat: 500 }),
  ];
  assert.deepEqual(rows.map(isAttentionRow), [false, true, true, true]);
  const summary = summarizeEbarimtRows(rows);
  assert.equal(summary.attention, 3);
  // ТЕГ-д одоо бүртгэлтэй — засвар очоогүй мөрийн хуучин (ТЕГ дахь) дүн ОРНО.
  assert.equal(summary.reported.total, 11_000 + 3_300 + 2_200);
  assert.deepEqual(totalAmounts(rows), { count: 4, total: 11_000 + 3_300 + 2_200 + 5_000, vat: 1_000 + 300 + 200 + 500, cityTax: 0 });
});

test("ТЕГ ↔ Entry тулгалт: тэмдэг түрүүлнэ; зөрвөл mismatch/manual; 1₮ тэвчээр; хуучин өгөгдөл unknown", () => {
  const base = { ebarimtStatus: "sent", saleStatus: "posted", flag: null, registeredTotal: 3_300, remainingTotal: 3_300 };
  assert.equal(posEbarimtCorrection(base), null);
  assert.equal(posEbarimtCorrection({ ...base, flag: "pending", remainingTotal: 2_200 }), "pending");
  assert.equal(posEbarimtCorrection({ ...base, flag: "failed" }), "failed");
  // eBarimt унтраалттай үед буцаасан — тэмдэггүй ч ТЕГ 3,300 ≠ Entry 2,200
  assert.equal(posEbarimtCorrection({ ...base, saleStatus: "partially_returned", remainingTotal: 2_200 }), "mismatch");
  assert.equal(posEbarimtCorrection({ ...base, remainingTotal: 3_299.5 }), null, "бутархай бөөрөнхийлөлт");
  assert.equal(posEbarimtCorrection({ ...base, ebarimtStatus: "manual", saleStatus: "returned", remainingTotal: 0 }), "manual");
  assert.equal(posEbarimtCorrection({ ...base, ebarimtStatus: "manual", registeredTotal: null, saleStatus: "partially_returned", remainingTotal: 1 }), "manual");
  assert.equal(posEbarimtCorrection({ ...base, registeredTotal: null, saleStatus: "partially_returned", remainingTotal: 1_100 }), "unknown");
  assert.equal(posEbarimtCorrection({ ...base, registeredTotal: null }), null);
  assert.equal(posEbarimtCorrection({ ...base, ebarimtStatus: "cancelled", registeredTotal: 0, remainingTotal: 0 }), null);
  assert.equal(posEbarimtCorrection({ ...base, ebarimtStatus: "cancelled", registeredTotal: 0, remainingTotal: 1_100 }), "mismatch");
  assert.equal(posEbarimtCorrection({ ...base, ebarimtStatus: "failed", remainingTotal: 0 }), null, "илгээгээгүй — засах зүйлгүй");
  assert.deepEqual(
    (["pending", "failed", "mismatch", "manual", "unknown", null] as const).map(canResendCorrection),
    [false, true, true, false, false, false]
  );
});
