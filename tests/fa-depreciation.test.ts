import test from "node:test";
import assert from "node:assert/strict";

import {
  computeMonthlyDepreciation,
  daysBetweenInclusive,
  depreciableDaysInMonth,
  depreciationForMonth,
  monthEnd,
  totalDepreciableDays,
  type FixedAssetRef,
} from "../lib/fa/depreciation";

// Үндсэн хөрөнгийн элэгдэл: сарын vs ӨДРИЙН суурь, санхүүгийн (IAS 16) vs
// ТАТВАРЫН (cit.md-ийн хуулийн хувь) хоёр зэрэг тооцоо.

const ASSET: FixedAssetRef = {
  id: "a1",
  cost: 12_000_000,
  salvageValue: 0,
  usefulLifeMonths: 12,
  method: "straight_line",
  depreciationStartMonth: "2026-01",
  depreciationStartDate: "2026-01-01",
  status: "active",
};

test("сарын суурь: тогтмол сарын дүн", () => {
  assert.equal(depreciationForMonth(ASSET, 0, "2026-01"), 1_000_000);
  assert.equal(depreciationForMonth(ASSET, 1_000_000, "2026-02"), 1_000_000);
});

test("огнооны туслахууд: сарын эцэс, өдрийн тоо", () => {
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(monthEnd("2024-02"), "2024-02-29"); // өндөр жил
  assert.equal(daysBetweenInclusive("2026-01-01", "2026-01-31"), 31);
  assert.equal(totalDepreciableDays(ASSET, 12), 365);
});

test("өдрийн суурь: сар бүр өөр өдрийн тоогоор элэгдэнэ", () => {
  const jan = depreciationForMonth(ASSET, 0, "2026-01", { basis: "daily" });
  const feb = depreciationForMonth(ASSET, jan, "2026-02", { basis: "daily" });
  // 12,000,000 / 365 хоног = 32,876.71/хоног
  assert.equal(jan, Math.round((12_000_000 * 31) / 365 * 100) / 100);
  assert.equal(feb, Math.round((12_000_000 * 28) / 365 * 100) / 100);
  assert.ok(jan > feb, "31 хоногтой сар 28 хоногтойгоос их элэгдэнэ");
});

test("өдрийн суурь: сар дундуур ашиглалтад орвол хувь тэнцүүлэн элэгдэнэ", () => {
  const midMonth: FixedAssetRef = {
    ...ASSET,
    depreciationStartMonth: "2026-03",
    depreciationStartDate: "2026-03-16",
  };
  // 3-р сарын 16-31 = 16 хоног
  assert.equal(depreciableDaysInMonth(midMonth, 12, "2026-03"), 16);
  assert.equal(depreciableDaysInMonth(midMonth, 12, "2026-04"), 30);
  const march = depreciationForMonth(midMonth, 0, "2026-03", { basis: "daily" });
  const april = depreciationForMonth(midMonth, march, "2026-04", {
    basis: "daily",
  });
  assert.ok(march < april, "дутуу сар бүтэн сарынхаас бага");
});

test("өдрийн суурь: бүх сарын нийлбэр = элэгдүүлэх нийт дүн", () => {
  let accum = 0;
  const months: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    const year = 2026 + Math.floor(i / 12);
    const mon = String((i % 12) + 1).padStart(2, "0");
    months.push(`${year}-${mon}`);
  }
  for (const month of months) {
    accum += depreciationForMonth(ASSET, accum, month, { basis: "daily" });
  }
  assert.equal(Math.round(accum), 12_000_000);
});

test("элэгдүүлэх дүнгээс хэтрэхгүй (үлдэх өртөг хадгалагдана)", () => {
  const withSalvage: FixedAssetRef = { ...ASSET, salvageValue: 2_000_000 };
  let accum = 0;
  for (let i = 0; i < 24; i += 1) {
    const mon = String((i % 12) + 1).padStart(2, "0");
    // DB нь numeric(18,2) тул хуримтлалыг бодит байдалтай ижил бөөрөнхийлнө
    // (JS-ийн float нэмэлт өөрөө 1e-9 хазайлт үүсгэдэг).
    accum =
      Math.round(
        (accum +
          depreciationForMonth(
            withSalvage,
            accum,
            `${2026 + Math.floor(i / 12)}-${mon}`
          )) *
          100
      ) / 100;
  }
  assert.equal(accum, 10_000_000);
});

test("татварын элэгдэл САНХҮҮГИЙНХЭЭС тусдаа хугацаагаар бодогдоно", () => {
  // Компьютер: татвар 20%/жил = 5 жил (60 сар); санхүүгийн 12 сар.
  const asset: FixedAssetRef = { ...ASSET, taxUsefulLifeMonths: 60 };
  const [row] = computeMonthlyDepreciation({
    assets: [asset],
    postedAccum: new Map(),
    taxAccum: new Map(),
    alreadyCharged: new Set(),
    month: "2026-01",
  });
  assert.equal(row.amount, 1_000_000); // 12,000,000 / 12
  assert.equal(row.taxAmount, 200_000); // 12,000,000 / 60
  // Зөрүү нь IAS 12 хойшлогдсон татварын суурь.
  assert.equal(row.amount - row.taxAmount, 800_000);
});

test("татварын хугацаа 0 бол татварын элэгдэл бодогдохгүй", () => {
  const [row] = computeMonthlyDepreciation({
    assets: [ASSET],
    postedAccum: new Map(),
    alreadyCharged: new Set(),
    month: "2026-01",
  });
  assert.equal(row.taxAmount, 0);
  assert.equal(row.amount, 1_000_000);
});

test("татварын хуримтлагдсан нь санхүүгийнхээс ТУСДАА хөтлөгдөнө", () => {
  const asset: FixedAssetRef = { ...ASSET, taxUsefulLifeMonths: 60 };
  const [row] = computeMonthlyDepreciation({
    assets: [asset],
    // Санхүүгийн нь бараг дуусаж, татварынх дөнгөж эхэлсэн байдал.
    postedAccum: new Map([["a1", 11_500_000]]),
    taxAccum: new Map([["a1", 200_000]]),
    alreadyCharged: new Set(),
    month: "2026-12",
  });
  assert.equal(row.amount, 500_000); // зөвхөн үлдсэн хэсэг
  assert.equal(row.taxAmount, 200_000); // татварынх хэвийн үргэлжилнэ
});

test("идэвхгүй / тухайн сард бодогдсон карт алгасагдана", () => {
  const rows = computeMonthlyDepreciation({
    assets: [{ ...ASSET, status: "disposed" }],
    postedAccum: new Map(),
    alreadyCharged: new Set(),
    month: "2026-01",
  });
  assert.equal(rows.length, 0);

  const skipped = computeMonthlyDepreciation({
    assets: [ASSET],
    postedAccum: new Map(),
    alreadyCharged: new Set(["a1"]),
    month: "2026-01",
  });
  assert.equal(skipped.length, 0);
});

test("өдрийн суурьт элэгдүүлсэн өдрийн тоо бичилтэд хадгалагдана", () => {
  const [row] = computeMonthlyDepreciation({
    assets: [ASSET],
    postedAccum: new Map(),
    alreadyCharged: new Set(),
    month: "2026-02",
    basis: "daily",
  });
  assert.equal(row.days, 28);
  const [monthly] = computeMonthlyDepreciation({
    assets: [ASSET],
    postedAccum: new Map(),
    alreadyCharged: new Set(),
    month: "2026-02",
  });
  assert.equal(monthly.days, 0);
});
