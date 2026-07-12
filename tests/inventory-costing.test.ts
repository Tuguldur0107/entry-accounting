import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculateQtyBalances,
  findNegativeStock,
  balanceKey,
  type MovementRef,
} from "../lib/inventory/balances";
import { computeCostingRun } from "../lib/costing/costing";

function m(partial: Partial<MovementRef> & Pick<MovementRef, "id">): MovementRef {
  return {
    movementType: "receipt",
    date: "2026-07-01",
    itemId: "item-a",
    warehouseId: "wh-1",
    toWarehouseId: null,
    quantity: 0,
    createdAt: partial.id,
    ...partial,
  };
}

test("qty balances: receipt/issue/transfer/adjustment effects", () => {
  const balances = calculateQtyBalances([
    m({ id: "1", movementType: "receipt", quantity: 100 }),
    m({ id: "2", movementType: "issue", quantity: 30, date: "2026-07-02" }),
    m({
      id: "3",
      movementType: "transfer",
      quantity: 20,
      toWarehouseId: "wh-2",
      date: "2026-07-03",
    }),
    m({ id: "4", movementType: "adjustment", quantity: -5, date: "2026-07-04" }),
  ]);
  assert.equal(balances.get(balanceKey("item-a", "wh-1")), 45); // 100−30−20−5
  assert.equal(balances.get(balanceKey("item-a", "wh-2")), 20);
});

test("negative stock: backdated issue that breaks a later balance is caught", () => {
  const existing = [
    m({ id: "1", movementType: "receipt", quantity: 10, date: "2026-07-01" }),
    m({ id: "2", movementType: "issue", quantity: 8, date: "2026-07-10" }),
  ];
  // 5ш зарлагыг 7 сарын 5-нд нэмбэл 10-ны зарлагын дараа −3 болно.
  const violation = findNegativeStock(
    existing,
    m({ id: "3", movementType: "issue", quantity: 5, date: "2026-07-05" })
  );
  assert.ok(violation);
  assert.equal(violation.date, "2026-07-10");
  assert.equal(violation.balanceAfter, -3);

  // 2ш бол бүх цэг дээр ≥ 0.
  assert.equal(
    findNegativeStock(
      existing,
      m({ id: "3", movementType: "issue", quantity: 2, date: "2026-07-05" })
    ),
    null
  );
});

test("costing run: weighted average across receipts, issue at avg", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 100, date: "2026-07-01" }),
    m({ id: "r2", movementType: "receipt", quantity: 50, date: "2026-07-02" }),
    m({ id: "i1", movementType: "issue", quantity: 60, date: "2026-07-03" }),
  ];
  const { entries, pending } = computeCostingRun({
    movements,
    valuedEntries: [],
    receiptCosts: new Map([
      ["r1", 1000],
      ["r2", 1300],
    ]),
    asOfDate: "2026-07-31",
  });
  assert.equal(pending.length, 0);
  assert.equal(entries.length, 3);
  const issue = entries.find((e) => e.movementId === "i1")!;
  // avg = (100×1000 + 50×1300) / 150 = 1100
  assert.equal(issue.unitCost, 1100);
  assert.equal(issue.amount, 66000);
  assert.equal(issue.entryType, "issue_cogs");
});

test("costing run: unvalued receipt blocks the item's later movements only", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 10, date: "2026-07-01" }),
    m({ id: "i1", movementType: "issue", quantity: 5, date: "2026-07-02" }),
    m({
      id: "rb1",
      movementType: "receipt",
      quantity: 7,
      date: "2026-07-01",
      itemId: "item-b",
    }),
  ];
  const { entries, pending } = computeCostingRun({
    movements,
    valuedEntries: [],
    // r1-д үнэ өгөөгүй; item-b-ийн орлого үнэтэй.
    receiptCosts: new Map([["rb1", 500]]),
    asOfDate: "2026-07-31",
  });
  assert.deepEqual(
    pending.map((p) => [p.movementId, p.reason]),
    [
      ["r1", "unit-cost-required"],
      ["i1", "blocked-by-unvalued-receipt"],
    ]
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].movementId, "rb1");
});

test("costing run: replays already-valued entries to rebuild the average", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 100, date: "2026-07-01" }),
    m({ id: "i1", movementType: "issue", quantity: 20, date: "2026-07-05" }),
  ];
  const { entries } = computeCostingRun({
    movements,
    valuedEntries: [
      {
        movementId: "r1",
        entryType: "receipt_capitalize",
        quantity: 100,
        unitCost: 2500,
        amount: 250000,
      },
    ],
    receiptCosts: new Map(),
    asOfDate: "2026-07-31",
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].movementId, "i1");
  assert.equal(entries[0].unitCost, 2500);
  assert.equal(entries[0].amount, 50000);
});

test("costing run: signed adjustment classifies gain vs loss at average cost", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 10, date: "2026-07-01" }),
    m({ id: "a1", movementType: "adjustment", quantity: 2, date: "2026-07-02" }),
    m({ id: "a2", movementType: "adjustment", quantity: -3, date: "2026-07-03" }),
    m({
      id: "t1",
      movementType: "transfer",
      quantity: 4,
      toWarehouseId: "wh-2",
      date: "2026-07-04",
    }),
  ];
  const { entries } = computeCostingRun({
    movements,
    valuedEntries: [],
    receiptCosts: new Map([["r1", 800]]),
    asOfDate: "2026-07-31",
  });
  const gain = entries.find((e) => e.movementId === "a1")!;
  const loss = entries.find((e) => e.movementId === "a2")!;
  assert.equal(gain.entryType, "adjustment_gain");
  assert.equal(gain.amount, 1600);
  assert.equal(loss.entryType, "adjustment_loss");
  assert.equal(loss.amount, 2400);
  // transfer үнэлэгдэхгүй
  assert.equal(entries.some((e) => e.movementId === "t1"), false);
});
