// «AI нягтлан» (skills) багц — 2026-09-24 шийдвэр:
//   • Entry-ийн SaaS нягтлан бодох багц бүрд мэдлэгийн сан ҮНЭГҮЙ дагалдана
//   • Систем ашиглахгүй бол «AI нягтлан»: мэдлэг + MCP л, 29,000₮/сар, trial 24ц
//   • dedicated (fork)-д мэдлэгийн сан ОРОХГҮЙ (D2 хэвээр)
//   • Skills багцаар нягтлан бодох систем, tool ХААЛТТАЙ (үнэгүй систем болохоос)
import assert from "node:assert/strict";
import test from "node:test";

import { featureUsable, resolveEntitlements, type SubscriptionRecord } from "../lib/billing/entitlements";
import { PLANS, SKILLS_TRIAL_HOURS } from "../lib/billing/plans";
import { ACCOUNTING_FREE_TOOLS, toolInPlan } from "../lib/billing/tool-scope";

const NOW = new Date("2026-09-24T12:00:00Z");
const HOUR = 60 * 60_000;

function sub(patch: Partial<SubscriptionRecord>): SubscriptionRecord {
  return { planId: "skills", status: "active", seats: null, trialEndsAt: null, currentPeriodEnd: null, overrides: null, ...patch };
}
const saas = (subscription: SubscriptionRecord | null) =>
  resolveEntitlements({ mode: "saas", subscription, orgCreatedAt: new Date(NOW.getTime() - HOUR), now: NOW });

test("багц: мэдлэгийн сан SaaS багц бүрд, dedicated-д үгүй; skills = мэдлэг + MCP л", () => {
  for (const id of ["trial", "standard", "platform", "enterprise"] as const) {
    assert.equal(PLANS[id].features.knowledge, true, `${id} мэдлэгтэй`);
    assert.equal(PLANS[id].features.accounting, true, `${id} системтэй`);
  }
  assert.equal(PLANS.dedicated.features.knowledge, false);
  assert.equal(PLANS.dedicated.features.accounting, true);
  const skills = PLANS.skills.features;
  assert.deepEqual(
    Object.entries(skills).filter(([, on]) => on).map(([key]) => key).sort(),
    ["knowledge", "mcp"]
  );
  assert.equal(PLANS.skills.pricePerSeatMnt, 29_000);
  assert.equal(SKILLS_TRIAL_HOURS, 24);
});

test("entitlement: dedicated горимд мэдлэгийн сан ХААЛТТАЙ", () => {
  const ent = resolveEntitlements({ mode: "dedicated", subscription: null, orgCreatedAt: NOW, now: NOW });
  assert.equal(featureUsable(ent, "knowledge"), false);
  assert.equal(featureUsable(ent, "accounting"), true);
});

test("skills trial: 24 цагийн дотор мэдлэг нээлттэй, дуусмагц хаагдана", () => {
  const trialEndsAt = new Date(NOW.getTime() + SKILLS_TRIAL_HOURS * HOUR);
  const live = saas(sub({ status: "trialing", trialEndsAt }));
  assert.equal(live.planId, "skills");
  assert.equal(featureUsable(live, "knowledge"), true);
  assert.equal(featureUsable(live, "accounting"), false);

  const expired = saas(sub({ status: "trialing", trialEndsAt: new Date(NOW.getTime() - HOUR) }));
  assert.equal(expired.readOnlyReason, "trial_expired");
  // Мэдлэг бол захиалгын бүтээгдэхүүн — read-only үед «унших үргэлж» хамаарахгүй
  assert.equal(featureUsable(expired, "knowledge"), false);
});

test("идэвхтэй skills захиалга: мэдлэг нээлттэй; цуцлагдвал хаалттай", () => {
  assert.equal(featureUsable(saas(sub({ status: "active" })), "knowledge"), true);
  assert.equal(featureUsable(saas(sub({ status: "cancelled" })), "knowledge"), false);
});

test("Entry-ийн standard харилцагч: мэдлэг үнэгүй дагалдана; Console override-оор унтрааж болно", () => {
  assert.equal(featureUsable(saas(sub({ planId: "standard" })), "knowledge"), true);
  const off = saas(sub({ planId: "standard", overrides: { features: { knowledge: false } } }));
  assert.equal(featureUsable(off, "knowledge"), false);
  // Мөргүй SaaS байгууллага = Entry trial → мэдлэг ч дагалдана
  assert.equal(featureUsable(saas(null), "knowledge"), true);
});

test("tool хүрээ: skills багцад зөвхөн мэдлэгийн tool, систем бүрэн", () => {
  const skills = saas(sub({ status: "active" }));
  assert.equal(toolInPlan(skills, "read_knowledge_section"), true);
  assert.equal(toolInPlan(skills, "list_knowledge_topics"), true);
  assert.equal(toolInPlan(skills, "get_billing_overview"), true);
  for (const name of ["create_journal_voucher", "list_counterparties", "create_pos_sale", "get_trial_balance"])
    assert.equal(toolInPlan(skills, name), false, name);

  const standard = saas(sub({ planId: "standard" }));
  assert.equal(toolInPlan(standard, "create_journal_voucher"), true);
  assert.equal(toolInPlan(standard, "read_knowledge_section"), true);
});

test("ACCOUNTING_FREE_TOOLS-ийн tool бүр бодит tool-ийн нэр (нэр солигдвол тест унана)", async () => {
  const { allAiTools } = await import("../lib/ai/tools");
  const names = new Set(allAiTools().map((tool) => tool.name));
  for (const name of ACCOUNTING_FREE_TOOLS) assert.ok(names.has(name), name);
});
