// Багцын үнийн ЦЭВЭР давхарга — ОГНООТОЙ үеүд, давхцлын хамгаалалт,
// default руу шилжих дүрэм.
import assert from "node:assert/strict";
import test from "node:test";

import { PLANS } from "../lib/billing/plans";
import {
  DEFAULT_PLAN_PRICES,
  MAX_PLAN_PRICE_MNT,
  describePeriod,
  isIsoDate,
  monthlyAmountMnt,
  parsePlanPriceInput,
  planPriceChange,
  previousDay,
  priceAtDate,
  resolvePlanPricesAt,
  resolveSeatPrice,
  sortPeriods,
  type PlanPriceMap,
  type PlanPricePeriod,
} from "../lib/billing/pricing";

function period(patch: Partial<PlanPricePeriod> & { id: string }): PlanPricePeriod {
  return {
    planId: "standard",
    pricePerSeatMnt: 100_000,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    note: null,
    ...patch,
  };
}

test("DEFAULT_PLAN_PRICES нь plans.ts-тэй ижил", () => {
  assert.equal(DEFAULT_PLAN_PRICES.standard, PLANS.standard.pricePerSeatMnt);
  assert.equal(DEFAULT_PLAN_PRICES.enterprise, null);
  assert.equal(DEFAULT_PLAN_PRICES.trial, 0);
});

test("isIsoDate: бодит огноог л зөвшөөрнө", () => {
  assert.ok(isIsoDate("2026-02-28"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("2026-13-01"));
  assert.ok(!isIsoDate("26-01-01"));
  assert.ok(!isIsoDate(""));
});

test("previousDay: сар, жилийн хилээр", () => {
  assert.equal(previousDay("2026-07-01"), "2026-06-30");
  assert.equal(previousDay("2026-01-01"), "2025-12-31");
  assert.equal(previousDay("2028-03-01"), "2028-02-29"); // үсрэх жил
});

test("priceAtDate: хил ХАМРУУЛСАН, хугацаагүй үе", () => {
  const periods = [
    period({ id: "a", pricePerSeatMnt: 80_000, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }),
    period({ id: "b", pricePerSeatMnt: 100_000, effectiveFrom: "2026-07-01", effectiveTo: null }),
  ];
  assert.equal(priceAtDate(periods, "standard", "2026-01-01"), 80_000);
  assert.equal(priceAtDate(periods, "standard", "2026-06-30"), 80_000);
  assert.equal(priceAtDate(periods, "standard", "2026-07-01"), 100_000);
  assert.equal(priceAtDate(periods, "standard", "2030-12-31"), 100_000);
});

test("priceAtDate: хамрах үе байхгүй бол undefined (default руу шилжинэ)", () => {
  const periods = [period({ id: "a", effectiveFrom: "2026-07-01" })];
  assert.equal(priceAtDate(periods, "standard", "2026-06-30"), undefined);
  assert.equal(priceAtDate(periods, "platform", "2026-07-01"), undefined);
});

test("priceAtDate: цоорхой үеийг ЗОХИОЖ нөхөхгүй", () => {
  const periods = [
    period({ id: "a", pricePerSeatMnt: 80_000, effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31" }),
    period({ id: "b", pricePerSeatMnt: 120_000, effectiveFrom: "2026-05-01", effectiveTo: null }),
  ];
  assert.equal(priceAtDate(periods, "standard", "2026-04-15"), undefined);
});

test("resolvePlanPricesAt: хамрагдсаныг дарж, бусад нь default", () => {
  const periods = [
    period({ id: "a", pricePerSeatMnt: 149_000, effectiveFrom: "2026-01-01" }),
    period({ id: "b", planId: "enterprise", pricePerSeatMnt: 500_000, effectiveFrom: "2026-01-01" }),
  ];
  const prices = resolvePlanPricesAt(periods, "2026-05-05");
  assert.equal(prices.standard, 149_000);
  assert.equal(prices.enterprise, 500_000);
  assert.equal(prices.platform, DEFAULT_PLAN_PRICES.platform);
  assert.equal(Object.keys(prices).length, Object.keys(DEFAULT_PLAN_PRICES).length);
});

test("resolvePlanPricesAt: ИРЭЭДҮЙН үе өнөөдөр үйлчлэхгүй", () => {
  const periods = [period({ id: "a", pricePerSeatMnt: 149_000, effectiveFrom: "2027-01-01" })];
  assert.equal(resolvePlanPricesAt(periods, "2026-12-31").standard, DEFAULT_PLAN_PRICES.standard);
  assert.equal(resolvePlanPricesAt(periods, "2027-01-01").standard, 149_000);
});

test("planPriceChange: хоосон түүхэн дээр анхны үе", () => {
  const change = planPriceChange([], {
    planId: "standard",
    pricePerSeatMnt: " 120,000 ₮ ",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    note: "  анхны тариф ",
  });
  assert.ok(change.ok);
  assert.deepEqual(change.period, {
    planId: "standard",
    pricePerSeatMnt: 120_000,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    note: "анхны тариф",
  });
  assert.equal(change.closePreviousId, null);
});

test("planPriceChange: хугацаагүй өмнөх үеийг АВТОМАТААР хаана", () => {
  const existing = [period({ id: "a", pricePerSeatMnt: 100_000, effectiveFrom: "2026-01-01", effectiveTo: null })];
  const change = planPriceChange(existing, {
    planId: "standard",
    pricePerSeatMnt: 150_000,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
  });
  assert.ok(change.ok);
  assert.equal(change.closePreviousId, "a");
  assert.equal(change.closePreviousTo, "2026-06-30");
});

test("planPriceChange: хаалттай үетэй давхцвал ТАТГАЛЗАНА", () => {
  const existing = [
    period({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }),
  ];
  const change = planPriceChange(existing, {
    planId: "standard",
    pricePerSeatMnt: 150_000,
    effectiveFrom: "2026-07-01",
    effectiveTo: null,
  });
  assert.ok(!change.ok);
  assert.match(change.error, /давхцаж/);
  assert.match(change.error, /2026-01-01 … 2026-12-31/);
});

test("planPriceChange: ижил өдөр дахин эхлүүлэхийг зөвшөөрөхгүй", () => {
  const existing = [period({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: null })];
  const change = planPriceChange(existing, {
    planId: "standard",
    pricePerSeatMnt: 150_000,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  assert.ok(!change.ok);
  assert.match(change.error, /давхцаж/);
});

test("planPriceChange: өөр багцын үе саад болохгүй", () => {
  const existing = [period({ id: "a", planId: "platform", effectiveFrom: "2026-01-01", effectiveTo: null })];
  const change = planPriceChange(existing, {
    planId: "standard",
    pricePerSeatMnt: 150_000,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  assert.ok(change.ok);
  assert.equal(change.closePreviousId, null);
});

test("planPriceChange: гажиг оролт", () => {
  const bad = (patch: Record<string, unknown>) => {
    const change = planPriceChange([], {
      planId: "standard",
      pricePerSeatMnt: 100_000,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      ...patch,
    } as Parameters<typeof planPriceChange>[1]);
    assert.ok(!change.ok);
    return change.error;
  };
  assert.match(bad({ planId: "gold" }), /Багц буруу/);
  assert.match(bad({ effectiveFrom: "2026-13-01" }), /Эхлэх огноо/);
  assert.match(bad({ effectiveTo: "хоосон" }), /Дуусах огноо буруу/);
  assert.match(bad({ effectiveFrom: "2026-07-01", effectiveTo: "2026-06-30" }), /өмнө байна/);
  assert.match(bad({ pricePerSeatMnt: -1 }), /сөрөг/);
  assert.match(bad({ pricePerSeatMnt: MAX_PLAN_PRICE_MNT + 1 }), /хэт их/);
});

test("planPriceChange: хоосон үнэ = хэлэлцээрээр", () => {
  const change = planPriceChange([], {
    planId: "enterprise",
    pricePerSeatMnt: "",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  });
  assert.ok(change.ok);
  assert.equal(change.period.pricePerSeatMnt, null);
});

test("parsePlanPriceInput: хоосон → null, форматтай текст → тоо", () => {
  assert.equal(parsePlanPriceInput(null), null);
  assert.equal(parsePlanPriceInput("  "), null);
  assert.equal(parsePlanPriceInput(0), 0);
  assert.equal(parsePlanPriceInput(" 149,000 ₮ "), 149_000);
  assert.throws(() => parsePlanPriceInput("үнэгүй", "Үнэ"), /Үнэ/);
  assert.throws(() => parsePlanPriceInput(100.5, "Үнэ"), /бүхэл/);
});

test("resolveSeatPrice: тусгай үнэ → багцын үнэ → null", () => {
  const prices: PlanPriceMap = { ...DEFAULT_PLAN_PRICES, standard: 120_000 };
  assert.equal(resolveSeatPrice("standard", null, prices), 120_000);
  assert.equal(resolveSeatPrice("standard", 80_000, prices), 80_000);
  assert.equal(resolveSeatPrice("standard", 0, prices), 0);
  assert.equal(resolveSeatPrice("enterprise", undefined, prices), null);
});

test("monthlyAmountMnt: суудал эсвэл үнэ тодорхойгүй бол null", () => {
  assert.equal(monthlyAmountMnt(3, 100_000), 300_000);
  assert.equal(monthlyAmountMnt(0, 100_000), 0);
  assert.equal(monthlyAmountMnt(null, 100_000), null);
  assert.equal(monthlyAmountMnt(3, null), null);
  assert.equal(monthlyAmountMnt(-1, 100_000), null);
});

test("sortPeriods / describePeriod", () => {
  const sorted = sortPeriods([
    period({ id: "b", effectiveFrom: "2026-07-01" }),
    period({ id: "a", effectiveFrom: "2026-01-01" }),
  ]);
  assert.deepEqual(sorted.map((p) => p.id), ["a", "b"]);
  assert.equal(
    describePeriod({ pricePerSeatMnt: 149_000, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" }),
    "2026-01-01 … 2026-06-30: 149,000₮"
  );
  assert.equal(
    describePeriod({ pricePerSeatMnt: null, effectiveFrom: "2026-01-01", effectiveTo: null }),
    "2026-01-01 … хугацаагүй: хэлэлцээрээр"
  );
});
