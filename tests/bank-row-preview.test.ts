// Хуулгын нэхэмжлэх үүсгэх мөрийн харьцах дансны санал
// (lib/cash/bank-row-preview.ts) — ЦЭВЭР.

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceAccountHints,
  fillInvoiceCounterAccounts,
  linkStatementCounterparties,
  mainAccountOfCode,
  matchCounterpartyByAccount,
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
  // Түүхгүй шинэ ханган нийлүүлэгчид байгууллагын хамгийн их хэрэглэсэн зардлын данс
  // (product owner 2026-10-02).
  assert.equal(hints.apDefault, "73100001");
  assert.equal(suggestInvoiceCounterAccount(hints, "ap_bill", "new"), "73100001");
  assert.equal(suggestInvoiceCounterAccount(null, "ar_invoice", "c1"), null);
});

test("fillInvoiceCounterAccounts: зөвхөн хоосон харьцах талтай нэхэмжлэх үүсгэх мөр", () => {
  const hints = { ar: { c1: "51200000" }, ap: {}, arDefault: "51100000", apDefault: null };
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

const MASTERS = [
  { id: "s1", name: "Бат-Эрдэнэ ХХК", bankAccountNo: "5012 3456 78" },
  { id: "s2", name: "Наранлайф стайл", bankAccountNo: null },
  { id: "s3", name: "Давхар нэр", bankAccountNo: null },
  { id: "s4", name: "давхар  НЭР", bankAccountNo: null },
];

test("matchCounterpartyByAccount: данс эсвэл IBAN-ий төгсгөлөөр ГАНЦ таарвал", () => {
  assert.equal(matchCounterpartyByAccount("5012345678", MASTERS)?.id, "s1");
  assert.equal(matchCounterpartyByAccount("MN12 0005 0050 1234 5678", MASTERS)?.id, "s1");
  assert.equal(matchCounterpartyByAccount("1234", MASTERS), null); // хэт богино
  assert.equal(matchCounterpartyByAccount("", MASTERS), null);
  const twice = [...MASTERS, { id: "s5", name: "Өөр", bankAccountNo: "5012345678" }];
  assert.equal(matchCounterpartyByAccount("5012345678", twice), null); // олон — таамаглахгүй
});

test("linkStatementCounterparties: данс → ЯГ нэр, сонгосон / таараагүйг хөндөхгүй", () => {
  const rows = [
    row({ id: "a", counterparty: "БАТ-ЭРДЭНЭ", counterAccount: "5012345678" }), // дансаар
    row({ id: "b", counterparty: "НАРАНЛАЙФ  СТАЙЛ", counterAccount: "" }), // нэрээр (том үсэг)
    row({ id: "c", counterparty: "Давхар нэр" }), // олон таарсан
    row({ id: "d", counterparty: "Наранлайф", counterpartyId: null }), // ЯГ биш
    row({ id: "e", counterparty: "Наранлайф стайл", counterpartyId: "s1" }), // аль хэдийн сонгосон
  ];
  const linked = linkStatementCounterparties(rows, MASTERS);
  assert.equal(linked[0].counterpartyId, "s1");
  assert.equal(linked[0].counterparty, "Бат-Эрдэнэ ХХК");
  assert.equal(linked[1].counterpartyId, "s2");
  assert.equal(linked[2], rows[2]);
  assert.equal(linked[3], rows[3]);
  assert.equal(linked[4], rows[4]);
  const none = [rows[2], rows[3]];
  assert.equal(linkStatementCounterparties(none, MASTERS), none);
  assert.equal(linkStatementCounterparties(rows, undefined), rows);
});

test("холбосон харилцагчийн өмнөх нэхэмжлэхээс зардлын данс бөглөгдөнө", () => {
  const hints = { ar: {}, ap: { s1: "73100001" }, arDefault: null, apDefault: "72000000" };
  const blank = "000.000000..00.0000.0.0.CA.0.0";
  const rows = [
    row({
      id: "a",
      income: 0,
      expense: 50_000,
      counterparty: "БАТ-ЭРДЭНЭ",
      counterAccount: "5012345678",
      rowAction: "create_ap_bill",
      debitAccountNumber: blank,
    }),
  ];
  const filled = fillInvoiceCounterAccounts(linkStatementCounterparties(rows, MASTERS), hints, code);
  assert.equal(filled[0].counterpartyId, "s1");
  assert.equal(filled[0].debitAccountNumber, code("73100001"));
});

test("apDefault: олон ханган нийлүүлэгчийн хамгийн их хэрэглэсэн зардлын данс, түүхгүй бол null", () => {
  const hints = buildInvoiceAccountHints(
    [
      { counterpartyId: "s1", documentType: "ap_bill", accountNumber: "72500000" },
      { counterpartyId: "s1", documentType: "ap_bill", accountNumber: "13620000" }, // НӨАТ
      { counterpartyId: "s2", documentType: "ap_bill", accountNumber: "73100001" },
      { counterpartyId: "s3", documentType: "ap_bill", accountNumber: "73100001" },
    ],
    ["31410000", "13620000"]
  );
  assert.equal(hints.ap.s1, "72500000"); // харилцагчийн өөрийнх давуу
  assert.equal(hints.apDefault, "73100001");
  assert.equal(suggestInvoiceCounterAccount(hints, "ap_bill", "s1"), "72500000");
  assert.equal(suggestInvoiceCounterAccount(hints, "ap_bill", "new"), "73100001");
  assert.equal(buildInvoiceAccountHints([], []).apDefault, null);
});
