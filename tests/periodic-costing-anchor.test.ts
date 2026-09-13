import test from "node:test";
import assert from "node:assert/strict";

import {
  contiguousClosedPrefix,
  pickCostingAnchor,
  seedOpeningFromResults,
} from "../lib/costing/period-anchor";
import {
  computeAllScopes,
  scopeKey,
  type PeriodicMovement,
  type PeriodicResult,
} from "../lib/costing/periodic";

// Зангуунаас үргэлжлүүлсэн тооцоолол нь бүх түүхийг эхнээс нь тооцсонтой
// ЯГ ИЖИЛ байх ёстой — өртгийн snapshot + delta.

const t = (iso: string) => new Date(iso);

test("contiguousClosedPrefix: stops at the first open month", () => {
  const closed = [
    { code: "2026-01", closedAt: t("2026-02-05") },
    { code: "2026-02", closedAt: t("2026-03-05") },
    { code: "2026-04", closedAt: t("2026-05-05") }, // 03 нээлттэй — урьдалд орохгүй
  ];
  assert.deepEqual(
    contiguousClosedPrefix("2026-01", closed).map((p) => p.code),
    ["2026-01", "2026-02"]
  );
  assert.deepEqual(contiguousClosedPrefix("2026-03", closed), []);
});

test("pickCostingAnchor: only rows computed after every close so far count", () => {
  const prefix = [
    { code: "2026-01", closedAt: t("2026-02-05T10:00") },
    { code: "2026-02", closedAt: t("2026-03-05T10:00") },
    { code: "2026-03", closedAt: t("2026-04-05T10:00") },
  ];
  const meta = new Map([
    ["2026-01", { rows: 3, minCalculatedAt: t("2026-04-06") }],
    ["2026-02", { rows: 3, minCalculatedAt: t("2026-03-01") }], // хаахаас ӨМНӨ тооцсон
    ["2026-03", { rows: 0, minCalculatedAt: t("2026-04-06") }], // мөргүй
  ]);
  assert.equal(pickCostingAnchor(prefix, meta), "2026-01");
  meta.set("2026-03", { rows: 2, minCalculatedAt: t("2026-04-06") });
  assert.equal(pickCostingAnchor(prefix, meta), "2026-03");
  // 03-ыг дахин хаасан (closedAt шинэчлэгдсэн) → мөр хуучирсан → зангуу ухарна.
  prefix[2].closedAt = t("2026-04-07");
  assert.equal(pickCostingAnchor(prefix, meta), "2026-01");
  assert.equal(pickCostingAnchor([], meta), null);
});

test("seedOpeningFromResults: calculated → C2, blocked → null", () => {
  const seed = seedOpeningFromResults([
    { itemId: "a", warehouseId: "w", status: "calculated", closingQty: "10", closingAmount: "1000" },
    { itemId: "b", warehouseId: "w", status: "blocked-zero-available", closingQty: "0", closingAmount: null },
  ]);
  assert.deepEqual(seed.get(scopeKey("a", "w")), { qty: 10, amount: 1000 });
  assert.equal(seed.get(scopeKey("b", "w")), null);
});

function mv(
  id: string,
  date: string,
  itemId: string,
  direction: "in" | "out",
  quantity: number,
  inboundAmount?: number | null
): PeriodicMovement {
  return {
    id,
    date,
    itemId,
    warehouseId: "w",
    direction,
    quantity,
    ...(direction === "in" ? { inboundAmount: inboundAmount ?? null } : {}),
  };
}

const MOVEMENTS: PeriodicMovement[] = [
  // "a": энгийн, 3 сар дамжсан
  mv("a1", "2026-01-05", "a", "in", 100, 1_000_000),
  mv("a2", "2026-01-20", "a", "out", 30),
  mv("a3", "2026-02-10", "a", "in", 50, 600_000),
  mv("a4", "2026-03-03", "a", "out", 40),
  // "b": 01-д блоклогдсон (өртөггүй орлого), 03-д дахин хөдөлгөөн
  mv("b1", "2026-01-08", "b", "in", 10, null),
  mv("b2", "2026-03-15", "b", "out", 5),
  // "c": зөвхөн 01-д, дараа нь хөдөлгөөнгүй — үлдэгдэл дамжина
  mv("c1", "2026-01-12", "c", "in", 7, 70_000),
  // "d": зангууны ДАРАА л үүссэн хүрээ
  mv("d1", "2026-03-20", "d", "in", 3, 30_000),
];

const strip = (r: PeriodicResult) => ({
  ...r,
  movementIds: [...r.movementIds].sort(),
});

test("anchored run at 2026-02 reproduces the full recompute for 2026-03", () => {
  const full = computeAllScopes({
    periodCodes: ["2026-01", "2026-02", "2026-03"],
    movements: MOVEMENTS,
  });

  // Хадгалагдсан мөрүүд: хүрээ бүрийн 02 хүртэлх сүүлийн мөр (period-run-ы
  // бичилтийн дүрмээр: хөдөлгөөнгүй + 0/0 мөр хадгалагддаггүй).
  const stored: Parameters<typeof seedOpeningFromResults>[0] = [];
  for (const [, series] of full) {
    const kept = series
      .filter((r) => r.periodCode <= "2026-02")
      .filter((r) => r.movementIds.length > 0 || r.openingQty !== 0 || r.closingQty !== 0);
    const last = kept[kept.length - 1];
    if (last)
      stored.push({
        itemId: last.itemId,
        warehouseId: last.warehouseId,
        status: last.status,
        closingQty: last.closingQty,
        closingAmount: last.closingAmount,
      });
  }

  const anchored = computeAllScopes({
    periodCodes: ["2026-03"],
    movements: MOVEMENTS.filter((m) => m.date > "2026-02-28"),
    openingByScope: seedOpeningFromResults(stored),
  });

  for (const key of ["a", "b", "c", "d"].map((item) => scopeKey(item, "w"))) {
    const expected = full.get(key)!.filter((r) => r.periodCode === "2026-03").map(strip);
    const actual = (anchored.get(key) ?? []).map(strip);
    assert.deepEqual(actual, expected, key);
  }
  // "c" хөдөлгөөнгүй ч 03-д үлдэгдэл дамжсан мөртэй; "b" блоклогдсон хэвээр.
  assert.equal(anchored.get(scopeKey("c", "w"))![0].closingQty, 7);
  assert.equal(anchored.get(scopeKey("b", "w"))![0].status, "blocked-missing-inbound-cost");
});
