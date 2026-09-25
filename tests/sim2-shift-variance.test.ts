// SIM2-036: ээлж хаалтын том зөрүү илэрнэ.
import test from "node:test";
import assert from "node:assert/strict";

import { isLargeShiftVariance, shiftVarianceThreshold } from "../lib/pos/shift-variance";

test("D: систем 207,600 · тоолсон 98,000 (−109,600, 53%) → том зөрүү", () => {
  assert.equal(isLargeShiftVariance(207_600, 98_000), true);
});

test("жижиг зөрүү (≤ 10,000₮ ба ≤ 1%) баталгаажуулалт шаардахгүй", () => {
  assert.equal(isLargeShiftVariance(207_600, 205_000), false);
  assert.equal(shiftVarianceThreshold(5_000_000), 50_000);
  assert.equal(isLargeShiftVariance(5_000_000, 4_960_000), false);
  assert.equal(isLargeShiftVariance(5_000_000, 4_940_000), true);
});
