import test from "node:test";
import assert from "node:assert/strict";

import {
  computeProvisionalAverage,
  movementCostSign,
  signedCostAmount,
  trueUpDelta,
} from "../lib/costing/provisional-cost";

test("явцын дундаж: зангуу C2 + өртөгтэй орлого (санал §6 LT-01)", () => {
  const average = computeProvisionalAverage({
    anchor: { qty: 20, amount: 29_400_000 },
    inbound: { qty: 100, amount: 146_400_000 },
  });
  assert.equal(average, 1_465_000);
});

test("явцын дундаж: орлогогүй бол зангуугаар (MN-01 410,780)", () => {
  assert.equal(
    computeProvisionalAverage({ anchor: { qty: 2, amount: 821_560 }, inbound: { qty: 0, amount: 0 } }),
    410_780
  );
});

test("явцын дундаж: өртөгтэй тоо байхгүй → null (үнэ зохиохгүй)", () => {
  assert.equal(computeProvisionalAverage({ anchor: null, inbound: { qty: 0, amount: 0 } }), null);
  assert.equal(computeProvisionalAverage({ anchor: { qty: 0, amount: 0 }, inbound: { qty: 0, amount: 0 } }), null);
  // Зангуу сөрөг тоотой (хасах үлдэгдэл) бол мөн null.
  assert.equal(computeProvisionalAverage({ anchor: { qty: -2, amount: -800_000 }, inbound: { qty: 0, amount: 0 } }), null);
});

test("залруулга: санал §6 MN-01 — урьдчилсан 1,643,120 → эцсийн 1,607,187 = −35,933", () => {
  assert.equal(trueUpDelta(1_607_187, [1_643_120]), -35_933);
});

test("залруулга: буцаалтын урьдчилсан (Cr COGS 410,780) → эцсийн −401,797 = +8,983", () => {
  assert.equal(trueUpDelta(-401_797, [-410_780]), 8_983);
});

test("залруулга: дахин нээж хаахад posted залруулгууд тооцогдоно; 0 бол 0", () => {
  // урьдчилсан 1,643,120 + өмнөх залруулга −35,933 = 1,607,187; шинэ эцсийн 1,600,000 → −7,187
  assert.equal(trueUpDelta(1_600_000, [1_643_120, -35_933]), -7_187);
  assert.equal(trueUpDelta(1_607_187, [1_643_120, -35_933]), 0);
  assert.equal(trueUpDelta(100.004, [100]), 0);
});

test("тэмдэг: issue +, return_in −, true-up хадгалсан тэмдгээрээ", () => {
  assert.equal(signedCostAmount({ entryType: "issue_cogs", amount: "100" }), 100);
  assert.equal(signedCostAmount({ entryType: "return_in", amount: 100 }), -100);
  assert.equal(signedCostAmount({ entryType: "cogs_true_up", amount: "-35933" }), -35_933);
  assert.equal(signedCostAmount({ entryType: "receipt_capitalize", amount: 100 }), 0);
  assert.equal(movementCostSign("issue"), 1);
  assert.equal(movementCostSign("return_in"), -1);
  assert.equal(movementCostSign("receipt"), 0);
});
