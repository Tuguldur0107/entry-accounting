import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DEMO_ORG_NAME,
  STARTER_PROMPTS,
  firstRunSteps,
  mcpPromptList,
  mcpPromptMessages,
  shouldShowWelcome,
  starterInstructionHint,
  startersFor,
  type FirstRunSignals,
} from "../lib/onboarding/first-run";

// Анхны туршилт («Entry-г 5 минутад мэдэр»): алхмын илрүүлэлт, карт харагдах
// нөхцөл, бэлэн асуултын нэг эх (нүүр, /ai, MCP prompts).

const base: FirstRunSignals = {
  hasDemoOrg: false,
  isDemoOrg: false,
  orgHasActivity: false,
  connected: false,
  toolUsed: false,
  isTrial: true,
  dismissed: false,
};

const done = (signals: FirstRunSignals) =>
  Object.fromEntries(firstRunSteps(signals).map((step) => [step.key, step.done]));

test("firstRunSteps — дараалал try → connect → ask, өгөгдлөөс автоматаар ✓", () => {
  assert.deepEqual(
    firstRunSteps(base).map((step) => step.key),
    ["try", "connect", "ask"]
  );
  assert.deepEqual(done(base), { try: false, connect: false, ask: false });
  assert.deepEqual(done({ ...base, hasDemoOrg: true }), { try: true, connect: false, ask: false });
  assert.deepEqual(done({ ...base, connected: true, toolUsed: true }), { try: false, connect: true, ask: true });
});

test("firstRunSteps — өөрийн дата бий бол демо шаардлагагүй; демо компанийн идэвх өөрийн дата биш", () => {
  assert.equal(done({ ...base, orgHasActivity: true }).try, true);
  // Демо компанид байгаа (идэвхтэй) ч гишүүнчлэл нь hasDemoOrg-оор ✓ болно
  assert.equal(done({ ...base, orgHasActivity: true, isDemoOrg: true }).try, false);
  assert.equal(done({ ...base, orgHasActivity: true, isDemoOrg: true, hasDemoOrg: true }).try, true);
});

test("shouldShowWelcome — туршилт / демо / хоосон байгууллагад л; хаасан, бүгд хийгдсэн бол үгүй", () => {
  assert.equal(shouldShowWelcome(base), true);
  assert.equal(shouldShowWelcome({ ...base, dismissed: true }), false);
  assert.equal(
    shouldShowWelcome({ ...base, hasDemoOrg: true, connected: true, toolUsed: true }),
    false,
    "3 алхам хийгдмэгц нуугдана"
  );
  // Идэвхтэй (туршилт биш) ажиллаж буй харилцагчид ХЭЗЭЭ Ч гарахгүй
  assert.equal(shouldShowWelcome({ ...base, isTrial: false, orgHasActivity: true }), false);
  // Туршилт биш ч хоосон байгууллага (dedicated шинэ суулгалт) — гарна
  assert.equal(shouldShowWelcome({ ...base, isTrial: false }), true);
  // Туршилт биш ч демо компанид — гарна (холбох, асуух алхам үлдсэн)
  assert.equal(
    shouldShowWelcome({ ...base, isTrial: false, orgHasActivity: true, isDemoOrg: true, hasDemoOrg: true }),
    true
  );
});

test("STARTER_PROMPTS — id давхцахгүй, MCP нэрийн хэлбэр, текст хоосон биш, бичилттэй нь тэмдэглэгдсэн", () => {
  const ids = STARTER_PROMPTS.map((prompt) => prompt.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const prompt of STARTER_PROMPTS) {
    assert.match(prompt.id, /^[a-z][a-z0-9_]+$/, prompt.id);
    assert.ok(prompt.title.length > 0 && prompt.title.length <= 40, `${prompt.id} гарчиг`);
    assert.ok(prompt.text.length >= 20, `${prompt.id} текст`);
  }
  assert.ok(STARTER_PROMPTS.some((prompt) => prompt.writes), "дор хаяж нэг ноорог үүсгэх жишээ");
  // Нүүрний карт эхний 4-ийг харуулна — нягтлан бодох багцад бүгд нягтлангийнх
  assert.ok(startersFor({ accounting: true, knowledge: true }).slice(0, 4).every((p) => p.feature === "accounting"));
});

test("startersFor — багцаар шүүнэ: «AI нягтлан» (skills) зөвхөн мэдлэгийн асуулт", () => {
  const skills = startersFor({ knowledge: true });
  assert.ok(skills.length >= 1);
  assert.ok(skills.every((prompt) => prompt.feature === "knowledge"));
  assert.equal(startersFor({}).length, 0);
  assert.equal(startersFor({ accounting: true, knowledge: true }).length, STARTER_PROMPTS.length);
});

test("MCP prompts/list ба prompts/get — нэг эх, багцад ороогүйг буцаахгүй", () => {
  const list = mcpPromptList({ accounting: true, knowledge: true });
  assert.equal(list.length, STARTER_PROMPTS.length);
  const draft = list.find((prompt) => prompt.name === "draft_invoice");
  assert.ok(draft && /ноорог/.test(draft.description), "бичилттэй асуулт ноорог гэж тайлбарлагдана");
  assert.deepEqual(list[0].arguments, []);

  const got = mcpPromptMessages("month_overview", { accounting: true });
  assert.ok(got);
  assert.equal(got.messages.length, 1);
  assert.equal(got.messages[0].role, "user");
  assert.equal(got.messages[0].content.text, STARTER_PROMPTS[0].text);

  assert.equal(mcpPromptMessages("month_overview", { knowledge: true }), null, "skills багцад нягтлангийн асуулт үгүй");
  assert.equal(mcpPromptMessages("nope", { accounting: true, knowledge: true }), null);
});

test("starterInstructionHint — MCP instructions-д жишээ гарчиг; боломжгүй бол хоосон", () => {
  const hint = starterInstructionHint({ accounting: true });
  assert.match(hint, /«Өнгөрсөн сарын тойм»/);
  assert.equal(starterInstructionHint({}), "");
});

test("демо компанийн нэр НЭГ эх — createDemoCompany ба илрүүлэлт ижил тогтмолоор", () => {
  const demo = readFileSync(path.join(process.cwd(), "lib/actions/demo.ts"), "utf8");
  assert.ok(demo.includes('import { DEMO_ORG_NAME } from "@/lib/onboarding/first-run"'));
  assert.ok(!/const DEMO_ORG_NAME\s*=/.test(demo), "demo.ts өөрийн нэрийн хуулбаргүй");
  assert.equal(DEMO_ORG_NAME, "Демо худалдааны компани", "бичигдсэн демо компаниудын нэр хэвээр");
});
