import assert from "node:assert/strict";
import test from "node:test";

import {
  feeOfReceipt,
  matchEwalletPayout,
  settlementMatchTexts,
  settlementTextMatches,
  suggestEwalletSettlements,
  unsettledReceipts,
  validateEwalletSettlementRow,
  type EwalletSettlementMethod,
  type OpenEwalletReceipt,
} from "../lib/cash/ewallet-settlement";

function receipt(id: string, date: string, amount: number): OpenEwalletReceipt {
  return { id, date, amount };
}

function method(overrides: Partial<EwalletSettlementMethod> = {}): EwalletSettlementMethod {
  return {
    paymentMethodId: "pm-qpay",
    methodCode: "QPAY",
    methodName: "QPay",
    provider: "qpay",
    cashAccountId: "ca-qpay",
    cashAccountName: "QPay түр данс",
    glAccountNumber: "11000099",
    feePercent: 1,
    openReceipts: [
      receipt("r1", "2026-09-23", 3_780),
      receipt("r2", "2026-09-23", 30_240),
      receipt("r3", "2026-09-24", 100_000),
      receipt("r4", "2026-09-25", 50_000),
    ],
    ...overrides,
  };
}

function row(overrides: Partial<{
  id: string;
  income: number;
  expense: number;
  counterparty: string;
  description: string;
  transactionDate: string;
}>) {
  return {
    id: "row-1",
    income: 0,
    expense: 0,
    counterparty: "",
    description: "",
    transactionDate: "2026-09-24",
    ...overrides,
  };
}

test("unsettledReceipts — өмнөх settlement хамгийн эртний орлогуудыг FIFO-оор хаана", () => {
  const receipts = [
    receipt("b", "2026-09-02", 200),
    receipt("a", "2026-09-01", 100),
    receipt("c", "2026-09-03", 300),
  ];
  assert.deepEqual(unsettledReceipts(receipts, 0).map((r) => r.id), ["a", "b", "c"]);
  assert.deepEqual(unsettledReceipts(receipts, 300).map((r) => r.id), ["c"]);
  // Хэсэгчлэн хаагдсан орлого үлдэгдлээрээ нээлттэй
  assert.deepEqual(unsettledReceipts(receipts, 150), [
    { id: "b", date: "2026-09-02", amount: 150 },
    { id: "c", date: "2026-09-03", amount: 300 },
  ]);
  assert.deepEqual(unsettledReceipts(receipts, 600), []);
  assert.deepEqual(unsettledReceipts(receipts, 10_000), []);
});

test("feeOfReceipt — хувь мөр бүрд, null/0 бол шимтгэлгүй", () => {
  assert.equal(feeOfReceipt(3_780, 1), 37.8);
  assert.equal(feeOfReceipt(3_780, null), 0);
  assert.equal(feeOfReceipt(3_780, 0), 0);
  assert.equal(feeOfReceipt(100_000, 1.5), 1_500);
});

test("matchEwalletPayout — FIFO нийлбэр − шимтгэл цэвэр дүнтэй таарах эхний цэгт зогсоно", () => {
  const receipts = method().openReceipts;
  // 23-ны хоёр орлого: 34,020 − 1% (37.8 + 302.4 = 340.2) = 33,679.8
  const match = matchEwalletPayout({
    netAmount: 33_679.8,
    payoutDate: "2026-09-24",
    receipts,
    feePercent: 1,
  });
  assert.deepEqual(match, {
    grossAmount: 34_020,
    expectedFeeAmount: 340.2,
    receiptIds: ["r1", "r2"],
  });
});

test("matchEwalletPayout — мөр бүрийн бүхэл ₮ бөөрөнхийллийг хүлцнэ", () => {
  const receipts = method().openReceipts;
  // Провайдер шимтгэлийг мөр бүрд бүхэл болгосон: 38 + 302 = 340 → цэвэр 33,680
  const match = matchEwalletPayout({
    netAmount: 33_680,
    payoutDate: "2026-09-24",
    receipts,
    feePercent: 1,
  });
  assert.equal(match?.grossAmount, 34_020);
  assert.deepEqual(match?.receiptIds, ["r1", "r2"]);
});

test("matchEwalletPayout — settlement-ийн огнооноос ХОЙШХИ орлого орохгүй, давсан бол null", () => {
  const receipts = method().openReceipts;
  // 25-ны 50,000-г 24-ний settlement-д оруулахгүй
  assert.equal(
    matchEwalletPayout({ netAmount: 182_220, payoutDate: "2026-09-24", receipts, feePercent: 1 }),
    null
  );
  // Бүх 4 орлого 25-нд: 184,020 − 1,840.2 = 182,179.8
  assert.deepEqual(
    matchEwalletPayout({ netAmount: 182_179.8, payoutDate: "2026-09-25", receipts, feePercent: 1 })
      ?.receiptIds,
    ["r1", "r2", "r3", "r4"]
  );
  // Ямар ч нийлбэрт таарахгүй дүн
  assert.equal(
    matchEwalletPayout({ netAmount: 20_000, payoutDate: "2026-09-25", receipts, feePercent: 1 }),
    null
  );
  assert.equal(matchEwalletPayout({ netAmount: 0, payoutDate: "2026-09-25", receipts, feePercent: 1 }), null);
});

test("matchEwalletPayout — шимтгэлгүй хэлбэрт цэвэр = нийт", () => {
  const match = matchEwalletPayout({
    netAmount: 3_780,
    payoutDate: "2026-09-23",
    receipts: method().openReceipts,
    feePercent: null,
  });
  assert.deepEqual(match, { grossAmount: 3_780, expectedFeeAmount: 0, receiptIds: ["r1"] });
});

test("settlementMatchTexts / settlementTextMatches — провайдерийн alias + хэлбэрийн нэр", () => {
  const texts = settlementMatchTexts({ methodName: "QPay дэлгүүр", provider: "qpay" });
  assert.ok(texts.includes("qpay"));
  assert.ok(texts.includes("ккт"));
  assert.ok(texts.includes("дэлгүүр"));
  assert.equal(
    settlementTextMatches(
      { counterparty: "ККТТ ХХК", description: "Settlement 2026-09-23" },
      { methodName: "QPay", provider: "qpay" }
    ),
    true
  );
  assert.equal(
    settlementTextMatches(
      { counterparty: "Болор Трейд", description: "Түрээс" },
      { methodName: "QPay", provider: "qpay" }
    ),
    false
  );
});

test("suggestEwalletSettlements — текст+дүн → Хүчтэй; шимтгэл = нийт − цэвэр (хуулгаас)", () => {
  const rows = [
    row({
      id: "s1",
      income: 33_680,
      counterparty: "ККТТ ХХК",
      description: "QPay settlement 09/23",
      transactionDate: "2026-09-24",
    }),
    row({ id: "x", expense: 5_000, description: "Түрээс" }),
  ];
  const result = suggestEwalletSettlements(rows, [method()]);
  assert.deepEqual(Object.keys(result), ["s1"]);
  const [suggestion] = result.s1;
  assert.equal(suggestion.kind, "ewallet_settlement");
  assert.equal(suggestion.confidence, "high");
  assert.equal(suggestion.grossAmount, 34_020);
  assert.equal(suggestion.feeAmount, 340);
  assert.equal(suggestion.expectedFeeAmount, 340.2);
  assert.equal(suggestion.counterAccountNumber, "11000099");
  assert.deepEqual(suggestion.receiptIds, ["r1", "r2"]);
});

test("suggestEwalletSettlements — нэг хуулганд хоёр settlement: орлогууд дараалан хуваарилагдана", () => {
  const rows = [
    // 24-ний settlement (23-ны орлого) хуулганд ХОЖУУ бичигдсэн ч огноогоор эхэлнэ
    row({ id: "second", income: 99_000, description: "QPay settlement", transactionDate: "2026-09-25" }),
    row({ id: "first", income: 33_679.8, description: "QPay settlement", transactionDate: "2026-09-24" }),
  ];
  const result = suggestEwalletSettlements(rows, [method()]);
  assert.deepEqual(result.first[0].receiptIds, ["r1", "r2"]);
  assert.deepEqual(result.second[0].receiptIds, ["r3"]);
  assert.equal(result.second[0].grossAmount, 100_000);
  assert.equal(result.second[0].feeAmount, 1_000);
});

test("suggestEwalletSettlements — текст таараагүй бол зөвхөн БҮХ тулгагдаагүй орлого нийлж таарсан үед «Дунд»", () => {
  const partial = suggestEwalletSettlements(
    [row({ id: "p", income: 33_679.8, description: "Орлого", transactionDate: "2026-09-24" })],
    [method()]
  );
  assert.deepEqual(partial, {});
  const whole = suggestEwalletSettlements(
    [row({ id: "w", income: 182_179.8, description: "Орлого", transactionDate: "2026-09-25" })],
    [method()]
  );
  assert.equal(whole.w[0].confidence, "medium");
  assert.equal(whole.w[0].receiptIds.length, 4);
});

test("suggestEwalletSettlements — хэлбэргүй / орлогогүй үед санал байхгүй", () => {
  assert.deepEqual(suggestEwalletSettlements([row({ id: "a", income: 100 })], []), {});
  assert.deepEqual(
    suggestEwalletSettlements(
      [row({ id: "a", income: 100, description: "qpay" })],
      [method({ openReceipts: [] })]
    ),
    {}
  );
});

test("validateEwalletSettlementRow — нийт − шимтгэл = цэвэр, үлдэгдлээс хэтрэхгүй", () => {
  assert.deepEqual(
    validateEwalletSettlementRow({ netAmount: 33_680, grossAmount: 34_020, feeAmount: 340, openBalance: 184_020 }),
    []
  );
  assert.match(
    validateEwalletSettlementRow({ netAmount: 33_680, grossAmount: 34_020, feeAmount: 300, openBalance: 184_020 })[0],
    /≠ банкинд орсон/
  );
  assert.match(
    validateEwalletSettlementRow({ netAmount: 33_680, grossAmount: 34_020, feeAmount: 340, openBalance: 30_000 })[0],
    /тулгагдаагүй үлдэгдэл/
  );
  assert.match(
    validateEwalletSettlementRow({ netAmount: 100, grossAmount: 90, feeAmount: -10, openBalance: 1_000 })[0],
    /сөрөг/
  );
  assert.match(
    validateEwalletSettlementRow({ netAmount: 0, grossAmount: 100, feeAmount: 0, openBalance: 1_000 })[0],
    /орлогын мөр/
  );
});
