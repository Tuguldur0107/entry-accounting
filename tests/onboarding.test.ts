import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  OPENING_DIFFERENCE_ACCOUNT,
  deriveOnboardingPhase,
  extractSection,
  formatOnboardingStatus,
  type OnboardingStatus,
} from "../lib/onboarding/guide";

// ─── Баримтаас хэсэг задлах ───────────────────────────────────────────────────

const SAMPLE_MD = `# Гарчиг

*толгой*

## 1. Зарчим

нэг

---

## 2. Материалын шалгах жагсаалт

| # | Материал |
|---|----------|
| 1 | TB |

---

## 3. Зөрүү шийдвэрлэх дүрэм

### R0 — a

текст

## 4. Шатууд

сүүлийн хэсэг
`;

test("extractSection: толгойгоос дараагийн '## ' хүртэл, төгсгөлийн --- хаягдана", () => {
  const section = extractSection(SAMPLE_MD, 2);
  assert.ok(section);
  assert.ok(section.startsWith("## 2. Материалын шалгах жагсаалт"));
  assert.ok(section.includes("| 1 | TB |"));
  // Хүснэгтийн |---| мөр үлдэнэ, хэсгийн ТӨГСГӨЛИЙН хуваагч л хаягдана.
  assert.ok(!section.endsWith("---"));
  assert.ok(!section.includes("\n---"));
  assert.ok(!section.includes("## 3."));
});

test("extractSection: дэд толгой (###) хэсгийг таслахгүй; сүүлийн хэсэг файлын төгсгөл хүртэл", () => {
  const rules = extractSection(SAMPLE_MD, 3);
  assert.ok(rules?.includes("### R0 — a"));
  assert.ok(!rules?.includes("## 4."));
  const phases = extractSection(SAMPLE_MD, 4);
  assert.ok(phases?.includes("сүүлийн хэсэг"));
  assert.equal(extractSection(SAMPLE_MD, 9), null);
});

test("бодит баримт: §2/§3/§4 олдож, §3-д R0–R9 бүгд байна", () => {
  const doc = readFileSync(
    path.join(process.cwd(), "docs", "deployment", "onboarding.md"),
    "utf8"
  );
  const checklist = extractSection(doc, 2);
  const rules = extractSection(doc, 3);
  const phases = extractSection(doc, 4);
  assert.ok(checklist && checklist.includes("cut-off"));
  assert.ok(rules);
  for (const rule of ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"])
    assert.ok(rules.includes(`### ${rule}`), `${rule} дутуу`);
  assert.ok(phases && phases.includes("| 5 Хүлээлгэн өгөх"));
  // Зөрүүний дансны нэр баримт ба код хоёрт ИЖИЛ (OD-ONB-1).
  assert.ok(doc.includes(OPENING_DIFFERENCE_ACCOUNT.number));
  assert.ok(doc.includes(OPENING_DIFFERENCE_ACCOUNT.name));
});

// ─── Шат тодорхойлох ─────────────────────────────────────────────────────────

function status(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    organizationName: "Тест ХХК",
    counts: {
      enabledAccounts: 120,
      counterparties: 0,
      inventoryItems: 0,
      warehouses: 0,
      cashAccounts: 0,
      employees: 0,
      fixedAssets: 0,
      postedVouchers: 0,
    },
    openingVoucher: null,
    openingSummaryDocs: 0,
    openingDiffDrafts: 0,
    openingAdjustments: 0,
    differenceAccount: null,
    cutoffPeriodClosed: false,
    latestClosedPeriod: null,
    ...overrides,
  };
}

test("шат 0: master data байхгүй, нээлт байхгүй → судалгаа, бичих алхам байхгүй", () => {
  const phase = deriveOnboardingPhase(status());
  assert.equal(phase.phase, 0);
  assert.ok(phase.nextSteps[0].includes("ЮУ Ч БИЧИХГҮЙ"));
});

test("шат 1: касс/харилцагч байгаа, нээлтийн журнал байхгүй; зөрүүний данс дутууг заана", () => {
  const phase = deriveOnboardingPhase(
    status({ counts: { ...status().counts, cashAccounts: 2, counterparties: 15 } })
  );
  assert.equal(phase.phase, 1);
  assert.ok(phase.nextSteps.some((step) => step.includes(OPENING_DIFFERENCE_ACCOUNT.number)));
});

test("шат 2: нээлтийн журнал ноорог → тулгалт, post дуудахгүй", () => {
  const phase = deriveOnboardingPhase(
    status({
      counts: { ...status().counts, cashAccounts: 1 },
      openingVoucher: { date: "2026-09-30", status: "draft", documentNo: "GL-26-000001" },
    })
  );
  assert.equal(phase.phase, 2);
  assert.ok(phase.nextSteps.some((step) => step.includes("get_trial_balance (2026-09-30)")));
  assert.ok(phase.nextSteps.some((step) => step.includes("ДУУДАХГҮЙ")));
});

test("шат 3: нээлт батлагдсан, зөрүүний ноорог үлдсэн", () => {
  const phase = deriveOnboardingPhase(
    status({
      counts: { ...status().counts, cashAccounts: 1 },
      openingVoucher: { date: "2026-09-30", status: "posted", documentNo: null },
      openingDiffDrafts: 2,
    })
  );
  assert.equal(phase.phase, 3);
  assert.ok(phase.reason.includes("2 зөрүүний ноорог"));
});

test("шат 4 → 5: зөрүү 0, cut-off сар нээлттэй → зэрэгцээ сар; хаагдсан → хүлээлгэн өгсөн", () => {
  const base = status({
    counts: { ...status().counts, cashAccounts: 1 },
    openingVoucher: { date: "2026-09-30", status: "posted", documentNo: null },
    openingSummaryDocs: 1,
  });
  const parallel = deriveOnboardingPhase(base);
  assert.equal(parallel.phase, 4);
  assert.ok(parallel.nextSteps.some((step) => step.includes("opening-summary:")));

  const done = deriveOnboardingPhase({
    ...base,
    cutoffPeriodClosed: true,
    latestClosedPeriod: "2026-09",
  });
  assert.equal(done.phase, 5);
  assert.ok(done.reason.includes("2026-09"));
});

test("ENT-019: ноорог 0 ч зөрүүний данс үлдэгдэлтэй бол шат 3", () => {
  const phase = deriveOnboardingPhase(
    status({
      counts: { ...status().counts, cashAccounts: 1 },
      openingVoucher: { date: "2024-12-31", status: "posted", documentNo: "GL-24-000001" },
      differenceAccount: { number: "44000098", name: OPENING_DIFFERENCE_ACCOUNT.name },
      differenceBalance: -41_045_520,
      openingDiffDrafts: 0,
    })
  );
  assert.equal(phase.phase, 3);
  assert.ok(phase.reason.includes("44000098"));
  assert.ok(phase.reason.includes("-41,045,520"));
});

test("formatOnboardingStatus: шат, тоолол, дараагийн алхам агуулна", () => {
  const text = formatOnboardingStatus(
    status({
      counts: { ...status().counts, counterparties: 3 },
      differenceAccount: { number: "44000098", name: OPENING_DIFFERENCE_ACCOUNT.name },
    })
  );
  assert.ok(text.includes("ШАТ 1/5"));
  assert.ok(text.includes("харилцагч 3"));
  assert.ok(text.includes("44000098"));
  assert.ok(text.includes("ДАРААГИЙН АЛХАМ:"));
});
