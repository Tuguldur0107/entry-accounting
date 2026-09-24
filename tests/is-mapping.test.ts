import assert from "node:assert/strict";
import { test } from "node:test";

import { STANDARD_ACCOUNTS } from "../lib/constants/standard-accounts";
import { isDefaultLineKeyOf } from "../lib/reports/is-lines";

test("ENT-048: стандарт 5–8 ангиллын данс бүр аль нэг орлогын тайлангийн мөрөнд", () => {
  const missing = STANDARD_ACCOUNTS.filter((a) => /^[5-8]/.test(a.number))
    .filter((a) => isDefaultLineKeyOf(a.number) === null)
    .map((a) => a.number);
  assert.deepEqual(missing, []);
});

test("ENT-048: хүү, ханшийн гарз, тооллогын дутагдал зөв мөрөнд", () => {
  assert.equal(isDefaultLineKeyOf("87000001"), "interest-expense");
  assert.equal(isDefaultLineKeyOf("87000003"), "fx-loss");
  assert.equal(isDefaultLineKeyOf("87100004"), "other-opex");
  assert.equal(isDefaultLineKeyOf("87000004"), "other-finex");
});

test("ханшийн олз зөвхөн 51800001 — тооллогын/кассын илүүдэл бусад орлого", () => {
  assert.equal(isDefaultLineKeyOf("51800001"), "fx-gain");
  assert.equal(isDefaultLineKeyOf("51800003"), "other-income");
  assert.equal(isDefaultLineKeyOf("51800002"), "other-income");
  assert.equal(isDefaultLineKeyOf("51100000"), "sales-revenue");
  assert.equal(isDefaultLineKeyOf("72100002"), "payroll-expense");
  assert.equal(isDefaultLineKeyOf("61100000"), "cogs");
});
