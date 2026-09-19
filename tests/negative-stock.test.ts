import test from "node:test";
import assert from "node:assert/strict";

import { countNegativeScopes, findNegativeBalances } from "../lib/inventory/negative-stock";

const items = [
  { id: "a", code: "A-1", name: "Алим", unit: "кг" },
  { id: "b", code: "B-1", name: "Банана", unit: "кг" },
];
const warehouses = [
  { id: "w1", name: "Дэлгүүр-1" },
  { id: "w2", name: "Агуулах" },
];

test("findNegativeBalances: зөвхөн сөрөг мөр, хамгийн их хасах нь эхэнд", () => {
  const balances = new Map<string, number>([
    ["a|w1", -3],
    ["a|w2", 5],
    ["b|w1", -10],
    ["b|w2", 0],
  ]);
  const rows = findNegativeBalances(balances, items, warehouses);
  assert.deepEqual(
    rows.map((row) => [row.itemLabel, row.warehouseName, row.quantity]),
    [
      ["B-1 · Банана", "Дэлгүүр-1", -10],
      ["A-1 · Алим", "Дэлгүүр-1", -3],
    ]
  );
  assert.equal(countNegativeScopes(balances), 2);
});

test("findNegativeBalances: лавлахад байхгүй түлхүүр алгасагдана, хоосон → []", () => {
  const balances = new Map<string, number>([["zzz|w1", -1]]);
  assert.deepEqual(findNegativeBalances(balances, items, warehouses), []);
  assert.equal(countNegativeScopes(new Map()), 0);
});
