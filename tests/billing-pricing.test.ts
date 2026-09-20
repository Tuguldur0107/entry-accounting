// Багцын үнийн ЦЭВЭР давхарга — default → платформ → байгууллагын тусгай үнэ.
import assert from "node:assert/strict";
import test from "node:test";

import { PLANS } from "../lib/billing/plans";
import {
  DEFAULT_PLAN_PRICES,
  MAX_PLAN_PRICE_MNT,
  describePlanPriceChanges,
  mergePlanPrices,
  monthlyAmountMnt,
  parsePlanPriceInput,
  resolveSeatPrice,
  type PlanPriceMap,
} from "../lib/billing/pricing";

test("DEFAULT_PLAN_PRICES нь plans.ts-тэй ижил", () => {
  assert.equal(DEFAULT_PLAN_PRICES.standard, PLANS.standard.pricePerSeatMnt);
  assert.equal(DEFAULT_PLAN_PRICES.enterprise, null);
  assert.equal(DEFAULT_PLAN_PRICES.trial, 0);
});

test("mergePlanPrices: хадгалсан мөр дарна, бусад нь default", () => {
  const prices = mergePlanPrices([
    { planId: "standard", pricePerSeatMnt: 149_000 },
    { planId: "enterprise", pricePerSeatMnt: 500_000 },
    { planId: "гажиг", pricePerSeatMnt: 1 },
  ]);
  assert.equal(prices.standard, 149_000);
  assert.equal(prices.enterprise, 500_000);
  assert.equal(prices.platform, DEFAULT_PLAN_PRICES.platform);
  assert.equal(Object.keys(prices).length, Object.keys(DEFAULT_PLAN_PRICES).length);
});

test("mergePlanPrices: хадгалсан null нь ИЛ «хэлэлцээрээр» — default руу буцахгүй", () => {
  const prices = mergePlanPrices([{ planId: "standard", pricePerSeatMnt: null }]);
  assert.equal(prices.standard, null);
});

test("parsePlanPriceInput: хоосон → null, форматтай текст → тоо", () => {
  assert.equal(parsePlanPriceInput(null), null);
  assert.equal(parsePlanPriceInput(undefined), null);
  assert.equal(parsePlanPriceInput("  "), null);
  assert.equal(parsePlanPriceInput(0), 0);
  assert.equal(parsePlanPriceInput("149000"), 149_000);
  assert.equal(parsePlanPriceInput(" 149,000 ₮ "), 149_000);
});

test("parsePlanPriceInput: гажиг оролт ШИДНЭ", () => {
  const err = (value: unknown) => assert.throws(() => parsePlanPriceInput(value, "Үнэ"), /Үнэ/);
  err("үнэгүй");
  err(-1);
  err(100.5);
  err(MAX_PLAN_PRICE_MNT + 1);
  err(Number.NaN);
});

test("resolveSeatPrice: тусгай үнэ → багцын үнэ → null", () => {
  const prices: PlanPriceMap = { ...DEFAULT_PLAN_PRICES, standard: 120_000 };
  assert.equal(resolveSeatPrice("standard", null, prices), 120_000);
  assert.equal(resolveSeatPrice("standard", 80_000, prices), 80_000);
  // 0 нь хүчинтэй тусгай үнэ (үнэгүй харилцагч) — багцын үнэ рүү унахгүй
  assert.equal(resolveSeatPrice("standard", 0, prices), 0);
  assert.equal(resolveSeatPrice("enterprise", undefined, prices), null);
  assert.equal(resolveSeatPrice("enterprise", 900_000, prices), 900_000);
});

test("monthlyAmountMnt: суудал эсвэл үнэ тодорхойгүй бол null", () => {
  assert.equal(monthlyAmountMnt(3, 100_000), 300_000);
  assert.equal(monthlyAmountMnt(0, 100_000), 0);
  assert.equal(monthlyAmountMnt(null, 100_000), null);
  assert.equal(monthlyAmountMnt(3, null), null);
  assert.equal(monthlyAmountMnt(-1, 100_000), null);
});

test("describePlanPriceChanges: өөрчлөгдсөнийг л жагсаана", () => {
  const next: PlanPriceMap = { ...DEFAULT_PLAN_PRICES, standard: 149_000, enterprise: 500_000 };
  const changes = describePlanPriceChanges(DEFAULT_PLAN_PRICES, next);
  assert.equal(changes.length, 2);
  assert.match(changes[0], /standard: 100,000₮ → 149,000₮/);
  assert.match(changes[1], /enterprise: хэлэлцээрээр → 500,000₮/);
  assert.deepEqual(describePlanPriceChanges(DEFAULT_PLAN_PRICES, { ...DEFAULT_PLAN_PRICES }), []);
});
