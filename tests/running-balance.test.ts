import test from "node:test";
import assert from "node:assert/strict";

import {
  computeRunningBalances,
  type RunningMovement,
  type ScopePeriodBasis,
} from "../lib/costing/running-balance";

const ITEM = "item-1";
const WH = "wh-1";
const KEY = `${ITEM}::${WH}::2026-07`;

function movement(partial: Partial<RunningMovement> & Pick<RunningMovement, "movementId" | "kind" | "quantityDelta">): RunningMovement {
  return {
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    inboundAmount: null,
    ...partial,
  };
}

function basis(entries: Record<string, ScopePeriodBasis>) {
  return new Map(Object.entries(entries));
}

// §3.4 acceptance №9-10: C1-ээс эхэлж C2-д тулна.
test("running starts at C1 and the final row reconciles to C2", () => {
  // C1: 100 ш / 1,000,000₮. Орлого 50 ш @ 600,000. PWA = 1,600,000/150.
  const average = 1_600_000 / 150;
  const result = computeRunningBalances(
    [
      movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 50, inboundAmount: 600_000 }),
      movement({ movementId: "out-1", kind: "avg-out", quantityDelta: -30 }),
    ],
    basis({ [KEY]: { openingQty: 100, openingAmount: 1_000_000, average } })
  );

  const afterIn = result.get("in-1")!;
  assert.equal(afterIn.qty, 150);
  assert.equal(afterIn.amount, 1_600_000);

  // Сүүлийн мөр = C2: 120 ш, 120 × PWA
  const afterOut = result.get("out-1")!;
  assert.equal(afterOut.qty, 120);
  assert.equal(afterOut.amount, Math.round(120 * average * 100) / 100);
});

// №11: moving average ДАХИН БОДОХГҮЙ — зарлага бүр нэг л PWA-гаар.
test("issues use the ONE period average, not a per-transaction moving average", () => {
  // Moving average байсан бол эхний зарлага 10,000₮/ш-ээр гарах байсан.
  const average = 1_500; // периодын дундаж (жишээ)
  const result = computeRunningBalances(
    [
      movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 100, inboundAmount: 100_000 }), // 1,000/ш
      movement({ movementId: "out-1", kind: "avg-out", quantityDelta: -50 }),
      movement({ movementId: "in-2", kind: "priced-in", quantityDelta: 100, inboundAmount: 200_000 }), // 2,000/ш
    ],
    basis({ [KEY]: { openingQty: 0, openingAmount: 0, average } })
  );

  // Зарлага 50 × 1,500 = 75,000 (moving байсан бол 50,000)
  assert.equal(result.get("out-1")!.amount, 100_000 - 75_000);
  assert.equal(result.get("in-2")!.amount, 25_000 + 200_000);
});

test("average-valued inbound (surplus) adds qty × PWA", () => {
  const result = computeRunningBalances(
    [
      movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 100, inboundAmount: 1_000_000 }),
      movement({ movementId: "gain", kind: "avg-in", quantityDelta: 10 }),
    ],
    basis({ [KEY]: { openingQty: 0, openingAmount: 0, average: 10_000 } })
  );
  assert.equal(result.get("gain")!.qty, 110);
  assert.equal(result.get("gain")!.amount, 1_100_000);
});

// §3.4: үнэлэгдээгүй мөр таарвал дүн ТОДОРХОЙГҮЙ болно — таамаглахгүй.
test("an unvalued receipt makes Running Amount null from that row on; qty keeps running", () => {
  const result = computeRunningBalances(
    [
      movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 100, inboundAmount: 1_000_000 }),
      movement({ movementId: "in-2", kind: "priced-in", quantityDelta: 20, inboundAmount: null }), // үнэлэгдээгүй
      movement({ movementId: "out-1", kind: "avg-out", quantityDelta: -30 }),
    ],
    basis({ [KEY]: { openingQty: 0, openingAmount: 0, average: 10_000 } })
  );
  assert.equal(result.get("in-1")!.amount, 1_000_000);
  assert.equal(result.get("in-2")!.amount, null);
  const last = result.get("out-1")!;
  assert.equal(last.qty, 90); // тоо үргэлжилнэ
  assert.equal(last.amount, null); // дүн тодорхойгүй хэвээр
});

test("transfers move qty but void the amount (OD-014 unvalued)", () => {
  const result = computeRunningBalances(
    [
      movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 100, inboundAmount: 1_000_000 }),
      movement({ movementId: "tr-out", kind: "transfer", quantityDelta: -40 }),
    ],
    basis({ [KEY]: { openingQty: 0, openingAmount: 0, average: 10_000 } })
  );
  assert.equal(result.get("tr-out")!.qty, 60);
  assert.equal(result.get("tr-out")!.amount, null);
});

test("a period with no calculated basis has qty running from 0 and no amount", () => {
  const result = computeRunningBalances(
    [movement({ movementId: "in-1", kind: "priced-in", quantityDelta: 10, inboundAmount: 50_000 })],
    basis({}) // период тооцоологдоогүй
  );
  assert.equal(result.get("in-1")!.qty, 10);
  assert.equal(result.get("in-1")!.amount, null);
});

test("scopes are independent: same item in two warehouses runs separately", () => {
  const result = computeRunningBalances(
    [
      movement({ movementId: "a", kind: "priced-in", quantityDelta: 10, inboundAmount: 100_000 }),
      movement({ movementId: "b", warehouseId: "wh-2", kind: "priced-in", quantityDelta: 5, inboundAmount: 100_000 }),
    ],
    basis({
      [KEY]: { openingQty: 0, openingAmount: 0, average: 10_000 },
      [`${ITEM}::wh-2::2026-07`]: { openingQty: 100, openingAmount: 2_000_000, average: 20_000 },
    })
  );
  assert.equal(result.get("a")!.qty, 10);
  assert.equal(result.get("b")!.qty, 105);
  assert.equal(result.get("b")!.amount, 2_100_000);
});
