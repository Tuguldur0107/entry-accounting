import test from "node:test";
import assert from "node:assert/strict";

import {
  computeMonthlyDepreciation,
  depreciationForMonth,
  type FixedAssetRef,
} from "../lib/fa/depreciation";
import {
  accumDepAccountFor,
  computeFaDisposal,
  faDisposalJournalTotal,
  isOpeningBalanceVoucher,
  normalizeFaOpening,
} from "../lib/fa/opening";

// SIM Trade: «Дэлгүүрийн тавиур» — өртөг 12,000,000, 48 сар (2021-04 эхэлсэн),
// 2024-12-31-нд 11,250,000 хуримтлагдсан → 2025-03-т бүрэн элэгдэнэ.
const SHELF: FixedAssetRef = {
  id: "shelf",
  cost: 12_000_000,
  salvageValue: 0,
  usefulLifeMonths: 48,
  method: "straight_line",
  depreciationStartMonth: "2021-04",
  status: "active",
  openingAsOf: "2024-12-31",
};
const OPENING = 11_250_000;

function run(asset: FixedAssetRef, opening: number, months: string[]) {
  const accum = new Map([[asset.id, opening]]);
  const charged: Record<string, number> = {};
  for (const month of months) {
    const [row] = computeMonthlyDepreciation({
      assets: [asset],
      postedAccum: accum,
      alreadyCharged: new Set(),
      month,
    });
    charged[month] = row?.amount ?? 0;
    accum.set(asset.id, Math.round(((accum.get(asset.id) ?? 0) + (row?.amount ?? 0)) * 100) / 100);
  }
  return { charged, accum: accum.get(asset.id)! };
}

test("ENT-002: нээлтийн хуримтлагдсантай хөрөнгө үлдсэн сард л элэгдэж ЗОГСОНО", () => {
  const { charged, accum } = run(SHELF, OPENING, [
    "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-09",
  ]);
  assert.equal(charged["2024-12"], 0, "cut-off сар нээлтэд багтсан");
  assert.equal(charged["2025-01"], 250_000);
  assert.equal(charged["2025-03"], 250_000);
  assert.equal(charged["2025-04"], 0, "ENT-049: хугацаа дууссан");
  assert.equal(charged["2025-09"], 0);
  assert.equal(accum, 12_000_000);
});

test("ENT-002: нээлтгүй бол хугацаа дууссан хөрөнгө дахин элэгдэхгүй (IAS 16.55)", () => {
  const asset: FixedAssetRef = { ...SHELF, openingAsOf: null };
  assert.equal(depreciationForMonth(asset, 0, "2025-06"), 0);
  assert.equal(depreciationForMonth(asset, 0, "2025-03"), 12_000_000, "сүүлийн сар үлдэгдлийг хаана");
});

test("сүүлийн сард бөөрөнхийллийн үлдэгдэл хаагдана (0.01 дараагийн сард гарахгүй)", () => {
  const asset: FixedAssetRef = {
    ...SHELF, cost: 1000, usefulLifeMonths: 3, depreciationStartMonth: "2025-01", openingAsOf: null,
  };
  const { charged, accum } = run(asset, 0, ["2025-01", "2025-02", "2025-03", "2025-04"]);
  assert.deepEqual(charged, { "2025-01": 333.33, "2025-02": 333.33, "2025-03": 333.34, "2025-04": 0 });
  assert.equal(accum, 1000);
});

test("×2 үлдэгдэл буурах: нээлтийн хуримтлагдсан NBV-д тооцогдоно", () => {
  const asset: FixedAssetRef = {
    ...SHELF, method: "declining_balance", usefulLifeMonths: 60, depreciationStartMonth: "2024-01",
    openingAsOf: "2024-12-31",
  };
  // NBV = 12,000,000 − 3,000,000 = 9,000,000 → ×2/60 = 300,000
  assert.equal(depreciationForMonth(asset, 3_000_000, "2025-01"), 300_000);
});

test("ENT-066: данснаас хасалт нээлтийн хуримтлагдсаныг хамт хаана", () => {
  // Өртөг 12,000,000, нээлт 11,250,000, систем 750,000, борлуулалт 500,000 → олз 500,000
  assert.deepEqual(
    computeFaDisposal({ cost: 12_000_000, openingAccum: 11_250_000, postedAccum: 750_000, proceeds: 500_000 }),
    { accumulated: 12_000_000, netBookValue: 0, gainLoss: -500_000 }
  );
  assert.deepEqual(
    computeFaDisposal({ cost: 5_000_000, openingAccum: 0, postedAccum: 1_000_000, proceeds: 0 }),
    { accumulated: 1_000_000, netBookValue: 4_000_000, gainLoss: 4_000_000 }
  );
});

test("нээлтийн талбарын шалгалт", () => {
  assert.deepEqual(normalizeFaOpening({ cost: 1000, salvageValue: 0 }), {
    openingAccumulatedDepreciation: 0,
    openingTaxAccumulated: 0,
    openingAsOf: null,
  });
  assert.throws(
    () => normalizeFaOpening({ cost: 1000, salvageValue: 100, openingAccumulatedDepreciation: 950, openingAsOf: "2024-12-31" }),
    /элэгдүүлэх дүнгээс/
  );
  assert.throws(
    () => normalizeFaOpening({ cost: 1000, salvageValue: 0, openingAccumulatedDepreciation: 10 }),
    /НЭЭЛТИЙН ОГНОО/
  );
  assert.throws(
    () => normalizeFaOpening({ cost: 1000, salvageValue: 0, openingAccumulatedDepreciation: -1, openingAsOf: "2024-12-31" }),
    /сөрөг бус/
  );
  assert.throws(
    () => normalizeFaOpening({ cost: 1000, salvageValue: 0, openingAccumulatedDepreciation: 1, openingAsOf: "2024-02-30" }),
    /хуанлид байхгүй/
  );
});

test("ENT-046: нээлтийн журнал танигдана", () => {
  assert.equal(isOpeningBalanceVoucher({ externalRef: "opening-balance:2024-12-31" }), true);
  assert.equal(isOpeningBalanceVoucher({ externalRef: "opening-summary:fa" }), true);
  assert.equal(isOpeningBalanceVoucher({ description: "[ОНБ] Нээлтийн үлдэгдэл 2024-12-31" }), true);
  assert.equal(isOpeningBalanceVoucher({ externalRef: "ap-123", description: "Компьютер" }), false);
});

test("ENT-001: хуримтлагдсан элэгдлийн анхдагч данс биет ҮХ-д 20000002", () => {
  assert.equal(accumDepAccountFor("20000001"), "20000002");
  assert.equal(accumDepAccountFor("21010000"), "20000002");
  assert.equal(accumDepAccountFor("21000001"), "21000099");
});

test("Аудит M: хасалтын журналын нийт дүн = өртөг + олз (AI хязгаарын суурь)", () => {
  // бүрэн элэгдсэн 12 сая, 500 мянгаар зарсан → олз 500k → журнал 12.5 сая
  assert.equal(faDisposalJournalTotal({ cost: 12_000_000, gainLoss: -500_000 }), 12_500_000);
  // гарзтай бол журнал = өртөг (гарз нь Dr талд багтана)
  assert.equal(faDisposalJournalTotal({ cost: 5_000_000, gainLoss: 4_000_000 }), 5_000_000);
});
