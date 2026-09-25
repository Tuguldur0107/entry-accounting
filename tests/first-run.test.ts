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

// Анхны туршилт (AI-тай нэвтрүүлэлт): алхмын илрүүлэлт, карт харагдах нөхцөл,
// бэлэн асуултын нэг эх (нүүр, /ai, MCP prompts).

const base: FirstRunSignals = {
  isDemoOrg: false,
  connected: false,
  orgHasMasterData: false,
  orgHasActivity: false,
  isTrial: true,
  dismissed: false,
};

const done = (signals: FirstRunSignals) =>
  Object.fromEntries(firstRunSteps(signals).map((step) => [step.key, step.done]));

test("firstRunSteps — холбох → хуучин дата → нээлтийн үлдэгдэл, өгөгдлөөс автоматаар ✓", () => {
  assert.deepEqual(
    firstRunSteps(base).map((step) => step.key),
    ["connect", "import", "opening"]
  );
  assert.deepEqual(done(base), { connect: false, import: false, opening: false });
  assert.deepEqual(done({ ...base, connected: true }), { connect: true, import: false, opening: false });
  assert.deepEqual(done({ ...base, orgHasMasterData: true }), { connect: false, import: true, opening: false });
  assert.deepEqual(done({ ...base, orgHasActivity: true }), { connect: false, import: false, opening: true });
});

test("firstRunSteps — алхам бүрийн бэлэн асуулт бодит жагсаалтад бий", () => {
  const ids = new Set(STARTER_PROMPTS.map((prompt) => prompt.id));
  for (const step of firstRunSteps(base)) for (const id of step.promptIds) assert.ok(ids.has(id), `${step.key} → ${id}`);
  assert.deepEqual(firstRunSteps(base)[1].promptIds, ["import_master_data"]);
});

test("shouldShowWelcome — туршилт / журналгүй байгууллагад л; хаасан, демо, бүгд хийгдсэн бол үгүй", () => {
  assert.equal(shouldShowWelcome(base), true);
  assert.equal(shouldShowWelcome({ ...base, dismissed: true }), false);
  assert.equal(shouldShowWelcome({ ...base, isDemoOrg: true }), false, "демо компанид жишээ дата — нэвтрүүлэлтийн карт хэрэггүй");
  assert.equal(
    shouldShowWelcome({ ...base, connected: true, orgHasMasterData: true, orgHasActivity: true }),
    false,
    "3 алхам хийгдмэгц нуугдана"
  );
  // Идэвхтэй (туршилт биш) ажиллаж буй харилцагчид ХЭЗЭЭ Ч гарахгүй
  assert.equal(shouldShowWelcome({ ...base, isTrial: false, orgHasActivity: true }), false);
  // Туршилт биш ч журналгүй байгууллага (dedicated шинэ суулгалт) — гарна
  assert.equal(shouldShowWelcome({ ...base, isTrial: false }), true);
  // Туршилтын хугацаанд дата орсон ч холбоогүй бол — гарна (холбох алхам үлдсэн)
  assert.equal(shouldShowWelcome({ ...base, orgHasMasterData: true, orgHasActivity: true }), true);
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
  // Эхний гурав нь нэвтрүүлэлт — MCP instructions-ийн жишээ, «+» цэсийн эхэнд
  assert.deepEqual(
    STARTER_PROMPTS.slice(0, 3).map((prompt) => prompt.id),
    ["import_master_data", "import_opening_balances", "onboarding_check"]
  );
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
  assert.equal(got.messages[0].content.text, STARTER_PROMPTS.find((prompt) => prompt.id === "month_overview")!.text);

  assert.equal(mcpPromptMessages("month_overview", { knowledge: true }), null, "skills багцад нягтлангийн асуулт үгүй");
  assert.equal(mcpPromptMessages("nope", { accounting: true, knowledge: true }), null);
});

test("starterInstructionHint — MCP instructions-д жишээ гарчиг; боломжгүй бол хоосон", () => {
  const hint = starterInstructionHint({ accounting: true });
  assert.match(hint, /«Хуучин датагаа оруулах»/);
  assert.equal(starterInstructionHint({}), "");
});

test("welcome-card — демо компани картад БАЙХГҮЙ, карт харагдаж байхад checklist-ийн демо мөр нуугдана", () => {
  const card = readFileSync(path.join(process.cwd(), "components/dashboard/welcome-card.tsx"), "utf8");
  assert.ok(!card.includes("DemoCompanyButton"), "картад демо товч байхгүй");
  assert.ok(!/демо компани/i.test(card.replace(/^\/\/.*$/gm, "")), "картын текстэд демо компани дурдагдахгүй");
  const home = readFileSync(path.join(process.cwd(), "components/dashboard/home-dashboard.tsx"), "utf8");
  assert.ok(home.includes("showDemo={!welcome}"), "нүүрний демо мөр карт харагдаж байхад нуугдана");
});

test("демо компанийн нэр НЭГ эх — createDemoCompany ба илрүүлэлт ижил тогтмолоор", () => {
  const demo = readFileSync(path.join(process.cwd(), "lib/actions/demo.ts"), "utf8");
  assert.ok(demo.includes('import { DEMO_ORG_NAME } from "@/lib/onboarding/first-run"'));
  assert.ok(!/const DEMO_ORG_NAME\s*=/.test(demo), "demo.ts өөрийн нэрийн хуулбаргүй");
  assert.equal(DEMO_ORG_NAME, "Демо худалдааны компани", "бичигдсэн демо компаниудын нэр хэвээр");
});
