// SIM2-021: MNT ↔ валютын данс хоорондын солилцоо — ЦЭВЭР төлөвлөгч.
import test from "node:test";
import assert from "node:assert/strict";

import { planCurrencyExchange } from "../lib/cash/exchange-transfer";

test("MNT → CNY (валют авах): ₮ дүн хоёр талд ижил, ханш = ₮ / валют", () => {
  const plan = planCurrencyExchange({ fromCurrency: "MNT", toCurrency: "CNY", amount: 4_850_000, exchangeRate: 485 });
  assert.equal(plan.toAmount, 10_000);
  assert.equal(plan.toRate, 485);
  assert.equal(plan.mnt, 4_850_000);
  assert.equal(Math.round(plan.toAmount * plan.toRate * 100) / 100, plan.mnt);
  // Хүлээн авсан дүнгээр — ханш дүнгээс гарна
  const byAmount = planCurrencyExchange({ fromCurrency: "MNT", toCurrency: "CNY", amount: 1_000_000, toAmount: 2_057.61 });
  assert.equal(Math.round(byAmount.toAmount * byAmount.toRate * 100) / 100, 1_000_000);
});

test("USD → MNT (валют зарах)", () => {
  const plan = planCurrencyExchange({ fromCurrency: "USD", toCurrency: "MNT", amount: 1_000, exchangeRate: 3_450 });
  assert.deepEqual(plan, { fromAmount: 1_000, fromRate: 3_450, toAmount: 3_450_000, toRate: 1, mnt: 3_450_000 });
});

test("ханш/дүн өгөөгүй бол зохиохгүй; USD → CNY шууд биш", () => {
  assert.throws(() => planCurrencyExchange({ fromCurrency: "MNT", toCurrency: "USD", amount: 100 }), /RATE_REQUIRED/);
  assert.throws(() => planCurrencyExchange({ fromCurrency: "USD", toCurrency: "CNY", amount: 100, exchangeRate: 7 }), /CROSS_CURRENCY/);
  assert.throws(() => planCurrencyExchange({ fromCurrency: "MNT", toCurrency: "MNT", amount: 100 }), /ижил валют/);
});
