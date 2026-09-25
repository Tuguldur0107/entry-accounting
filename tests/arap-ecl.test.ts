// ENT-065: авлагын ECL (IFRS 9 хялбаршуулсан арга) ба хасалт — ЦЭВЭР тест.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ECL_MATRIX,
  bucketIndexOf,
  bucketLabel,
  eclChecklistStatus,
  eclJournalLines,
  eclMatrixProblems,
  planEclProvision,
  recoveryProblem,
  splitWriteOff,
} from "../lib/arap/ecl";

const AS_OF = "2026-09-30";

test("жишиг matrix зөв, хугацаа болоогүй нь эхний бүлэгт", () => {
  assert.deepEqual(eclMatrixProblems(DEFAULT_ECL_MATRIX), []);
  assert.equal(bucketIndexOf(DEFAULT_ECL_MATRIX, -10), 0);
  assert.equal(bucketIndexOf(DEFAULT_ECL_MATRIX, 30), 0);
  assert.equal(bucketIndexOf(DEFAULT_ECL_MATRIX, 31), 1);
  assert.equal(bucketIndexOf(DEFAULT_ECL_MATRIX, 366), 5);
  assert.equal(bucketLabel(DEFAULT_ECL_MATRIX, 5), "366+ хоног");
});

test("matrix-ийн шалгалт: хил өсөх, хувь буурахгүй, сүүлийнх хилгүй", () => {
  assert.match(eclMatrixProblems([{ maxDays: 30, ratePct: 1 }]).join(), /2 бүлэг/);
  const bad = eclMatrixProblems([
    { maxDays: 60, ratePct: 5 },
    { maxDays: 30, ratePct: 1 },
    { maxDays: 90, ratePct: 150 },
  ]).join(";");
  assert.match(bad, /хил өмнөхөөсөө их/);
  assert.match(bad, /хувь буурахгүй/);
  assert.match(bad, /0–100/);
  assert.match(bad, /дээд хилгүй/);
});

test("нөөц = Σ бүлэг × хувь, delta нь одоогийн нөөцөөс", () => {
  const plan = planEclProvision({
    asOf: AS_OF,
    items: [
      { dueDate: "2026-10-15", baseBalance: 1_000_000 }, // хугацаа болоогүй → 1%
      { dueDate: "2026-08-15", baseBalance: 2_000_000 }, // 46 хоног → 5%
      { dueDate: "2025-06-30", baseBalance: 500_000 }, // 457 хоног → 100%
      { dueDate: "2026-01-01", baseBalance: 0 }, // тоологдохгүй
    ],
    matrix: DEFAULT_ECL_MATRIX,
    currentAllowance: 400_000,
    taxRatePct: null,
    currentDeferredTaxAsset: 0,
  });
  assert.equal(plan.grossBalance, 3_500_000);
  assert.equal(plan.requiredAllowance, 10_000 + 100_000 + 500_000);
  assert.equal(plan.allowanceDelta, 210_000);
  assert.equal(plan.deferredTax, null, "ААНОАТ-ын хувь тохируулаагүй бол DTA бодохгүй");
  const lines = eclJournalLines(plan, AS_OF);
  assert.deepEqual(
    lines.map((line) => [line.role, line.debit, line.credit]),
    [
      ["expense", 210_000, 0],
      ["allowance", 0, 210_000],
    ]
  );
});

test("нөөц их байвал эргэлт; DTA-ийн delta тусдаа мөрөөр", () => {
  const plan = planEclProvision({
    asOf: AS_OF,
    items: [{ dueDate: "2026-09-01", baseBalance: 1_000_000 }],
    matrix: DEFAULT_ECL_MATRIX,
    currentAllowance: 50_000,
    taxRatePct: 10,
    currentDeferredTaxAsset: 5_000,
  });
  assert.equal(plan.requiredAllowance, 10_000);
  assert.equal(plan.allowanceDelta, -40_000);
  assert.deepEqual(plan.deferredTax, { ratePct: 10, requiredAsset: 1_000, currentAsset: 5_000, delta: -4_000 });
  const lines = eclJournalLines(plan, AS_OF);
  assert.deepEqual(
    lines.map((line) => [line.role, line.debit, line.credit]),
    [
      ["allowance", 40_000, 0],
      ["expense", 0, 40_000],
      ["deferredTaxExpense", 4_000, 0],
      ["deferredTaxAsset", 0, 4_000],
    ]
  );
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  assert.equal(debit, credit);
});

test("өөрчлөлтгүй бол журнал хоосон", () => {
  const plan = planEclProvision({
    asOf: AS_OF,
    items: [],
    matrix: DEFAULT_ECL_MATRIX,
    currentAllowance: 0,
    taxRatePct: 10,
    currentDeferredTaxAsset: 0,
  });
  assert.deepEqual(eclJournalLines(plan, AS_OF), []);
});

test("хасалт: нөөцөөс эхэлж, хүрэхгүй хэсэг нь зардал; нөөц Дт үлдэгдэлтэй болохгүй", () => {
  assert.deepEqual(splitWriteOff(1_000, 300), { fromAllowance: 300, toExpense: 700 });
  assert.deepEqual(splitWriteOff(1_000, 5_000), { fromAllowance: 1_000, toExpense: 0 });
  assert.deepEqual(splitWriteOff(1_000, -200), { fromAllowance: 0, toExpense: 1_000 });
});

test("сэргэлт: хассан дүнгийн үлдэгдлээс хэтрэхгүй", () => {
  assert.equal(recoveryProblem(400, 1_000, 500), null);
  assert.match(recoveryProblem(600, 1_000, 500)!, /RECOVERY_EXCEEDS/);
  assert.match(recoveryProblem(0, 1_000, 0)!, /0-ээс их/);
});

test("сар хаалтын ECL алхам: na / pending / attention / done", () => {
  const plan = (over: Partial<Parameters<typeof eclChecklistStatus>[0]["plan"]> = {}) => ({
    grossBalance: 1_000_000,
    currentAllowance: 0,
    allowanceDelta: 10_000,
    deferredTax: null,
    ...over,
  });
  // Авлага ч, нөөц ч алга → хамааралгүй.
  assert.equal(
    eclChecklistStatus({ plan: plan({ grossBalance: 0, allowanceDelta: 0 }), hasDraftInPeriod: false }),
    "na"
  );
  // Нөөц үлдсэн (авлага бүгд хаагдсан) → эргүүлэх шаардлагатай.
  assert.equal(
    eclChecklistStatus({
      plan: plan({ grossBalance: 0, currentAllowance: 5_000, allowanceDelta: -5_000 }),
      hasDraftInPeriod: false,
    }),
    "pending"
  );
  assert.equal(eclChecklistStatus({ plan: plan(), hasDraftInPeriod: false }), "pending");
  // Ноорог батлагдаагүй → анхаарах (delta-аас үл хамаарна).
  assert.equal(eclChecklistStatus({ plan: plan({ allowanceDelta: 0 }), hasDraftInPeriod: true }), "attention");
  assert.equal(
    eclChecklistStatus({ plan: plan({ currentAllowance: 10_000, allowanceDelta: 0 }), hasDraftInPeriod: false }),
    "done"
  );
  // DTA-ийн зөрүү үлдсэн бол бэлэн биш.
  assert.equal(
    eclChecklistStatus({
      plan: plan({
        currentAllowance: 10_000,
        allowanceDelta: 0,
        deferredTax: { ratePct: 10, requiredAsset: 1_000, currentAsset: 0, delta: 1_000 },
      }),
      hasDraftInPeriod: false,
    }),
    "pending"
  );
});
