import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculateQtyBalances,
  findNegativeStock,
  balanceKey,
  type MovementRef,
} from "../lib/inventory/balances";
import { computeCostingRun } from "../lib/costing/costing";
import {
  computeMonthlyDepreciation,
  monthlyDepreciation,
} from "../lib/fa/depreciation";

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

// ⚠ Хамрах хүрээний тэмдэглэл (README change-control 0.3-ийн дараа)
//
// computeCostingRun нь perpetual дундажийг дотроо бодсоор байгаа ч ЗАРЛАГЫН
// өртөг түүнээс ГАРАХГҮЙ болсон: зарлага, тооллогын тохируулга, буцаалт нь
// САРЫН жигнэсэн дундажаар үнэлэгддэг (lib/costing/periodic.ts,
// tests/periodic-costing.test.ts). Энэ функцээс одоо ЗӨВХӨН:
//   • орлогын капитализацийн бичилт (receipt_capitalize), ба
//   • "үнэ хүлээж байгаа" (pending) жагсаалт
// хэрэглэгддэг. Доорх тестүүд түүний ДОТООД зан төлвийг л шалгана —
// нягтлан бодох дүрэм БИШ.

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

test("returns: out at average to clearing, in restores stock and COGS at average", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 100, date: "2026-07-01" }),
    m({ id: "ro1", movementType: "return_out", quantity: 10, date: "2026-07-02" }),
    m({ id: "i1", movementType: "issue", quantity: 20, date: "2026-07-03" }),
    m({ id: "ri1", movementType: "return_in", quantity: 5, date: "2026-07-04" }),
  ];
  const { entries, pending, state } = computeCostingRun({
    movements,
    valuedEntries: [],
    receiptCosts: new Map([["r1", 2000]]),
    asOfDate: "2026-07-31",
  });
  assert.equal(pending.length, 0);
  const out = entries.find((e) => e.movementId === "ro1")!;
  assert.equal(out.entryType, "return_out");
  assert.equal(out.amount, 20000); // 10 × 2000 дунджаар клиринг рүү
  const back = entries.find((e) => e.movementId === "ri1")!;
  assert.equal(back.entryType, "return_in");
  assert.equal(back.amount, 10000); // 5 × 2000 — COGS буцаана
  // Үлдэгдэл: 100 − 10 − 20 + 5 = 75, дундаж хэвээр 2000
  const itemState = state.get("item-a")!;
  assert.equal(itemState.qty, 75);
  assert.equal(itemState.avgCost, 2000);
});

test("landed cost: posted adjustment raises the average for later valuations", () => {
  const movements = [
    m({ id: "r1", movementType: "receipt", quantity: 100, date: "2026-07-01" }),
    m({ id: "i1", movementType: "issue", quantity: 10, date: "2026-07-05" }),
  ];
  const { entries, state } = computeCostingRun({
    movements,
    valuedEntries: [
      {
        movementId: "r1",
        entryType: "receipt_capitalize",
        quantity: 100,
        unitCost: 1000,
        amount: 100000,
      },
    ],
    receiptCosts: new Map(),
    asOfDate: "2026-07-31",
    // 2026-07-02-нд 20,000₮ тээврийн зардал → дундаж 1000 → 1200
    valueAdjustments: [
      {
        id: "lc1",
        itemId: "item-a",
        date: "2026-07-02",
        amount: 20000,
        createdAt: "lc1",
      },
    ],
  });
  const issue = entries.find((e) => e.movementId === "i1")!;
  assert.equal(issue.unitCost, 1200);
  assert.equal(issue.amount, 12000);
  const itemState = state.get("item-a")!;
  assert.equal(itemState.qty, 90);
  assert.equal(itemState.avgCost, 1200);
});

test("depreciation: straight line with final-month cap and start gating", () => {
  const assets = [
    {
      id: "a1",
      cost: 1200000,
      salvageValue: 0,
      usefulLifeMonths: 12,
      method: "straight_line" as const,
      depreciationStartMonth: "2026-01",
      status: "active",
    },
    {
      id: "a2", // элэгдэл 8 сараас эхэлнэ — 7 сард орохгүй
      cost: 600000,
      salvageValue: 0,
      usefulLifeMonths: 6,
      method: "straight_line" as const,
      depreciationStartMonth: "2026-08",
      status: "active",
    },
    {
      id: "a3", // бараг бүрэн элэгдсэн — сүүлийн сард үлдэгдлээр
      cost: 500000,
      salvageValue: 50000,
      usefulLifeMonths: 10,
      method: "straight_line" as const,
      depreciationStartMonth: "2025-01",
      status: "active",
    },
  ];
  assert.equal(monthlyDepreciation(assets[0]), 100000);
  const result = computeMonthlyDepreciation({
    assets,
    postedAccum: new Map([["a3", 440000]]), // суурь 450k — үлдсэн 10k < сарын 45k
    alreadyCharged: new Set(),
    month: "2026-07",
  });
  assert.deepEqual(
    result.map((r) => [r.assetId, r.amount]),
    [
      ["a1", 100000],
      ["a3", 10000],
    ]
  );
  // Тухайн сард аль хэдийн бичилттэй бол алгасна
  const again = computeMonthlyDepreciation({
    assets,
    postedAccum: new Map([["a1", 100000]]),
    alreadyCharged: new Set(["a1", "a3"]),
    month: "2026-07",
  });
  assert.equal(again.length, 0);
});

test("depreciation: declining balance (×2) — NBV-based, salvage cap, terminal month", () => {
  const asset = {
    id: "d1",
    cost: 1200000,
    salvageValue: 0,
    usefulLifeMonths: 24,
    method: "declining_balance" as const,
    depreciationStartMonth: "2026-01",
    status: "active",
  };
  const run = (accum: number, month: string) =>
    computeMonthlyDepreciation({
      assets: [asset],
      postedAccum: new Map([["d1", accum]]),
      alreadyCharged: new Set(),
      month,
    });

  // 1-р сар: NBV 1,200,000 × 2/24 = 100,000
  assert.deepEqual(run(0, "2026-01"), [{ assetId: "d1", amount: 100000 }]);
  // 2-р сар: NBV 1,100,000 × 2/24 = 91,666.67
  assert.deepEqual(run(100000, "2026-02"), [{ assetId: "d1", amount: 91666.67 }]);
  // Хугацааны сүүлийн сар (24 дэх): үлдэгдлийг бүтнээр нь хаана
  assert.deepEqual(run(1100000, "2027-12"), [{ assetId: "d1", amount: 100000 }]);
  // Хугацаа хэтэрсэн ч үлдэгдэлтэй бол мөн хаана
  assert.deepEqual(run(1150000, "2028-03"), [{ assetId: "d1", amount: 50000 }]);
  // Бүрэн элэгдсэн бол бичилт үүсэхгүй
  assert.equal(run(1200000, "2028-04").length, 0);

  // Үлдэх өртгийн cap: суурь (өртөг − salvage)-аас хэтрэхгүй
  const capped = computeMonthlyDepreciation({
    assets: [
      {
        id: "d2",
        cost: 1000000,
        salvageValue: 800000,
        usefulLifeMonths: 12,
        method: "declining_balance" as const,
        depreciationStartMonth: "2026-01",
        status: "active",
      },
    ],
    postedAccum: new Map([["d2", 150000]]),
    alreadyCharged: new Set(),
    month: "2026-03",
  });
  // NBV 850,000 × 2/12 = 141,666.67 боловч үлдсэн суурь 50,000
  assert.deepEqual(capped, [{ assetId: "d2", amount: 50000 }]);
});
