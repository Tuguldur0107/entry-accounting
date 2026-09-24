// SIM Trade симуляцийн өртгийн олдворууд — ЦЭВЭР логикийн регресс.
import test from "node:test";
import assert from "node:assert/strict";

import { computeAllScopes, scopeKey, type PeriodicMovement } from "../lib/costing/periodic";
import { arapLineReceiptCost, isArapCapitalizeCandidate } from "../lib/costing/arap-receipt-cost";
import { pickDefaultIssueType } from "../lib/costing/master-data";

const ITEM = "item-1";
const A = "wh-a";
const B = "wh-b";
const C = "wh-c";

const receipt = (id: string, wh: string, date: string, qty: number, amount: number | null): PeriodicMovement => ({
  id, date, itemId: ITEM, warehouseId: wh, direction: "in", quantity: qty,
  inboundValuation: "priced", inboundAmount: amount,
});
const issue = (id: string, wh: string, date: string, qty: number): PeriodicMovement => ({
  id, date, itemId: ITEM, warehouseId: wh, direction: "out", quantity: qty,
});
/** Шилжүүлэг = эх агуулахад out + хүлээн авагчид transfer-in (period-run.ts-тэй ижил). */
const transfer = (id: string, from: string, to: string, date: string, qty: number): PeriodicMovement[] => [
  { id, date, itemId: ITEM, warehouseId: from, direction: "out", quantity: qty },
  { id, date, itemId: ITEM, warehouseId: to, direction: "in", quantity: qty,
    inboundValuation: "priced", inboundAmount: null, transferFromWarehouseId: from },
];

test("ENT-044: шилжүүлэг эх агуулахын сарын дунджаар хүлээн авагчид орно", () => {
  const byScope = computeAllScopes({
    periodCodes: ["2025-01"],
    movements: [
      receipt("r1", A, "2025-01-05", 100, 1_000_000),
      receipt("r2", A, "2025-01-20", 100, 1_400_000), // A дундаж = 12,000
      ...transfer("t1", A, B, "2025-01-10", 40),
      issue("s1", B, "2025-01-25", 30),
    ],
  });
  const a = byScope.get(scopeKey(ITEM, A))![0];
  const b = byScope.get(scopeKey(ITEM, B))![0];
  assert.equal(a.status, "calculated");
  assert.equal(a.averageUnitCost, 12_000);
  assert.equal(a.outboundAmount, 480_000);
  assert.equal(b.status, "calculated");
  assert.equal(b.inboundAmount, 480_000);
  assert.equal(b.averageUnitCost, 12_000);
  assert.equal(b.outboundAmount, 360_000);
  assert.equal(b.closingQty, 10);
  // Нийт үнэ цэнэ хадгалагдана: A + B-ийн C2 = нийт орлого − зарлага
  assert.equal((a.closingAmount ?? 0) + (b.closingAmount ?? 0), 2_400_000 - 360_000);
});

test("ENT-044: гинж A→B→C нэг сард — хамаарлын дарааллаар", () => {
  const byScope = computeAllScopes({
    periodCodes: ["2025-01"],
    movements: [
      ...transfer("t2", B, C, "2025-01-02", 5), // B-ээс C-д (B нь A-аас хамаарна)
      receipt("r1", A, "2025-01-01", 10, 100_000),
      ...transfer("t1", A, B, "2025-01-01", 10),
    ],
  });
  const c = byScope.get(scopeKey(ITEM, C))![0];
  assert.equal(c.status, "calculated");
  assert.equal(c.averageUnitCost, 10_000);
  assert.equal(c.closingAmount, 50_000);
});

test("ENT-044: хоёр агуулах бие биерүүгээ шилжүүлсэн тойрог — ил шалтгаантай блок", () => {
  const byScope = computeAllScopes({
    periodCodes: ["2025-01"],
    movements: [
      receipt("r1", A, "2025-01-01", 10, 100_000),
      receipt("r2", B, "2025-01-01", 10, 200_000),
      ...transfer("t1", A, B, "2025-01-05", 2),
      ...transfer("t2", B, A, "2025-01-06", 3),
    ],
  });
  for (const wh of [A, B]) {
    const result = byScope.get(scopeKey(ITEM, wh))![0];
    assert.notEqual(result.status, "calculated");
    assert.match(result.blockReason ?? "", /тойрог/);
  }
});

test("ENT-044: эх агуулах блоклогдвол хүлээн авагч ч блоклогдоно (үнэ зохиохгүй)", () => {
  const byScope = computeAllScopes({
    periodCodes: ["2025-01"],
    movements: [
      receipt("r1", A, "2025-01-01", 10, null), // өртөггүй орлого
      ...transfer("t1", A, B, "2025-01-05", 4),
    ],
  });
  const b = byScope.get(scopeKey(ITEM, B))![0];
  assert.equal(b.status, "blocked-missing-inbound-cost");
  assert.match(b.blockReason ?? "", /эх агуулах/);
});

test("ENT-018: АП мөрийн өртөг — дүн × ханш ÷ тоо, хүчингүй бол null", () => {
  assert.deepEqual(arapLineReceiptCost({ amount: "128000", quantity: "4", exchangeRate: "1" }), {
    unitCost: 32_000,
    amount: 128_000,
  });
  assert.deepEqual(arapLineReceiptCost({ amount: 100, quantity: 3, exchangeRate: 3450.5 }), {
    unitCost: 115_016.6667,
    amount: 345_050,
  });
  assert.equal(arapLineReceiptCost({ amount: 100, quantity: 0, exchangeRate: 1 }), null);
  assert.equal(arapLineReceiptCost({ amount: 100, quantity: null, exchangeRate: 1 }), null);
  assert.equal(arapLineReceiptCost({ amount: -5, quantity: 1, exchangeRate: 1 }), null);
});

test("ENT-022: анхдагч зарлагын төрөл — COGS → item_cogs → null (тогтмол данс ХЭЗЭЭ Ч биш)", () => {
  const stationery = { code: "INTERNAL", debitAccountSource: "fixed" };
  const sale = { code: "SALE", debitAccountSource: "item_cogs" };
  const cogs = { code: "COGS", debitAccountSource: "item_cogs" };
  assert.equal(pickDefaultIssueType([stationery, sale, cogs]), cogs);
  assert.equal(pickDefaultIssueType([stationery, sale]), sale);
  assert.equal(pickDefaultIssueType([stationery]), null);
});

test("Аудит M: өртгийн run хаагдсан үе / asOfDate-ээс хойшхи АП орлогыг капиталжуулахгүй", () => {
  const context = {
    asOfDate: "2025-08-31",
    closedPeriodCodes: new Set(["2025-07"]),
    manuallyPriced: new Set(["m-manual"]),
  };
  assert.equal(isArapCapitalizeCandidate({ id: "m1", date: "2025-08-10" }, context), true);
  assert.equal(isArapCapitalizeCandidate({ id: "m2", date: "2025-07-15" }, context), false);
  assert.equal(isArapCapitalizeCandidate({ id: "m3", date: "2025-09-01" }, context), false);
  assert.equal(isArapCapitalizeCandidate({ id: "m-manual", date: "2025-08-10" }, context), false);
});
