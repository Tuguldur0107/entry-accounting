// Хуулгын нэхэмжлэх үүсгэх мөрийн харьцах дансны санал
// (lib/cash/bank-row-preview.ts) — ЦЭВЭР.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceAccountHints,
  fillInvoiceCounterAccounts,
  mainAccountOfCode,
  suggestInvoiceCounterAccount,
} from "../lib/cash/bank-row-preview";
import type { ParsedBankStatementRow } from "../lib/cash/bank-statement-types";

const code = (main: string) => `000.000000.${main}.00.0000.0.0.CA.0.0`;
const row = (patch: Partial<ParsedBankStatementRow>): ParsedBankStatementRow => ({
  id: "r1",
  rowNumber: 1,
  transactionDate: "2026-09-22",
  description: "Борлуулалт",
  counterparty: "Наранлайф стайл",
  counterAccount: "",
  income: 220_000,
  expense: 0,
  exchangeRate: 1,
  baseAmount: 220_000,
  debitAccountNumber: code("11000001"),
  creditAccountNumber: code("51100000"),
  rawData: {},
  ...patch,
});
test("mainAccountOfCode: бүтэн код ба үндсэн данс", () => {
  assert.equal(mainAccountOfCode(code("51100000")), "51100000");
  assert.equal(mainAccountOfCode("000.000000..00.0000.0.0.CA.0.0"), "");
  assert.equal(mainAccountOfCode("51100000"), "51100000");
  assert.equal(mainAccountOfCode(null), "");
});

test("харьцах дансны санал: харилцагчийн сүүлийн нэхэмжлэх → байгууллагын давамгай орлого; НӨАТ алгасна", () => {
  const hints = buildInvoiceAccountHints(
    [
      { counterpartyId: "c1", documentType: "ar_invoice", accountNumber: code("31410000") },
      { counterpartyId: "c1", documentType: "ar_invoice", accountNumber: code("51200000") },
      { counterpartyId: "c2", documentType: "ar_invoice", accountNumber: "51100000" },
      { counterpartyId: "c3", documentType: "ar_invoice", accountNumber: "51100000" },
      { counterpartyId: "c1", documentType: "ar_invoice", accountNumber: "51100000" },
      { counterpartyId: "s1", documentType: "ap_bill", accountNumber: "73100001" },
    ],
    ["31410000", "13620000"]
  );
  assert.equal(hints.ar.c1, "51200000"); // хамгийн сүүлийнх (эхэнд ирсэн), НӨАТ биш
  assert.equal(hints.arDefault, "51100000");
  assert.equal(suggestInvoiceCounterAccount(hints, "ar_invoice", "c1"), "51200000");
  assert.equal(suggestInvoiceCounterAccount(hints, "ar_invoice", "new"), "51100000");
  assert.equal(suggestInvoiceCounterAccount(hints, "ap_bill", "s1"), "73100001");
  // Зардалд байгууллагын default ЗОХИОХГҮЙ.
  assert.equal(suggestInvoiceCounterAccount(hints, "ap_bill", "new"), null);
  assert.equal(suggestInvoiceCounterAccount(null, "ar_invoice", "c1"), null);
});

test("fillInvoiceCounterAccounts: зөвхөн хоосон харьцах талтай нэхэмжлэх үүсгэх мөр", () => {
  const hints = { ar: { c1: "51200000" }, ap: {}, arDefault: "51100000" };
  const blank = "000.000000..00.0000.0.0.CA.0.0";
  const rows = [
    row({ id: "a", rowAction: "create_ar_invoice", counterpartyId: "c1", creditAccountNumber: blank }),
    row({ id: "b", rowAction: "create_ar_invoice", counterpartyId: "c1" }), // гараар сонгосон
    row({ id: "c", rowAction: null, creditAccountNumber: blank }),
  ];
  const filled = fillInvoiceCounterAccounts(rows, hints, code);
  assert.equal(filled[0].creditAccountNumber, code("51200000"));
  assert.equal(filled[1], rows[1]);
  assert.equal(filled[2], rows[2]);
  const untouched = [rows[1], rows[2]];
  assert.equal(fillInvoiceCounterAccounts(untouched, hints, code), untouched);
});
