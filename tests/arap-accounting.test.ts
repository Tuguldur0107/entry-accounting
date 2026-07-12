import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBaseAmount,
  calculateSettlementExchangeEffect,
} from "../lib/arap/accounting";

test("converts an AR/AP transaction amount to rounded MNT base amount", () => {
  assert.equal(calculateBaseAmount(125.55, 3450.25), 433_178.89);
});

test("classifies a stronger currency as a receivable exchange gain", () => {
  assert.deepEqual(
    calculateSettlementExchangeEffect({
      documentType: "ar_invoice",
      amount: 100,
      documentExchangeRate: 3400,
      paymentBaseAmount: 350_000,
    }),
    { historicalBaseAmount: 340_000, difference: 10_000, isGain: true }
  );
});

test("classifies a stronger currency as a payable exchange loss", () => {
  assert.deepEqual(
    calculateSettlementExchangeEffect({
      documentType: "ap_bill",
      amount: 100,
      documentExchangeRate: 3400,
      paymentBaseAmount: 350_000,
    }),
    { historicalBaseAmount: 340_000, difference: 10_000, isGain: false }
  );
});
