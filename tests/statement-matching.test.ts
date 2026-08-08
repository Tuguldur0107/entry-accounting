import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHistoricalPatterns,
  normalizeCounterpartyText,
  suggestMatches,
  type HistoricalPattern,
  type MatchableRow,
  type MatchContext,
  type OpenInvoiceRef,
} from "../lib/cash/statement-matching";

function row(overrides: Partial<MatchableRow>): MatchableRow {
  return {
    id: "row-1",
    income: 0,
    expense: 0,
    counterparty: "",
    description: "",
    ...overrides,
  };
}

function invoice(overrides: Partial<OpenInvoiceRef>): OpenInvoiceRef {
  return {
    id: "inv-1",
    documentNo: "AR-20260801-0001",
    counterpartyName: "Болор Трейд ХХК",
    totalAmount: 550_000,
    paidAmount: 0,
    documentType: "ar_invoice",
    controlAccountNumber:
      "000.000000.13110000.000.000.0000.00.000.AR.000000",
    ...overrides,
  };
}

function context(overrides: Partial<MatchContext>): MatchContext {
  return { openInvoices: [], historicalPatterns: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

test("normalization strips quotes, ХХК/LLC suffixes, case and extra spaces", () => {
  assert.equal(normalizeCounterpartyText('«Болор Трейд» ХХК'), "болор трейд");
  assert.equal(normalizeCounterpartyText("  BOLOR   TRADE LLC "), "bolor trade");
  assert.equal(normalizeCounterpartyText('"Хас" ХК'), "хас");
  assert.equal(normalizeCounterpartyText("Tavan Bogd Co., Ltd."), "tavan bogd");
  assert.equal(normalizeCounterpartyText(""), "");
});

// ---------------------------------------------------------------------------
// Invoice matching
// ---------------------------------------------------------------------------

test("amount + name match produces a high-confidence invoice suggestion", () => {
  const result = suggestMatches(
    [
      row({
        id: "r1",
        income: 550_000,
        counterparty: "БОЛОР ТРЕЙД ХХК",
        description: "Нэхэмжлэх төлөлт",
      }),
    ],
    context({
      openInvoices: [
        invoice({}),
        invoice({
          id: "inv-2",
          documentNo: "AR-20260801-0002",
          counterpartyName: "Өөр Компани ХХК",
          totalAmount: 550_000,
        }),
      ],
    })
  );
  const suggestionsForRow = result["r1"];
  assert.ok(suggestionsForRow);
  const top = suggestionsForRow[0];
  assert.equal(top.kind, "invoice");
  assert.equal(top.kind === "invoice" && top.invoiceId, "inv-1");
  assert.equal(top.confidence, "high");
  assert.equal(top.kind === "invoice" && top.reason, "amount_and_name");
});

test("name inside description (not counterparty field) still matches", () => {
  const result = suggestMatches(
    [
      row({
        id: "r1",
        income: 550_000,
        description: "EB болор трейд гүйлгээ 8899",
      }),
    ],
    context({ openInvoices: [invoice({})] })
  );
  assert.equal(result["r1"]?.[0]?.confidence, "high");
});

test("exact amount matching a SINGLE open invoice gives a medium suggestion", () => {
  // Үлдэгдэл = 550,000 − 100,000 = 450,000
  const result = suggestMatches(
    [row({ id: "r1", income: 450_000, counterparty: "Тодорхойгүй" })],
    context({ openInvoices: [invoice({ paidAmount: 100_000 })] })
  );
  const top = result["r1"]?.[0];
  assert.ok(top && top.kind === "invoice");
  assert.equal(top.confidence, "medium");
  assert.equal(top.reason, "amount_single");
  assert.equal(top.balance, 450_000);
});

test("ambiguous amount (two invoices, same balance, no name) → no invoice suggestion", () => {
  const result = suggestMatches(
    [row({ id: "r1", income: 550_000, counterparty: "Тодорхойгүй" })],
    context({
      openInvoices: [
        invoice({ counterpartyName: "Компани А" }),
        invoice({
          id: "inv-2",
          documentNo: "AR-20260801-0002",
          counterpartyName: "Компани Б",
        }),
      ],
    })
  );
  assert.equal(result["r1"], undefined);
});

test("income rows only match ar_invoice, expense rows only ap_bill", () => {
  const shared = {
    counterpartyName: "Болор Трейд ХХК",
    totalAmount: 550_000,
  };
  const result = suggestMatches(
    [
      row({ id: "in", income: 550_000, counterparty: "Болор Трейд" }),
      row({ id: "out", expense: 550_000, counterparty: "Болор Трейд" }),
    ],
    context({
      openInvoices: [
        invoice({ id: "ar", documentType: "ar_invoice", ...shared }),
        invoice({
          id: "ap",
          documentNo: "AP-20260801-0001",
          documentType: "ap_bill",
          ...shared,
        }),
      ],
    })
  );
  assert.equal(result["in"]?.[0].kind === "invoice" && result["in"][0].invoiceId, "ar");
  assert.equal(result["out"]?.[0].kind === "invoice" && result["out"][0].invoiceId, "ap");
});

test("amount tolerance of 0.01 is honored, beyond it no match", () => {
  const near = suggestMatches(
    [row({ id: "r1", income: 550_000.01, counterparty: "Болор Трейд" })],
    context({ openInvoices: [invoice({})] })
  );
  assert.equal(near["r1"]?.[0]?.kind, "invoice");

  const far = suggestMatches(
    [row({ id: "r1", income: 550_000.05, counterparty: "Болор Трейд" })],
    context({ openInvoices: [invoice({})] })
  );
  assert.equal(far["r1"], undefined);
});

// ---------------------------------------------------------------------------
// Historical pattern matching
// ---------------------------------------------------------------------------

const rentPattern: HistoricalPattern = {
  counterpartyText: "Оффис Түрээс ХХК",
  counterAccountNumber:
    "000.000000.73100001.000.000.0000.00.000.CA.000000",
  count: 4,
  side: "expense",
};

test("pattern seen >=2 times yields a medium account suggestion", () => {
  const result = suggestMatches(
    [
      row({
        id: "r1",
        expense: 1_200_000,
        counterparty: '"ОФФИС ТҮРЭЭС" ХХК',
      }),
    ],
    context({ historicalPatterns: [rentPattern] })
  );
  const top = result["r1"]?.[0];
  assert.ok(top && top.kind === "account");
  assert.equal(top.counterAccountNumber, rentPattern.counterAccountNumber);
  assert.equal(top.confidence, "medium");
  assert.equal(top.count, 4);
});

test("pattern seen only once is not suggested", () => {
  const result = suggestMatches(
    [row({ id: "r1", expense: 1_200_000, counterparty: "Оффис Түрээс ХХК" })],
    context({ historicalPatterns: [{ ...rentPattern, count: 1 }] })
  );
  assert.equal(result["r1"], undefined);
});

test("pattern side is respected — expense pattern does not fire on income row", () => {
  const result = suggestMatches(
    [row({ id: "r1", income: 1_200_000, counterparty: "Оффис Түрээс ХХК" })],
    context({ historicalPatterns: [rentPattern] })
  );
  assert.equal(result["r1"], undefined);
});

test("most frequent matching pattern wins", () => {
  const result = suggestMatches(
    [row({ id: "r1", expense: 500, counterparty: "Оффис Түрээс" })],
    context({
      historicalPatterns: [
        { ...rentPattern, count: 2, counterAccountNumber: "A" },
        { ...rentPattern, count: 7, counterAccountNumber: "B" },
      ],
    })
  );
  const top = result["r1"]?.[0];
  assert.ok(top && top.kind === "account");
  assert.equal(top.counterAccountNumber, "B");
});

test("invoice suggestion ranks ahead of pattern suggestion", () => {
  const result = suggestMatches(
    [
      row({
        id: "r1",
        expense: 550_000,
        counterparty: "Болор Трейд ХХК",
      }),
    ],
    context({
      openInvoices: [
        invoice({
          documentType: "ap_bill",
          documentNo: "AP-20260801-0009",
        }),
      ],
      historicalPatterns: [
        {
          counterpartyText: "Болор Трейд",
          counterAccountNumber: "X",
          count: 5,
          side: "expense",
        },
      ],
    })
  );
  const list = result["r1"];
  assert.ok(list && list.length === 2);
  assert.equal(list[0].kind, "invoice");
  assert.equal(list[1].kind, "account");
});

// ---------------------------------------------------------------------------
// buildHistoricalPatterns
// ---------------------------------------------------------------------------

test("buildHistoricalPatterns groups by normalized text + side + counter account", () => {
  const dr = "000.000000.73100001.000.000.0000.00.000.CA.000000";
  const bank = "000.000000.11000001.000.000.0000.00.000.CA.000000";
  const patterns = buildHistoricalPatterns([
    // Зарлага: банк кредит → харьцах данс нь дебет тал
    { counterparty: "Оффис Түрээс ХХК", income: 0, expense: 100, debitAccountNumber: dr, creditAccountNumber: bank },
    { counterparty: '«Оффис Түрээс» ХХК', income: 0, expense: 200, debitAccountNumber: dr, creditAccountNumber: bank },
    // Орлого: банк дебет → харьцах данс нь кредит тал
    { counterparty: "Оффис Түрээс ХХК", income: 300, expense: 0, debitAccountNumber: bank, creditAccountNumber: dr },
    // Харилцагчгүй мөр орохгүй
    { counterparty: null, income: 0, expense: 50, debitAccountNumber: dr, creditAccountNumber: bank },
    { counterparty: "  ", income: 0, expense: 50, debitAccountNumber: dr, creditAccountNumber: bank },
  ]);
  assert.equal(patterns.length, 2);
  const expensePattern = patterns.find((p) => p.side === "expense");
  assert.ok(expensePattern);
  assert.equal(expensePattern.count, 2);
  assert.equal(expensePattern.counterAccountNumber, dr);
  const incomePattern = patterns.find((p) => p.side === "income");
  assert.ok(incomePattern);
  assert.equal(incomePattern.count, 1);
  assert.equal(incomePattern.counterAccountNumber, dr);
});
