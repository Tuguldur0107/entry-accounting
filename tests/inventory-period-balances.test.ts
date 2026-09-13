import { test } from "node:test";
import assert from "node:assert/strict";

import {
  balanceKey,
  calculateQtyBalances,
  findNegativeStock,
  type MovementRef,
} from "../lib/inventory/balances";

// Бараа материалын snapshot + delta замын үр дүн calculateQtyBalances (бүх
// хөдөлгөөнийг эхнээс replay) -тай ЯГ ижил байх ёстой — П28-ын бараа хувилбар.

function m(partial: Partial<MovementRef> & Pick<MovementRef, "id">): MovementRef {
  return {
    movementType: "receipt",
    date: "2026-05-01",
    itemId: "item-a",
    warehouseId: "wh-1",
    toWarehouseId: null,
    quantity: 0,
    createdAt: partial.id,
    ...partial,
  };
}

// 2026-05 хаагдсан гэж үзнэ; 06, 07-д хөдөлгөөн үргэлжилнэ.
const ALL: MovementRef[] = [
  m({ id: "r1", date: "2026-05-02", quantity: 100 }),
  m({ id: "i1", date: "2026-05-10", movementType: "issue", quantity: 30 }),
  m({ id: "t1", date: "2026-05-20", movementType: "transfer", toWarehouseId: "wh-2", quantity: 20 }),
  m({ id: "a1", date: "2026-05-25", movementType: "adjustment", quantity: -0.5 }),
  m({ id: "rb", date: "2026-05-28", itemId: "item-b", quantity: 7 }),
  m({ id: "ib", date: "2026-05-30", itemId: "item-b", movementType: "issue", quantity: 7 }), // b → 0, snapshot-д орохгүй
  m({ id: "r2", date: "2026-06-03", quantity: 10 }),
  m({ id: "i2", date: "2026-06-15", movementType: "issue", quantity: 5, warehouseId: "wh-2" }),
  m({ id: "ro", date: "2026-07-01", movementType: "return_out", quantity: 4 }),
  m({ id: "rb2", date: "2026-07-05", itemId: "item-b", quantity: 3 }),
];
const CLOSE = "2026-05-31";

/** SQL snapshot-ыг дуурайна: ≤ endDate replay, 0 үлдэгдэл хадгалагдахгүй. */
function snapshot(endDate: string) {
  const full = calculateQtyBalances(ALL.filter((ref) => ref.date <= endDate));
  return new Map([...full].filter(([, qty]) => qty !== 0));
}

test("snapshot + delta equals a full replay (today and as-of)", () => {
  const snap = snapshot(CLOSE);
  assert.equal(snap.has(balanceKey("item-b", "wh-1")), false);

  const fast = calculateQtyBalances(ALL.filter((ref) => ref.date > CLOSE), snap);
  const full = calculateQtyBalances(ALL);
  for (const key of new Set([...fast.keys(), ...full.keys()]))
    assert.equal(fast.get(key) ?? 0, full.get(key) ?? 0, key);

  const asOf = "2026-06-30";
  const fastAsOf = calculateQtyBalances(
    ALL.filter((ref) => ref.date > CLOSE && ref.date <= asOf),
    snap
  );
  const fullAsOf = calculateQtyBalances(ALL.filter((ref) => ref.date <= asOf));
  assert.deepEqual([...fastAsOf].sort(), [...fullAsOf].filter(([, q]) => q !== 0).sort());
});

test("negative-stock check from the snapshot matches the full replay", () => {
  const snap = snapshot(CLOSE);
  const after = ALL.filter((ref) => ref.date > CLOSE);
  // Зангууны үлдэгдэлд багтах зарлага — аль ч замаар зөрчилгүй.
  const ok = m({ id: "x", date: "2026-06-20", movementType: "issue", quantity: 40 });
  assert.equal(findNegativeStock(after, ok, snap), null);
  assert.equal(findNegativeStock(ALL, ok), null);
  // Хэтэрсэн зарлага — хоёулаа ижил цэг дээр зогсоно.
  const bad = m({ id: "y", date: "2026-06-20", movementType: "issue", quantity: 100 });
  const fast = findNegativeStock(after, bad, snap);
  const full = findNegativeStock(ALL, bad);
  assert.ok(fast && full);
  assert.deepEqual(fast, full);
});
