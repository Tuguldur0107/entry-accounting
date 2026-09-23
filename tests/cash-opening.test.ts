import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCashOpeningFields, planCashOpeningVoucher } from "../lib/cash/opening";

test("ENT-011: валютын нээлт FC × ханш (12,000 USD @3,420.46)", () => {
  const plan = planCashOpeningVoucher({ openingBalance: 12_000, currency: "usd", rate: 3420.46 });
  assert.deepEqual(plan, {
    currency: "USD",
    rate: 3420.46,
    amountFc: 12_000,
    amountMnt: 41_045_520,
    cashIsDebit: true,
  });
});

test("MNT нээлт — FC хоосон, ханш 1; сөрөг нээлтэд чиглэл эсрэг", () => {
  assert.deepEqual(planCashOpeningVoucher({ openingBalance: -1_500_000, currency: "MNT", rate: 0 }), {
    currency: "MNT",
    rate: 1,
    amountFc: 0,
    amountMnt: 1_500_000,
    cashIsDebit: false,
  });
});

test("Ханш ЗОХИОХГҮЙ — валютын дансанд ханшгүй бол [RATE_REQUIRED]", () => {
  assert.throws(
    () => planCashOpeningVoucher({ openingBalance: 100, currency: "USD", rate: 0 }),
    /RATE_REQUIRED/
  );
  assert.throws(() => planCashOpeningVoucher({ openingBalance: 0, currency: "MNT", rate: 1 }), /0 тул/);
});

test("ENT-012: эхний үлдэгдэлтэй дансанд нээлтийн огноо заавал", () => {
  assert.throws(
    () => normalizeCashOpeningFields({ openingBalance: 5, currency: "MNT" }),
    /НЭЭЛТИЙН ОГНОО/
  );
  assert.throws(
    () => normalizeCashOpeningFields({ openingBalance: 5, currency: "MNT", openingDate: "2024-02-30" }),
    /хуанлид байхгүй/
  );
  assert.deepEqual(normalizeCashOpeningFields({ openingBalance: 0, currency: "MNT" }), {
    openingDate: null,
    openingRate: null,
  });
  assert.deepEqual(
    normalizeCashOpeningFields({ openingBalance: 12_000, currency: "USD", openingDate: "2024-12-31", openingRate: "3420.46" }),
    { openingDate: "2024-12-31", openingRate: 3420.46 }
  );
  // MNT дансанд ханш үл хамаарна
  assert.deepEqual(
    normalizeCashOpeningFields({ openingBalance: 1, currency: "MNT", openingDate: "2024-12-31", openingRate: 5 }),
    { openingDate: "2024-12-31", openingRate: null }
  );
  assert.throws(
    () => normalizeCashOpeningFields({ openingBalance: 1, currency: "USD", openingDate: "2024-12-31", openingRate: -1 }),
    /эерэг/
  );
});
