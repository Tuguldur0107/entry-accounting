import test from "node:test";
import assert from "node:assert/strict";

import {
  computeSaleTotals,
  discountNetOf,
  lineTaxes,
  lineVat,
  posIssueTypeWarning,
  roundToCashUnit,
  ulaanbaatarNow,
} from "../lib/pos/sale-math";
import { planPayments, planRefund } from "../lib/pos/payments";
import type { PaymentContext, PaymentMethodView, PricedLine } from "../lib/pos/types";

const payer = { isVatPayer: true, vatRatePercent: 10 };

function priced(partial: Partial<PricedLine> & Pick<PricedLine, "key" | "lineTotal">): PricedLine {
  return {
    itemId: partial.key,
    itemCode: partial.key,
    itemName: partial.key,
    unit: "ш",
    categoryCode: null,
    quantity: 1,
    unitPrice: partial.lineTotal,
    vatMode: "standard",
    minSalesPrice: null,
    lineGross: partial.lineTotal,
    discountAmount: 0,
    discountDetail: [],
    ...partial,
  };
}

test("lineVat inclusive: 1,661,550 → НӨАТ 151,050, цэвэр 1,510,500 (санал §6)", () => {
  assert.deepEqual(lineVat(1_661_550, "standard", payer), { netAmount: 1_510_500, vatAmount: 151_050 });
});

test("lineVat: exempt/zero болон НӨАТ төлөгч бус → НӨАТ 0", () => {
  assert.deepEqual(lineVat(110_000, "exempt", payer), { netAmount: 110_000, vatAmount: 0 });
  assert.deepEqual(lineVat(110_000, "zero", payer), { netAmount: 110_000, vatAmount: 0 });
  assert.deepEqual(lineVat(110_000, "standard", { isVatPayer: false, vatRatePercent: 10 }), {
    netAmount: 110_000,
    vatAmount: 0,
  });
});

test("computeSaleTotals: мөр бүрийн НӨАТ нийлбэр = баримтын НӨАТ, total = net + vat", () => {
  const totals = computeSaleTotals(
    [
      priced({ key: "a", lineTotal: 1_567_500, lineGross: 1_650_000, discountAmount: 82_500 }),
      priced({ key: "b", lineTotal: 94_050, lineGross: 132_000, discountAmount: 37_950 }),
    ],
    payer
  );
  assert.equal(totals.grossAmount, 1_782_000);
  assert.equal(totals.discountTotal, 120_450);
  assert.equal(totals.total, 1_661_550);
  assert.equal(totals.vatAmount, totals.lines.reduce((sum, line) => sum + line.vatAmount, 0));
  assert.equal(totals.netAmount + totals.vatAmount, totals.total);
});

test("НХАТ: 11,200 = цэвэр 10,000 + НӨАТ 1,000 + НХАТ 200 (2%) — хоёулаа цэвэр үнээс", () => {
  const ctx = { ...payer, cityTaxPercent: 2 };
  assert.deepEqual(lineTaxes(11_200, "standard", true, ctx), { netAmount: 10_000, vatAmount: 1_000, cityTaxAmount: 200 });
  // НХАТ ногдохгүй бараа — зөвхөн НӨАТ (хуучин зан төлөв)
  assert.deepEqual(lineTaxes(11_000, "standard", false, ctx), { netAmount: 10_000, vatAmount: 1_000, cityTaxAmount: 0 });
  // НӨАТ төлөгч биш ч НХАТ төлөгч — НХАТ НӨАТ-аас хамаарахгүй
  assert.deepEqual(lineTaxes(10_200, "standard", true, { isVatPayer: false, vatRatePercent: 10, cityTaxPercent: 2 }), {
    netAmount: 10_000,
    vatAmount: 0,
    cityTaxAmount: 200,
  });
  // НӨАТ-аас чөлөөлөгдсөн ч НХАТ ногдоно
  assert.deepEqual(lineTaxes(10_200, "exempt", true, ctx), { netAmount: 10_000, vatAmount: 0, cityTaxAmount: 200 });
});

test("НХАТ: хувь 0 / тохируулаагүй бол бодохгүй (хувь ЗОХИОХГҮЙ)", () => {
  assert.deepEqual(lineTaxes(11_000, "standard", true, payer), { netAmount: 10_000, vatAmount: 1_000, cityTaxAmount: 0 });
  assert.deepEqual(lineTaxes(11_000, "standard", true, { ...payer, cityTaxPercent: 0 }), {
    netAmount: 10_000,
    vatAmount: 1_000,
    cityTaxAmount: 0,
  });
});

test("НХАТ: баримтын нийт = цэвэр + НӨАТ + НХАТ, мөрийн нийлбэрээр", () => {
  const totals = computeSaleTotals(
    [
      priced({ key: "beer", lineTotal: 11_200, cityTaxable: true }),
      priced({ key: "bread", lineTotal: 3_300 }),
      priced({ key: "wine", lineTotal: 7_777, cityTaxable: true }),
    ],
    { ...payer, cityTaxPercent: 2 }
  );
  assert.equal(totals.total, 22_277);
  assert.equal(totals.cityTaxAmount, totals.lines.reduce((sum, line) => sum + line.cityTaxAmount, 0));
  assert.equal(Math.round((totals.netAmount + totals.vatAmount + totals.cityTaxAmount) * 100) / 100, totals.total);
  for (const line of totals.lines)
    assert.equal(Math.round((line.netAmount + line.vatAmount + line.cityTaxAmount) * 100) / 100, line.lineTotal);
});

test("roundToCashUnit: 10₮, 100₮, 0 (унтраалттай)", () => {
  assert.deepEqual(roundToCashUnit(1_234, 10), { rounded: 1_230, diff: -4 });
  assert.deepEqual(roundToCashUnit(1_236, 10), { rounded: 1_240, diff: 4 });
  assert.deepEqual(roundToCashUnit(1_250, 100), { rounded: 1_300, diff: 50 });
  assert.deepEqual(roundToCashUnit(1_234.56, 0), { rounded: 1_234.56, diff: 0 });
});

test("discountNetOf: НӨАТ орсон хөнгөлөлтийг /1.1 (contra горим)", () => {
  assert.equal(discountNetOf(110_000, "standard", payer), 100_000);
  assert.equal(discountNetOf(110_000, "exempt", payer), 110_000);
  // НХАТ ногдох мөр: /(1 + 0.10 + 0.02)
  assert.equal(discountNetOf(112_000, "standard", { ...payer, cityTaxPercent: 2 }, true), 100_000);
});

test("ulaanbaatarNow: УБ-ын огноо/цаг/гараг", () => {
  // 2026-09-18 23:30 UTC = 2026-09-19 07:30 УБ (Бямба = 6)
  const at = ulaanbaatarNow(new Date("2026-09-18T23:30:00Z"));
  assert.equal(at.date, "2026-09-19");
  assert.equal(at.time, "07:30");
  assert.equal(at.weekday, 6);
});

// ── planPayments ─────────────────────────────────────────────────────────────

const cash: PaymentMethodView = {
  id: "cash", code: "CASH", name: "Бэлэн", kind: "cash", cashAccountId: "acc-cash", cashAccountName: "Касс",
  currency: "MNT", requiresReference: false, allowsChange: true, allowsRefund: true, feePercent: null, ebarimtCode: "CASH", isActive: true, sortOrder: 0,
  provider: null,
};
const card: PaymentMethodView = { ...cash, id: "card", code: "CARD", name: "Карт", kind: "card", allowsChange: false, requiresReference: true };
const usd: PaymentMethodView = { ...cash, id: "usd", code: "USD", name: "Бэлэн $", kind: "cash_fx", currency: "USD", allowsChange: false };
const credit: PaymentMethodView = { ...cash, id: "credit", code: "CREDIT", name: "Зээл", kind: "credit", cashAccountId: null, allowsChange: false };
const gift: PaymentMethodView = { ...cash, id: "gift", code: "GIFT", name: "Бэлгийн карт", kind: "gift_card", cashAccountId: null, allowsChange: false };
const methods = [cash, card, usd, credit, gift];

const pctx: PaymentContext = {
  isWalkIn: true,
  creditLimit: null,
  openReceivable: 0,
  advanceBalance: 0,
  giftCardBalances: { "GC-100": 50_000 },
  storeCreditBalances: {},
  fxRates: { USD: 3_450 },
  cashRoundingUnit: 0,
};

test("холимог төлбөр: бэлэн + карт яг таарна (санал §6)", () => {
  const plan = planPayments(
    [
      { paymentMethodId: "cash", amount: 1_000_000 },
      { paymentMethodId: "card", amount: 661_550, reference: "8831" },
    ],
    methods,
    1_661_550,
    pctx
  );
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.paidBase, 1_661_550);
  assert.equal(plan.change, 0);
  assert.equal(plan.payable, 1_661_550);
});

test("бэлэн илүү → хариулт зөвхөн allowsChange мөрөнд", () => {
  const plan = planPayments([{ paymentMethodId: "cash", amount: 20_000 }], methods, 17_500, pctx);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.change, 2_500);
  assert.equal(plan.payments[0].changeGiven, 2_500);
  const cardOnly = planPayments([{ paymentMethodId: "card", amount: 20_000, reference: "1" }], methods, 17_500, pctx);
  assert.ok(cardOnly.errors.some((error) => error.includes("хариулт")));
});

test("дутуу төлбөр, лавлахгүй карт, зээл walk-in-д → алдаа", () => {
  const plan = planPayments(
    [
      { paymentMethodId: "card", amount: 10_000 },
      { paymentMethodId: "credit", amount: 5_000 },
    ],
    methods,
    20_000,
    pctx
  );
  assert.ok(plan.errors.some((error) => error.includes("дутуу")));
  assert.ok(plan.errors.some((error) => error.includes("лавлах")));
  assert.ok(plan.errors.some((error) => error.includes("Зээлээр")));
});

test("зээлийн лимит: нээлттэй авлага + энэ ≤ лимит", () => {
  const ctx = { ...pctx, isWalkIn: false, creditLimit: 1_000_000, openReceivable: 800_000 };
  const over = planPayments([{ paymentMethodId: "credit", amount: 300_000 }], methods, 300_000, ctx);
  assert.ok(over.errors.some((error) => error.includes("[CREDIT_LIMIT]")));
  const ok = planPayments([{ paymentMethodId: "credit", amount: 200_000 }], methods, 200_000, ctx);
  assert.deepEqual(ok.errors, []);
});

test("валютын бэлэн: ханшаар MNT, ханшгүй бол алдаа", () => {
  const plan = planPayments([{ paymentMethodId: "usd", amount: 100 }], methods, 345_000, pctx);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.payments[0].baseAmount, 345_000);
  const noRate = planPayments([{ paymentMethodId: "usd", amount: 100 }], methods, 345_000, { ...pctx, fxRates: {} });
  assert.ok(noRate.errors.some((error) => error.includes("ханш")));
});

test("бэлгийн карт: үлдэгдэл, код", () => {
  const ok = planPayments([{ paymentMethodId: "gift", amount: 50_000, giftCardCode: "GC-100" }], methods, 50_000, pctx);
  assert.deepEqual(ok.errors, []);
  const over = planPayments([{ paymentMethodId: "gift", amount: 60_000, giftCardCode: "GC-100" }], methods, 60_000, pctx);
  assert.ok(over.errors.some((error) => error.includes("хүрэлцэхгүй")));
});

test("бэлэн бөөрөнхийлөл: зөвхөн бэлэн хэсэгт, 10₮ нэгжээр", () => {
  const ctx = { ...pctx, cashRoundingUnit: 10 };
  const plan = planPayments(
    [
      { paymentMethodId: "card", amount: 10_000, reference: "x" },
      { paymentMethodId: "cash", amount: 7_500 },
    ],
    methods,
    17_496,
    ctx
  );
  // бэлэн хэсэг 7,496 → 7,500, зөрүү +4, төлөх 17,500, хариулт 0
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.roundingAmount, 4);
  assert.equal(plan.payable, 17_500);
  assert.equal(plan.change, 0);
});

test("planRefund: allowsRefund, нийлбэр таарах", () => {
  const ok = planRefund([{ paymentMethodId: "cash", amount: 31_350 }], methods, 31_350, {});
  assert.deepEqual(ok.errors, []);
  const wrong = planRefund([{ paymentMethodId: "cash", amount: 30_000 }], methods, 31_350, {});
  assert.ok(wrong.errors.some((error) => error.includes("таарахгүй")));
  const noRefund = planRefund([{ paymentMethodId: "card", amount: 31_350 }], [{ ...card, allowsRefund: false }], 31_350, {});
  assert.ok(noRefund.errors.some((error) => error.includes("боломжгүй")));
});

test("Аудит M6: POS-ийн зарлагын төрөл COGS биш бол ИЛ анхааруулна", () => {
  assert.equal(posIssueTypeWarning({ name: "Борлуулалтын өртөг", debitAccountSource: "item_cogs", debitAccountNumber: null }), null);
  assert.match(
    posIssueTypeWarning({ name: "Бичиг хэрэг", debitAccountSource: "fixed", debitAccountNumber: "72500000" }) ?? "",
    /«Бичиг хэрэг» нь тогтмол данс 72500000-д/
  );
  assert.match(posIssueTypeWarning(null) ?? "", /тохируулаагүй/);
});
