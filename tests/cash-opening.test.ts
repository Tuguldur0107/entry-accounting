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

import { cashOpeningMnt } from "../lib/cash/opening";
import { fxCarryingAmount } from "../lib/cash/reconciliation";

test("ENT-020: валютын нээлтийн ₮ — журнал → ханш → тодорхойгүй (зохиохгүй)", () => {
  assert.equal(cashOpeningMnt({ currency: "MNT", openingBalance: 1_500_000 }), 1_500_000);
  assert.equal(
    cashOpeningMnt({ currency: "USD", openingBalance: 12_000, openingVoucherMnt: 41_045_520, openingRate: 1 }),
    41_045_520
  );
  assert.equal(cashOpeningMnt({ currency: "USD", openingBalance: 12_000, openingRate: 3420.46 }), 41_045_520);
  assert.equal(cashOpeningMnt({ currency: "USD", openingBalance: 12_000 }), null);
  assert.equal(cashOpeningMnt({ currency: "USD", openingBalance: 0 }), 0);
});

test("ENT-023: тэгшитгэлийн carrying — ганц дансанд GL-ийн бүх мөр, хуваалцсан бол тэмдэгтэй л", () => {
  const lines = [
    { accountNumber: "000.000000.11000002.00.0000.000.000.00.GL.000", cashAccountId: null, debit: 41_045_520, credit: 0 },
    { accountNumber: "11000002", cashAccountId: "usd", debit: 100_000, credit: 0 },
    { accountNumber: "11000002", cashAccountId: "other", debit: 5_000, credit: 0 },
    { accountNumber: "41000001", cashAccountId: null, debit: 0, credit: 41_045_520 },
  ];
  assert.deepEqual(
    fxCarryingAmount({ lines, cashAccountId: "usd", glAccountNumber: "11000002", glSharedWithOtherCashAccounts: false }),
    { carryingAmount: 41_145_520, untaggedAmount: 0, untaggedLines: 0 }
  );
  assert.deepEqual(
    fxCarryingAmount({ lines, cashAccountId: "usd", glAccountNumber: "11000002", glSharedWithOtherCashAccounts: true }),
    { carryingAmount: 100_000, untaggedAmount: 41_045_520, untaggedLines: 1 }
  );
});
