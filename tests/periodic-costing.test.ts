import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAllScopes,
  computePeriodResult,
  computePeriodSeries,
  scopeKey,
  type PeriodicMovement,
} from "../lib/costing/periodic";

const ITEM = "item-1";
const WH = "wh-1";

function inbound(
  id: string,
  date: string,
  quantity: number,
  inboundAmount: number | null
): PeriodicMovement {
  return {
    id,
    date,
    itemId: ITEM,
    warehouseId: WH,
    direction: "in",
    quantity,
    inboundAmount,
  };
}

function outbound(
  id: string,
  date: string,
  quantity: number
): PeriodicMovement {
  return { id, date, itemId: ITEM, warehouseId: WH, direction: "out", quantity };
}

// docs/cost 01-functional-specification §19 AC-001
test("AC-001: periodic average from C1 + Inbound, shared by Outbound and C2", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 100, amount: 1_000_000 },
    movements: [
      inbound("in-1", "2026-07-05", 50, 600_000),
      outbound("out-1", "2026-07-20", 30),
    ],
  });

  assert.equal(result.status, "calculated");
  assert.equal(result.openingUnitCost, 10_000);
  assert.equal(result.inboundUnitCost, 12_000);

  // Available: 150 ш, 1,600,000₮ → 10,666.666…
  const expectedAverage = 1_600_000 / 150;
  assert.equal(result.averageUnitCost, expectedAverage);

  // FR-COST-001: Outbound Unit Cost = C2 Unit Cost — нэг л утга хуваалцана.
  assert.equal(result.outboundAmount! / result.outboundQty, expectedAverage);
  assert.equal(result.closingAmount! / result.closingQty, expectedAverage);

  assert.equal(result.closingQty, 120);
  assert.ok(result.qtyBalanced);
  assert.ok(result.amountBalanced);
});

// FR-COST-003 / FR-COST-004
test("control equations balance for valid data", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 7, amount: 21_000 },
    movements: [
      inbound("in-1", "2026-07-02", 13, 45_500),
      outbound("out-1", "2026-07-09", 11),
      outbound("out-2", "2026-07-19", 4),
    ],
  });

  assert.equal(result.status, "calculated");
  // Тоо: 7 + 13 = 15 + 5
  assert.equal(result.openingQty + result.inboundQty, 20);
  assert.equal(result.outboundQty + result.closingQty, 20);
  assert.ok(result.qtyBalanced);
  // Дүн: C1 + Inbound = Outbound + C2 (бүтэн нарийвчлалаар)
  const available = result.openingAmount + result.inboundAmount;
  assert.ok(
    Math.abs(available - (result.outboundAmount! + result.closingAmount!)) < 1e-6
  );
  assert.ok(result.amountBalanced);
});

// FR-COST-005 — тэгээр хуваахгүй, үнэ зохиохгүй
test("FR-COST-005: zero available with an issue blocks instead of inventing a cost", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [outbound("out-1", "2026-07-10", 5)],
  });

  assert.equal(result.status, "blocked-zero-available");
  assert.equal(result.averageUnitCost, null);
  assert.equal(result.outboundAmount, null);
  assert.equal(result.closingAmount, null);
  assert.match(result.blockReason ?? "", /нэгж өртөг тодорхойлогдохгүй/);
});

test("empty period with no stock is calculated, not blocked", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [],
  });

  assert.equal(result.status, "calculated");
  assert.equal(result.averageUnitCost, null);
  assert.equal(result.closingQty, 0);
  assert.ok(result.qtyBalanced);
  assert.ok(result.amountBalanced);
});

test("receipt without a cost blocks the item-period — no invented unit cost", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 10, amount: 100_000 },
    movements: [
      inbound("in-1", "2026-07-03", 5, null),
      outbound("out-1", "2026-07-08", 2),
    ],
  });

  assert.equal(result.status, "blocked-missing-inbound-cost");
  assert.equal(result.averageUnitCost, null);
  assert.equal(result.outboundAmount, null);
});

test("negative available quantity blocks (OD-005 not approved)", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: -3, amount: 0 },
    movements: [],
  });

  assert.equal(result.status, "blocked-negative-available");
  assert.equal(result.averageUnitCost, null);
});

test("period series: C2 carries into the next period as C1", () => {
  const results = computePeriodSeries({
    itemId: ITEM,
    warehouseId: WH,
    periodCodes: ["2026-06", "2026-07"],
    movements: [
      inbound("in-1", "2026-06-10", 100, 1_000_000),
      outbound("out-1", "2026-06-25", 40),
      inbound("in-2", "2026-07-04", 60, 720_000),
      outbound("out-2", "2026-07-18", 50),
    ],
  });

  const [june, july] = results;
  assert.equal(june.averageUnitCost, 10_000);
  assert.equal(june.closingQty, 60);
  assert.equal(june.closingAmount, 600_000);

  // July C1 = June C2
  assert.equal(july.openingQty, 60);
  assert.equal(july.openingAmount, 600_000);
  // Available 120 ш / 1,320,000₮ → 11,000
  assert.equal(july.averageUnitCost, 11_000);
  assert.equal(july.outboundAmount, 550_000);
  assert.equal(july.closingQty, 70);
  assert.equal(july.closingAmount, 770_000);
  assert.ok(july.qtyBalanced && july.amountBalanced);
});

test("a blocked period blocks the following period (opening is unknown)", () => {
  const results = computePeriodSeries({
    itemId: ITEM,
    warehouseId: WH,
    periodCodes: ["2026-06", "2026-07"],
    movements: [
      inbound("in-1", "2026-06-10", 10, null), // өртөггүй орлого
      outbound("out-1", "2026-07-05", 3),
    ],
  });

  assert.equal(results[0].status, "blocked-missing-inbound-cost");
  assert.equal(results[1].status, "blocked-missing-inbound-cost");
  assert.match(results[1].blockReason ?? "", /Өмнөх тайлант үе/);
});

// OD-001: хамрах хүрээ = бараа × агуулах × компани
test("scope: the same item in two warehouses gets two independent averages", () => {
  const movements: PeriodicMovement[] = [
    {
      id: "a-in",
      date: "2026-07-02",
      itemId: ITEM,
      warehouseId: "wh-a",
      direction: "in",
      quantity: 10,
      inboundAmount: 100_000, // 10,000/ш
    },
    {
      id: "b-in",
      date: "2026-07-02",
      itemId: ITEM,
      warehouseId: "wh-b",
      direction: "in",
      quantity: 10,
      inboundAmount: 200_000, // 20,000/ш
    },
    {
      id: "a-out",
      date: "2026-07-20",
      itemId: ITEM,
      warehouseId: "wh-a",
      direction: "out",
      quantity: 4,
    },
  ];

  const byScope = computeAllScopes({
    periodCodes: ["2026-07"],
    movements,
  });

  const a = byScope.get(scopeKey(ITEM, "wh-a"))![0];
  const b = byScope.get(scopeKey(ITEM, "wh-b"))![0];
  assert.equal(a.averageUnitCost, 10_000);
  assert.equal(b.averageUnitCost, 20_000);
  assert.equal(a.outboundAmount, 40_000);
  assert.equal(b.outboundQty, 0);
});

// AC-002-ийн үнэлгээний тал: зарлагын чиглэл өөр ч НЭГ дундаж
test("AC-002: every issue in the period shares one unit cost regardless of destination", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [
      inbound("in-1", "2026-07-01", 200, 2_000_000), // 10,000/ш
      outbound("cogs", "2026-07-10", 100),
      outbound("admin", "2026-07-12", 10),
      outbound("wip", "2026-07-15", 50),
    ],
  });

  assert.equal(result.averageUnitCost, 10_000);
  assert.equal(result.outboundQty, 160);
  assert.equal(result.outboundAmount, 1_600_000);
  // JPR-ISS-004: чиглэл тус бүрийн задаргаа нийлбэрээрээ Outbound-той тэнцэнэ
  const perDestination = [100, 10, 50].map(
    (qty) => qty * result.averageUnitCost!
  );
  assert.equal(
    perDestination.reduce((sum, amount) => sum + amount, 0),
    result.outboundAmount
  );
});

// OD-003: өндөр нарийвчлал — 1/3 маягийн давтагдах бутархайд тэнцэл алдагдахгүй
test("OD-003: repeating-decimal average still balances at full precision", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [
      inbound("in-1", "2026-07-01", 3, 10_000), // 3333.33…
      outbound("out-1", "2026-07-11", 1),
    ],
  });

  assert.equal(result.averageUnitCost, 10_000 / 3);
  assert.ok(result.amountBalanced);
  // Outbound + C2 нь Available-тэй бүтэн нарийвчлалаар тэнцэнэ
  assert.ok(
    Math.abs(
      result.outboundAmount! + result.closingAmount! - result.inboundAmount
    ) < 1e-6
  );
});

// README change-control 0.2: тооллогын илүүдэл, буцаж ирсэн бараа нь
// худалдан авах үнэгүй тул САРЫН ДУНДАЖААР үнэлэгдэнэ.
test("average-valued inbound (count surplus) is valued at the period average", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [
      inbound("in-1", "2026-07-01", 100, 1_000_000), // 10,000/ш — өртөгтэй
      {
        id: "surplus",
        date: "2026-07-15",
        itemId: ITEM,
        warehouseId: WH,
        direction: "in",
        quantity: 10,
        inboundValuation: "average", // үнэгүй — дунджаар үнэлэгдэнэ
      },
      outbound("out-1", "2026-07-20", 40),
    ],
  });

  assert.equal(result.status, "calculated");
  // Дундаж нь ЗӨВХӨН өртөгтэй талаас: 1,000,000 / 100 = 10,000
  assert.equal(result.averageUnitCost, 10_000);
  assert.equal(result.pricedInboundQty, 100);
  assert.equal(result.averageValuedInboundQty, 10);
  // Илүүдэл 10 ш × 10,000 = 100,000 нь Орлогын дүнд нэмэгдэнэ
  assert.equal(result.inboundQty, 110);
  assert.equal(result.inboundAmount, 1_100_000);
  // Зарлага, C2 нэг л дунджаар
  assert.equal(result.outboundAmount, 400_000);
  assert.equal(result.closingQty, 70);
  assert.equal(result.closingAmount, 700_000);
  // Тэнцэл: 0 + 1,100,000 = 400,000 + 700,000
  assert.ok(result.qtyBalanced);
  assert.ok(result.amountBalanced);
});

test("only average-valued inbound with no priced source blocks — no invented cost", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-07",
    opening: { qty: 0, amount: 0 },
    movements: [
      {
        id: "surplus",
        date: "2026-07-15",
        itemId: ITEM,
        warehouseId: WH,
        direction: "in",
        quantity: 10,
        inboundValuation: "average",
      },
    ],
  });

  assert.equal(result.status, "blocked-zero-available");
  assert.equal(result.averageUnitCost, null);
  assert.match(result.blockReason ?? "", /Өртөгтэй орлого/);
});

// Асуудал 2-ын шийдвэр: сар дуустал хүлээж НЭГ дундажаар үнэлбэл зөрүү
// үүсэхгүй. Тестээр батална: сарын сүүлд орсон үнэтэй орлого сарын эхэнд
// гарсан зарлагын өртгийг ч өсгөнө.
test("late expensive receipt raises the cost of an earlier issue in the same period", () => {
  const result = computePeriodResult({
    itemId: ITEM,
    warehouseId: WH,
    periodCode: "2026-01",
    opening: { qty: 0, amount: 0 },
    movements: [
      inbound("in-1", "2026-01-05", 100, 100_000), // 1,000/ш
      outbound("out-1", "2026-01-10", 50),
      inbound("in-2", "2026-01-20", 100, 200_000), // 2,000/ш
    ],
  });

  // Сарын дундаж = 300,000 / 200 = 1,500
  assert.equal(result.averageUnitCost, 1_500);
  // 01-10-ны зарлага 50 × 1,500 = 75,000 (running дундажаар 50,000 байсан)
  assert.equal(result.outboundAmount, 75_000);
  assert.equal(result.closingQty, 150);
  assert.equal(result.closingAmount, 225_000);
  assert.ok(result.amountBalanced);
});
