// Банкны хуулгын мөрийн бичилтийн урьдчилсан харагдац ба харьцах дансны санал
// (lib/cash/bank-row-preview.ts) — ЦЭВЭР.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceAccountHints,
  fillInvoiceCounterAccounts,
  mainAccountOfCode,
  previewBankRowPostings,
  suggestInvoiceCounterAccount,
  type PreviewContext,
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
const context: PreviewContext = {
  vat: { isVatPayer: true, vatRatePercent: 10, outputVatAccountNumber: "31410000", inputVatAccountNumber: "13620000" },
  counterparties: [
    { id: "c1", name: "Наранлайф стайл", defaultReceivableAccountNumber: "12000001" },
    { id: "s1", name: "Түрээслүүлэгч" },
  ],
  defaultControl: { receivable: "13110000", payable: "31000001" },
};
const simple = (lines: { voucher: string; account: string; debit: number; credit: number }[]) =>
  lines.map((line) => [line.voucher, line.account, line.debit, line.credit]);

test("mainAccountOfCode: бүтэн код ба үндсэн данс", () => {
  assert.equal(mainAccountOfCode(code("51100000")), "51100000");
  assert.equal(mainAccountOfCode("000.000000..00.0000.0.0.CA.0.0"), "");
  assert.equal(mainAccountOfCode("51100000"), "51100000");
  assert.equal(mainAccountOfCode(null), "");
});

test("борлуулалт: авлагын нэхэмжлэх (НӨАТ 10/110) + банкаар хаах — харилцагчийн хяналтын данс", () => {
  const preview = previewBankRowPostings(
    row({ rowAction: "create_ar_invoice", counterpartyId: "c1" }),
    context
  );
  assert.deepEqual(preview.notes, []);
  assert.deepEqual(simple(preview.lines), [
    ["Борлуулалтын нэхэмжлэх", "12000001", 220_000, 0],
    ["Борлуулалтын нэхэмжлэх", "51100000", 0, 200_000],
    ["Борлуулалтын нэхэмжлэх", "31410000", 0, 20_000],
    ["Банкны гүйлгээ", "11000001", 220_000, 0],
    ["Банкны гүйлгээ", "12000001", 0, 220_000],
  ]);
});

test("өглөг үүсгэж зардалд: default хяналтын данс, НӨАТ оролт; НӨАТ төлөгч бус бол НӨАТ-гүй", () => {
  const expense = row({
    income: 0,
    expense: 110_000,
    baseAmount: 110_000,
    debitAccountNumber: code("73100001"),
    creditAccountNumber: code("11000001"),
    rowAction: "create_ap_bill",
    counterpartyId: "s1",
  });
  assert.deepEqual(simple(previewBankRowPostings(expense, context).lines), [
    ["Өглөгийн нэхэмжлэх", "73100001", 100_000, 0],
    ["Өглөгийн нэхэмжлэх", "13620000", 10_000, 0],
    ["Өглөгийн нэхэмжлэх", "31000001", 0, 110_000],
    ["Банкны гүйлгээ", "31000001", 110_000, 0],
    ["Банкны гүйлгээ", "11000001", 0, 110_000],
  ]);
  const nonPayer = { ...context, vat: { ...context.vat!, isVatPayer: false } };
  assert.equal(previewBankRowPostings(expense, nonPayer).lines.length, 4);
});

test("дутуу мэдээлэл ил анхааруулга болно; энгийн мөр нь Дт банк / Кт харьцах тал", () => {
  const missing = previewBankRowPostings(
    row({ rowAction: "create_ar_invoice", counterpartyId: null, creditAccountNumber: "000.000000..00.0000.0.0.CA.0.0" }),
    context
  );
  assert.ok(missing.notes.some((note) => note.includes("Харилцагч")));
  assert.ok(missing.notes.some((note) => note.includes("Орлогын данс")));
  assert.deepEqual(simple(previewBankRowPostings(row({}), context).lines), [
    ["Банкны гүйлгээ", "11000001", 220_000, 0],
    ["Банкны гүйлгээ", "51100000", 0, 220_000],
  ]);
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
