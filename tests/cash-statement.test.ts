import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCashAccountCodeRules,
  validateCashAccountCode,
} from "../lib/cash/account-code-validation";
import { parseBankStatementFile } from "../lib/cash/bank-statement-parser";
import { calculateCashDetailRows } from "../lib/cash/balances";
import type { CashAccount, CashDocument } from "../lib/db/schema";
import {
  parseGolomtRates,
  parseMongolbankRates,
  parseTdbRates,
  rateForBasis,
} from "../lib/cash/exchange-rates";
import {
  calculateFxRevaluation,
  computeCashCoreRows,
  expectedCashGlBalance,
  reconciliationStatus,
} from "../lib/cash/reconciliation";
import { postingCodeBuilderFromData } from "../lib/gl/posting-code";
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
  // "Balance" багана импортлогдохгүй — мөрд ийм талбар байхгүй.
  assert.equal("balance" in parsed.rows[0], false);
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
  const valid = "ENT.000000.11000001.00.0000.000.0000.OPER.CA.0";

  assert.equal(validateCashAccountCode(valid, rules), "11000001");
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT.CC01.11000001.00.0000.000.0000.OPER.CA.0",
        rules
      ),
    /S2 сегмент идэвхгүй атлаа "CC01" утгатай/
  );
  assert.throws(
    () =>
      validateCashAccountCode(
        "ENT.000000.11000001.00.0000.000.0000.INVL.CA.0",
        rules
      ),
    /S8 сегментийн "INVL" утга Cash модульд идэвхгүй/
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

test("builds cash detail report rows with opening and running balance", () => {
  const rows = calculateCashDetailRows(
    [
      {
        id: "acc-bank",
        name: "Хаан банк MNT",
        accountType: "bank",
        bankName: "Хаан банк",
        accountNumber: "5000000000",
        currency: "MNT",
        openingBalance: "1000",
      },
    ] as unknown as CashAccount[],
    [
      {
        id: "before-payment",
        documentNo: "CM-001",
        documentType: "payment",
        date: "2026-05-31",
        fromCashAccountId: "acc-bank",
        toCashAccountId: null,
        amount: "250",
        baseAmount: "250",
        exchangeRate: "1",
        status: "posted",
        counterparty: "Vendor",
        counterAccountNumber: "73100001",
        cashFlowCode: "OPER",
        description: "Before period",
        voucherId: "voucher-before",
      },
      {
        id: "period-receipt",
        documentNo: "CM-002",
        documentType: "receipt",
        date: "2026-06-03",
        fromCashAccountId: null,
        toCashAccountId: "acc-bank",
        amount: "500",
        baseAmount: "500",
        exchangeRate: "1",
        status: "posted",
        counterparty: "Customer",
        counterAccountNumber: "51100000",
        cashFlowCode: "OPER",
        description: "Period receipt",
        voucherId: "voucher-receipt",
      },
    ] as unknown as CashDocument[],
    "2026-06-01",
    "2026-06-30"
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].documentType, "opening");
  assert.equal(rows[0].runningBalance, 750);
  assert.equal(rows[1].receipt, 500);
  assert.equal(rows[1].runningBalance, 1250);
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

test("carries the S8 cash-flow classification from the GL cash line", () => {
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Бэлэн борлуулалт",
    lines: [
      {
        // S8 = segment 8 (parts[7]) — "OPER" here.
        accountNumber: "100.000000.10000001.00.0000.000.0000.OPER.GL.0",
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
    cashAccounts: [
      { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    ],
  });
  assert.ok(derived);
  assert.equal(derived.cashFlowCode, "OPER");
});

test("treats zero-padded / bare S8 segments as unclassified", () => {
  const padded = deriveCashDocumentFromVoucher({
    voucherDescription: "Түрээс",
    lines: [
      {
        accountNumber: "100.000000.10000001.00.0000.000.0000.0000.GL.0",
        debit: 0,
        credit: 50000,
        description: null,
      },
      {
        accountNumber: "100.000000.73100001.00.0000.000.0000.0000.GL.0",
        debit: 50000,
        credit: 0,
        description: null,
      },
    ],
    cashAccounts: [
      { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    ],
  });
  assert.ok(padded);
  assert.equal(padded.cashFlowCode, null);

  const bare = deriveCashDocumentFromVoucher({
    voucherDescription: "Түрээс",
    lines: [
      { accountNumber: "10000001", debit: 0, credit: 50000, description: null },
      { accountNumber: "73100001", debit: 50000, credit: 0, description: null },
    ],
    cashAccounts: [
      { id: "acc-cash", glAccountNumber: "10000001", currency: "MNT", isActive: true },
    ],
  });
  assert.ok(bare);
  assert.equal(bare.cashFlowCode, null);
});

test("refuses to derive a cross-currency transfer (one amount can't serve two currencies)", () => {
  // GL journal moving money between an MNT and a USD cash account: the MNT
  // figure is NOT the USD leg's movement, so deriving a single-amount
  // transfer would corrupt one side's balance. Must return null — the
  // voucher stays in the GL for manual handling.
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Валют худалдан авалт",
    lines: [
      { accountNumber: "11000002", debit: 3450000, credit: 0, description: null },
      { accountNumber: "11000001", debit: 0, credit: 3450000, description: null },
    ],
    cashAccounts: [
      { id: "acc-usd", glAccountNumber: "11000002", currency: "USD", isActive: true },
      { id: "acc-mnt", glAccountNumber: "11000001", currency: "MNT", isActive: true },
    ],
  });
  assert.equal(derived, null);
});

test("keeps the account currency on a derived foreign-currency movement", () => {
  // GL lines are MNT figures; the derivation reports the cash account's
  // currency so the caller knows a rate is still required (amount stays the
  // MNT figure here — the DB layer stores it as baseAmount with rate 0).
  const derived = deriveCashDocumentFromVoucher({
    voucherDescription: "Экспортын орлого",
    lines: [
      { accountNumber: "11000002", debit: 3450000, credit: 0, description: null },
      { accountNumber: "51100000", debit: 0, credit: 3450000, description: null },
    ],
    cashAccounts: [
      { id: "acc-usd", glAccountNumber: "11000002", currency: "USD", isActive: true },
    ],
  });
  assert.ok(derived);
  assert.equal(derived.currency, "USD");
  assert.equal(derived.amount, 3450000);
});

test("банкны тал: хуулгын үлдэгдэл баганагүйгээр нээлт + Σ(орлого − зарлага)-аас бодогдоно", () => {
  const account = {
    id: "acc-1",
    name: "Голомт",
    currency: "MNT",
    glAccountNumber: "11000001",
    openingBalance: "9500000",
    isActive: true,
  } as unknown as CashAccount;
  const rows = computeCashCoreRows({
    accounts: [account],
    documents: [],
    vouchers: [],
    statements: [
      {
        cashAccountId: "acc-1",
        periodEnd: null,
        lines: [
          { transactionDate: "2026-06-02", rowNumber: 1, income: "0", expense: "450000" },
          { transactionDate: "2026-06-03", rowNumber: 2, income: "780000", expense: "0" },
          // asOf-оос хойшхи мөр тооцогдохгүй
          { transactionDate: "2026-07-01", rowNumber: 3, income: "1000000", expense: "0" },
        ],
      },
    ],
    fxRevaluations: [],
    // asOf = хуулгын сүүлийн мөрийн огноо: хуулга "одоогийн" тул зөрүү нь
    // "exception" болж илэрнэ (asOf хожуу байвал "stale-statement" — байгаа дүрэм).
    asOf: "2026-06-03",
  });
  const row = rows.get("acc-1")!;
  assert.equal(row.bankBalance, 9500000 - 450000 + 780000);
  assert.equal(row.bankBalanceDate, "2026-06-03");
  // Касс талд баримт бичигдээгүй → 330,000-ийн зөрүү илэрнэ.
  assert.equal(row.bankToCashDifference, 330000);
  assert.equal(row.status, "exception");

  // Хуулгаас хойшхи asOf — хөдөлгөөн ижил ч "хуучирсан хуулга" гэж сануулна.
  const stale = computeCashCoreRows({
    accounts: [account],
    documents: [],
    vouchers: [],
    statements: [
      {
        cashAccountId: "acc-1",
        periodEnd: null,
        lines: [
          { transactionDate: "2026-06-03", rowNumber: 1, income: "780000", expense: "0" },
        ],
      },
    ],
    fxRevaluations: [],
    asOf: "2026-06-30",
  }).get("acc-1")!;
  assert.equal(stale.bankBalance, 9500000 + 780000);
  assert.equal(stale.status, "stale-statement");
});

// ── Bug 1: импортын сегмент шалгалт кассын posting builder-тэй нийцэх ёстой ──
// Тенант S1-д ОЛОН идэвхтэй утгатай үед builder ганц default сонгож чадахгүй
// тул "Ерөнхий (default)" 0-утга бичдэг (системийн сегмент дүрэм) — validation
// үүнийг Cash-д идэвхгүй гэж унагаж болохгүй. S9 идэвхгүй ч кассын бичилт
// "CA" тэмдэг бичдэг (postingCodeBuilderFromData) — мөн зөвшөөрөгдөнө.
test("accepts the code the cash posting builder produces (multi-value S1, inactive S9)", () => {
  const configs = [
    { segmentId: 1, isEnabled: true, modules: "" },
    { segmentId: 8, isEnabled: true, modules: "" },
    // S9 settings-д асаагаагүй — гэхдээ кассын бичилт S9="CA" гэж бичдэг.
  ];
  const values = [
    { segmentId: 1, code: "101", isEnabled: true, modules: "gl,cash" },
    { segmentId: 1, code: "102", isEnabled: true, modules: "gl,cash" },
    { segmentId: 1, code: "103", isEnabled: true, modules: "gl,cash" },
    { segmentId: 8, code: "OPER", isEnabled: true, modules: "gl,cash" },
  ];
  const glAccounts = [{ number: "11000001", isEnabled: true, modules: "gl,cash" }];

  const buildCode = postingCodeBuilderFromData({
    configs,
    values,
    moduleTag: "CA",
    cashFlowCode: null,
  });
  const code = buildCode("11000001");
  const rules = buildCashAccountCodeRules(configs, values, glAccounts);

  // create_cash_transaction яг энэ кодоор журнал бичдэг — импортын
  // validation мөн адил хүлээж авах ёстой.
  assert.equal(validateCashAccountCode(code, rules), "11000001");
});

test("still rejects a genuinely disabled segment value and names it", () => {
  const configs = [{ segmentId: 1, isEnabled: true, modules: "" }];
  const values = [
    { segmentId: 1, code: "101", isEnabled: true, modules: "gl,cash" },
    { segmentId: 1, code: "109", isEnabled: false, modules: "gl,cash" },
  ];
  const glAccounts = [{ number: "11000001", isEnabled: true, modules: "gl,cash" }];
  const rules = buildCashAccountCodeRules(configs, values, glAccounts);

  // Идэвхгүй "109" утга — алдаа нь утгаа нэрлэнэ.
  assert.throws(
    () =>
      validateCashAccountCode(
        "109.000000.11000001.00.0000.000.0000.0000.CA.0",
        rules
      ),
    /S1 сегментийн "109" утга Cash/
  );
});

// ── Bug 2: FX тэгшитгэлийн дараах кассын тулгалт ────────────────────────────
// Модулийн ₮ үлдэгдэл ТҮҮХЭН ханшаар, GL нь тэгшитгэлээр залруулагдсан —
// хүлээгдэх GL = модуль + батлагдсан (буцаагдаагүй) тэгшитгэлийн Σ дүн.
test("expected cash GL adds posted revaluations, excludes reversed and future ones", () => {
  const revaluations = [
    { adjustmentAmount: 7285.75, status: "posted", valuationDate: "2026-09-16" },
    { adjustmentAmount: 4932, status: "reversed", valuationDate: "2026-09-10" },
    { adjustmentAmount: 999, status: "posted", valuationDate: "2026-09-30" },
  ];
  const result = expectedCashGlBalance({
    subledger: 5_655_800,
    revaluations,
    asOf: "2026-09-16",
  });
  assert.equal(result.fxTotal, 7285.75);
  assert.equal(result.expected, 5_663_085.75);

  // GL яг тэгшитгэлтэйгээ таарвал зөрүүгүй.
  assert.ok(Math.abs(result.expected - 5_663_085.75) <= 0.01);
  // GL-д гараар бичилт нэмэгдвэл зөрүү хэвээр илэрнэ.
  assert.ok(Math.abs(result.expected - (5_663_085.75 + 100_000)) > 0.01);
});

test("expected cash GL with all revaluations reversed equals the module balance", () => {
  const result = expectedCashGlBalance({
    subledger: 4_309_800,
    revaluations: [
      { adjustmentAmount: 4932, status: "reversed", valuationDate: "2026-09-16" },
    ],
    asOf: "2026-09-16",
  });
  assert.equal(result.fxTotal, 0);
  assert.equal(result.expected, 4_309_800);
});
