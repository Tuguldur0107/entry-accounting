import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "../lib/cash/account-code-validation";
import { parseBankStatementFile } from "../lib/cash/bank-statement-parser";
import {
  parseGolomtRates,
  parseMongolbankRates,
  parseTdbRates,
  rateForBasis,
} from "../lib/cash/exchange-rates";
import {
  calculateFxRevaluation,
  reconciliationStatus,
} from "../lib/cash/reconciliation";
import { deriveCashDocumentFromVoucher } from "../lib/cash/gl-sync";

function bytes(value: string) {
  return new TextEncoder().encode(value).buffer;
}

test("detects a semicolon-delimited statement below a title row", async () => {
  const statement = [
    "Example bank",
    "Value Date;Transaction Date;Description;Credit;Debit",
    "2026-06-02;2026-06-01;Customer receipt;1250;0",
  ].join("\n");

  const parsed = await parseBankStatementFile(
    "statement.csv",
    bytes(statement)
  );

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].transactionDate, "2026-06-01");
  assert.equal(parsed.rows[0].valueDate, "2026-06-02");
  assert.equal(parsed.rows[0].income, 1250);
});

test("parses FX statement rate and MNT equivalent columns", async () => {
  const statement = [
    "Transaction Date,Description,Credit,Debit,Balance,Exchange Rate,MNT Amount",
    "2026-07-01,USD receipt,100,0,1100,3580.5,358050",
  ].join("\n");

  const parsed = await parseBankStatementFile(
    "usd-statement.csv",
    bytes(statement)
  );

  assert.equal(parsed.rows[0].exchangeRate, 3580.5);
  assert.equal(parsed.rows[0].baseAmount, 358050);
  assert.equal(parsed.rows[0].balance, 1100);
});

test("validates every active Cash segment and inactive defaults", () => {
  const rules = buildCashAccountCodeRules(
    [
      { segmentId: 1, isEnabled: true, modules: "" },
      { segmentId: 8, isEnabled: true, modules: "" },
      { segmentId: 9, isEnabled: true, modules: "" },
    ],
    [
      {
        segmentId: 1,
        code: "ENT",
        isEnabled: true,
        modules: "gl,cash",
      },
      {
        segmentId: 8,
        code: "OPER",
        isEnabled: true,
        modules: "gl,cash",
      },
      {
        segmentId: 9,
        code: "CA",
        isEnabled: true,
        modules: "cash",
      },
    ],
    [
      {
        number: "11000001",
        isEnabled: true,
        modules: "gl,cash",
      },
    ]
  );
  const valid = "ENT..11000001...000.0000.OPER.CA.0";

  assert.equal(validateCashAccountCode(valid, rules), "11000001");
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT.CC01.11000001...000.0000.OPER.CA.0",
        rules
      ),
    /S2 сегмент Cash-д идэвхгүй/
  );
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT..11000001...000.0000.INVL.CA.0",
        rules
      ),
    /S8 сегментийн утга Cash-д идэвхгүй/
  );
});

test("calculates FX gain and loss adjustments against GL carrying amount", () => {
  assert.deepEqual(calculateFxRevaluation(1_000, 3_450.5, 3_400_000), {
    revaluedAmount: 3_450_500,
    adjustmentAmount: 50_500,
  });
  assert.deepEqual(calculateFxRevaluation(1_000, 3_300, 3_400_000), {
    revaluedAmount: 3_300_000,
    adjustmentAmount: -100_000,
  });
  assert.throws(() => calculateFxRevaluation(1_000, 0, 0), /0-ээс их/);
});

test("classifies reconciliation exceptions and missing evidence", () => {
  assert.equal(reconciliationStatus(0, 0, true), "balanced");
  assert.equal(reconciliationStatus(100, 0, true), "exception");
  assert.equal(reconciliationStatus(0, null, true), "no-statement");
  assert.equal(reconciliationStatus(null, null, false), "missing-rate");
  assert.equal(
    reconciliationStatus(0, 0, true, false),
    "stale-statement"
  );
});

test("normalizes central bank and commercial bank exchange rates", () => {
  const mongolbank = parseMongolbankRates(
    {
      success: true,
      data: [
        { RATE_DATE: "2026-07-03", USD: "3,580.20" },
        { RATE_DATE: "2026-07-06", USD: "3,581.94" },
      ],
    },
    ["USD"],
    "2026-07-06"
  );
  const tdb = parseTdbRates(
    `<div id="exchange-table-result"><table>
      <tr><td><img src="/USD.png"> USD</td><td>АНУ-ын доллар</td>
      <td>3,581.94</td><td><div>3,575.00</div></td>
      <td><div>3,583.00</div></td><td>3,575.00</td><td>3,600.00</td></tr>
    </table></div>`,
    ["USD"],
    "2026-07-06"
  );
  const golomt = parseGolomtRates(
    {
      result: {
        USD: {
          mongolbank: { cvalue: 3581.94 },
          non_cash_buy: { cvalue: 3574 },
          non_cash_sell: { cvalue: 3583.8 },
          cash_buy: { cvalue: 3574 },
          cash_sell: { cvalue: 3601 },
        },
      },
    },
    ["USD"],
    "2026-07-06"
  );

  assert.equal(mongolbank[0].officialRate, 3581.94);
  assert.equal(tdb[0].nonCashSellRate, 3583);
  assert.equal(golomt[0].cashSellRate, 3601);
  assert.equal(rateForBasis(tdb[0], "mid"), 3579);
  assert.equal(rateForBasis(mongolbank[0], "buy"), null);
});

test("derives a receipt draft when a voucher debits a cash account", () => {
  const cashAccounts = [
    { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
  ];
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Бэлэн борлуулалт",
    lines: [
      // Full 10-part dotted codes as stored in the ledger (main account =
      // segment 3 / parts[2]).
      {
        accountNumber: "100.000000.10000001.00.0000.000.0000.0000.GL.0",
        debit: 85000,
        credit: 0,
        description: null,
      },
      {
        accountNumber: "100.000000.51100000.00.0000.000.0000.0000.GL.0",
        debit: 0,
        credit: 85000,
        description: null,
      },
    ],
    cashAccounts,
  });
  assert.ok(derived);
  assert.equal(derived.documentType, "receipt");
  assert.equal(derived.toCashAccountId, "acc-cash");
  assert.equal(derived.fromCashAccountId, null);
  assert.equal(derived.counterAccountNumber, "51100000");
  assert.equal(derived.amount, 85000);
});

test("derives a payment draft when a voucher credits a cash account", () => {
  const cashAccounts = [
    { id: "acc-bank", glAccountNumber: "11000001", currency: "MNT", isActive: true },
  ];
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Түрээс төлөв",
    lines: [
      { accountNumber: "73100001", debit: 500000, credit: 0, description: null },
      { accountNumber: "11000001", debit: 0, credit: 500000, description: null },
    ],
    cashAccounts,
  });
  assert.ok(derived);
  assert.equal(derived.documentType, "payment");
  assert.equal(derived.fromCashAccountId, "acc-bank");
  assert.equal(derived.counterAccountNumber, "73100001");
  assert.equal(derived.amount, 500000);
});

test("derives a transfer when a voucher moves between two cash accounts", () => {
  const cashAccounts = [
    { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    { id: "acc-bank", glAccountNumber: "11000001", currency: "MNT", isActive: true },
  ];
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Касс → банк",
    lines: [
      { accountNumber: "11000001", debit: 200000, credit: 0, description: null },
      { accountNumber: "10000001", debit: 0, credit: 200000, description: null },
    ],
    cashAccounts,
  });
  assert.ok(derived);
  assert.equal(derived.documentType, "transfer");
  assert.equal(derived.toCashAccountId, "acc-bank");
  assert.equal(derived.fromCashAccountId, "acc-cash");
  assert.equal(derived.amount, 200000);
});

test("returns null when no cash account is touched", () => {
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Элэгдэл",
    lines: [
      { accountNumber: "70000001", debit: 10000, credit: 0, description: null },
      { accountNumber: "20000002", debit: 0, credit: 10000, description: null },
    ],
    cashAccounts: [
      { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    ],
  });
  assert.equal(derived, null);
});

test("leaves the counter blank on a multi-split cash voucher", () => {
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Холимог төлбөр",
    lines: [
      { accountNumber: "10000001", debit: 0, credit: 300000, description: null },
      { accountNumber: "73100001", debit: 100000, credit: 0, description: null },
      { accountNumber: "13620000", debit: 200000, credit: 0, description: null },
    ],
    cashAccounts: [
      { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    ],
  });
  assert.ok(derived);
  assert.equal(derived.documentType, "payment");
  assert.equal(derived.counterAccountNumber, null);
  assert.equal(derived.amount, 300000);
});
