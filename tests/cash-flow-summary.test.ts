import test from "node:test";
import assert from "node:assert/strict";

import { calculateCashFlowCodeSummary } from "../lib/cash/balances";
import type { CashDocument } from "../lib/db/schema";

function doc(overrides: Partial<CashDocument>): CashDocument {
  return {
    documentType: "receipt",
    date: "2026-08-10",
    status: "posted",
    amount: "100",
    baseAmount: "100",
    cashFlowCode: null,
    ...overrides,
  } as CashDocument;
}

const NAMES = new Map([
  ["OP01", "Борлуулалтын орлого"],
  ["FN01", "Зээлийн эргэн төлөлт"],
]);

test("кодоор бүлэглэж орлого/зарлага/цэврийг тусдаа тооцно", () => {
  const rows = calculateCashFlowCodeSummary(
    [
      doc({ cashFlowCode: "OP01", amount: "300", baseAmount: "300" }),
      doc({
        cashFlowCode: "OP01",
        documentType: "payment",
        amount: "120",
        baseAmount: "120",
      }),
      doc({ cashFlowCode: "FN01", amount: "50", baseAmount: "50" }),
    ],
    "2026-08-01",
    "2026-08-31",
    NAMES
  );
  assert.deepEqual(
    rows.map((r) => [r.code, r.name, r.receipts, r.payments, r.net]),
    [
      ["FN01", "Зээлийн эргэн төлөлт", 50, 0, 50],
      ["OP01", "Борлуулалтын орлого", 300, 120, 180],
    ]
  );
});

test("draft/reversed, шилжүүлэг, мужаас гаднах огноо орохгүй", () => {
  const rows = calculateCashFlowCodeSummary(
    [
      doc({ cashFlowCode: "OP01", status: "draft" }),
      doc({ cashFlowCode: "OP01", status: "reversed" }),
      doc({ cashFlowCode: "OP01", documentType: "transfer" }),
      doc({ cashFlowCode: "OP01", date: "2026-07-31" }),
      doc({ cashFlowCode: "OP01", date: "2026-09-01" }),
      doc({ cashFlowCode: "OP01", amount: "10", baseAmount: "10" }),
    ],
    "2026-08-01",
    "2026-08-31",
    NAMES
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receipts, 10);
  assert.equal(rows[0].documentCount, 1);
});

test("ангилалгүй мөр сүүлд, нэр lookup байхгүй код өөрөө нэр болно", () => {
  const rows = calculateCashFlowCodeSummary(
    [
      doc({ cashFlowCode: null, amount: "5", baseAmount: "5" }),
      doc({ cashFlowCode: "XX99", amount: "7", baseAmount: "7" }),
      doc({ cashFlowCode: "  ", amount: "3", baseAmount: "3" }),
    ],
    "2026-08-01",
    "2026-08-31",
    NAMES
  );
  assert.deepEqual(
    rows.map((r) => [r.code, r.name]),
    [
      ["XX99", "XX99"],
      [null, "Ангилалгүй"],
    ]
  );
  // null + хоосон string хоёулаа "Ангилалгүй"-д нэгтгэгдэнэ.
  assert.equal(rows[1].receipts, 8);
});

test("валюттай баримт baseAmount (MNT)-аар нэгтгэгдэнэ", () => {
  const rows = calculateCashFlowCodeSummary(
    [
      doc({
        cashFlowCode: "OP01",
        amount: "100",
        baseAmount: "345000",
      }),
    ],
    "2026-08-01",
    "2026-08-31",
    NAMES
  );
  assert.equal(rows[0].receipts, 345000);
});
