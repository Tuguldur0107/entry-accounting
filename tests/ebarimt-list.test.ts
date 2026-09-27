import test from "node:test";
import assert from "node:assert/strict";

import { signedAmount, summarizeEbarimtRows, type EbarimtDocumentRow } from "../lib/ebarimt/list-types";

function row(partial: Partial<EbarimtDocumentRow>): EbarimtDocumentRow {
  return {
    key: "pos:1",
    source: "pos",
    id: "1",
    documentNo: "POS-2609-0001",
    date: "2026-09-10",
    counterpartyName: null,
    customerTin: null,
    isReturn: false,
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

test("хураангуй: дүн ЗӨВХӨН илгээгдсэнээс, буцаалт хасагдана, анхаарах = алдаатай + илгээгээгүй + хүлээгдэж буй", () => {
  const summary = summarizeEbarimtRows([
    row({}),
    row({ source: "arap", total: 1_100_000, vat: 100_000, ebarimtType: "B2B_INVOICE" }),
    row({ isReturn: true, total: signedAmount(true, 5_500), vat: signedAmount(true, 500) }),
    row({ status: "failed", total: 99_999, vat: 9_999, lastError: "[EBARIMT_*] ТТД" }),
    row({ status: "skipped", total: 1 }),
    row({ status: "pending", total: 1 }),
    row({ status: "cancelled", total: 7_700, vat: 700 }),
  ]);
  assert.equal(summary.count, 7);
  assert.equal(summary.sentTotal, 11_000 + 1_100_000 - 5_500);
  assert.equal(summary.sentVat, 1_000 + 100_000 - 500);
  assert.equal(summary.attention, 3);
  assert.deepEqual(summary.byStatus, { sent: 3, failed: 1, skipped: 1, pending: 1, cancelled: 1 });
});

test("хоосон жагсаалт → тэг", () => {
  assert.deepEqual(summarizeEbarimtRows([]), {
    count: 0,
    byStatus: {},
    sentTotal: 0,
    sentVat: 0,
    sentCityTax: 0,
    attention: 0,
  });
});
