// AI саналын үр дүнгийн төлвийн машин + СУРГАЛТЫН шүүлтүүр — цэвэр тест.
// DATABASE_URL ШААРДАХГҮЙ.

import test from "node:test";
import assert from "node:assert/strict";

import { AI_RESOLUTIONS } from "../lib/ai-logging/constants";
import {
  canTransition,
  isTerminalResolution,
  isTrainingEligible,
  producesDocument,
  trainingExclusionReason,
} from "../lib/ai-logging/resolution";

// ── Шилжилтүүд ─────────────────────────────────────────────────────────────

test("no_action-оос бүх төлөв рүү шилжиж болно", () => {
  assert.ok(canTransition("no_action", "accepted"));
  assert.ok(canTransition("no_action", "modified"));
  assert.ok(canTransition("no_action", "rejected"));
});

test("accepted → modified / rejected зөвшөөрөгдөнө", () => {
  assert.ok(canTransition("accepted", "modified"));
  assert.ok(canTransition("accepted", "rejected"));
});

test("modified → accepted / rejected зөвшөөрөгдөнө", () => {
  assert.ok(canTransition("modified", "accepted"));
  assert.ok(canTransition("modified", "rejected"));
});

test("rejected нь ЭЦСИЙН — хаашаа ч шилжихгүй", () => {
  assert.ok(isTerminalResolution("rejected"));
  assert.ok(!canTransition("rejected", "accepted"));
  assert.ok(!canTransition("rejected", "modified"));
  assert.ok(!canTransition("rejected", "no_action"));
});

test("байгаа төлөв рүү буцаж шилжихийг хориглоно (no_action руу)", () => {
  // Шийдэгдсэн саналыг «шийдээгүй» болгох нь шошгыг устгана.
  assert.ok(!canTransition("accepted", "no_action"));
  assert.ok(!canTransition("modified", "no_action"));
});

test("ижил төлөв рүү шилжих нь ИДЕМПОТЕНТ (дахин бичилт унахгүй)", () => {
  for (const value of AI_RESOLUTIONS)
    assert.ok(canTransition(value, value), `${value} → ${value} зөвшөөрөгдөх ёстой`);
});

test("зөвхөн accepted / modified нь баримт үүсгэнэ", () => {
  assert.ok(producesDocument("accepted"));
  assert.ok(producesDocument("modified"));
  assert.ok(!producesDocument("rejected"));
  assert.ok(!producesDocument("no_action"));
});

// ── Сургалтын шүүлтүүр ─────────────────────────────────────────────────────

const base = {
  isPosted: true,
  isPeriodClosed: true,
  hasReversal: false,
};

test("батлагдсан + үе хаагдсан + буцаалтгүй = сургалтын шошго", () => {
  assert.ok(isTrainingEligible(base));
  assert.equal(trainingExclusionReason(base), null);
});

test("ноорог хэвээр бол сургалтад ОРОХГҮЙ", () => {
  const row = { ...base, isPosted: false };
  assert.ok(!isTrainingEligible(row));
  assert.equal(trainingExclusionReason(row), "Бичилт батлагдаагүй");
});

test("үе хаагдаагүй бол сургалтад ОРОХГҮЙ", () => {
  const row = { ...base, isPeriodClosed: false };
  assert.ok(!isTrainingEligible(row));
  assert.equal(trainingExclusionReason(row), "Тайлант үе хаагдаагүй");
});

// ── ГОЛ шалгуур: буцаалтын нүх (хэрэглэгчийн A хэсэг) ─────────────────────

test("хаагдсаны ДАРАА буцаагдсан бичилт сургалтад ОРОХГҮЙ", () => {
  // Дараалал: AI санал → нябо зөвшөөрөв → постлогдов → сар хаагдав
  //         → ДАРАА нь алдаа илэрч БУЦААЛТ хийгдэв.
  // Энэ мөр нь `is_posted && is_period_closed` хоёуланг хангасан ч
  // үнэндээ AI АЛДСАН тохиолдол — эерэг шошгоор сургавал загварыг
  // ЗОРИУДААР буруу сургахтай тэнцэнэ.
  const reversed = { ...base, hasReversal: true };
  assert.ok(
    !isTrainingEligible(reversed),
    "буцаагдсан бичилт эерэг шошго болж БОЛОХГҮЙ"
  );
  assert.equal(
    trainingExclusionReason(reversed),
    "Баримт хожим буцаагдсан / хүчингүй болсон"
  );
});

test("шүүлтүүрийн бүрэн үнэний хүснэгт (2³ = 8 хослол)", () => {
  const rows: { p: boolean; c: boolean; r: boolean; want: boolean }[] = [
    { p: true, c: true, r: false, want: true }, // ✅ цорын ганц эерэг тохиолдол
    { p: true, c: true, r: true, want: false }, // буцаагдсан
    { p: true, c: false, r: false, want: false }, // үе нээлттэй
    { p: true, c: false, r: true, want: false },
    { p: false, c: true, r: false, want: false }, // ноорог
    { p: false, c: true, r: true, want: false },
    { p: false, c: false, r: false, want: false },
    { p: false, c: false, r: true, want: false },
  ];
  for (const row of rows)
    assert.equal(
      isTrainingEligible({
        isPosted: row.p,
        isPeriodClosed: row.c,
        hasReversal: row.r,
      }),
      row.want,
      `posted=${row.p} closed=${row.c} reversal=${row.r}`
    );
});

test("устгагдсан баримт (rejected + has_reversal) сургалтад ОРОХГҮЙ", () => {
  assert.ok(
    !isTrainingEligible({
      isPosted: true,
      isPeriodClosed: true,
      hasReversal: true,
    })
  );
});
