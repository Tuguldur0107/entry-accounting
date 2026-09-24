// «AI нягтлан» (skills) багц — integration тест (DATABASE_URL шаарддаг).
//  • Нягтлан бодох системийн action (уншилт ч) хаалттай → [FEATURE_NOT_IN_PLAN]
//  • AI/MCP: системийн tool хаалттай, мэдлэгийн tool нээлттэй; tools/list шүүгдэнэ
//  • 24 цагийн trial дуусмагц мэдлэгийн сан хаагдана
//  • Standard руу шилжмэгц систем нээгдэнэ (мэдлэг үнэгүй дагалдана)
// Түр байгууллага үүсгэж, төгсгөлд нь устгана.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчин
}

// Багцын шалгалт зөвхөн SaaS горимд (dedicated-д бүх боломж нээлттэй).
process.env.ENTRY_DEPLOYMENT_MODE = "saas";

import { runAsOrg } from "../lib/auth";
import { db } from "../lib/db";
import { memberships, organizationSubscriptions, organizations, users } from "../lib/db/schema";
import { createInventoryCategory } from "../lib/actions/inventory";
import { executeAiTool } from "../lib/ai/tools";
import { handleMcpPost } from "../lib/mcp/server";
import { ACCOUNTING_FREE_TOOLS } from "../lib/billing/tool-scope";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const HOUR = 60 * 60_000;
let userId = "";
let orgId = "";

const asOrg = <T>(fn: () => Promise<T>) => runAsOrg({ userId, orgId }, fn);
const tool = (name: string, args: unknown = {}) =>
  asOrg(() => executeAiTool(userId, name, args, "draft")).then((r) => r.resultText);

async function mcp(method: string) {
  const response = await handleMcpPost(
    { userId, orgId },
    new Request("http://localhost/api/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
    })
  );
  return (await response.json()) as { result: Record<string, unknown> };
}

test("бэлтгэл — «AI нягтлан» захиалгатай түр байгууллага (trial 24ц)", { skip: !DB_READY }, async () => {
  const [user] = await db
    .insert(users)
    .values({ name: `skills-${STAMP}`, email: `skills-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `Skills Test ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  await db.insert(organizationSubscriptions).values({
    organizationId: org.id,
    planId: "skills",
    status: "trialing",
    trialEndsAt: new Date(Date.now() + 24 * HOUR),
  });
  userId = user.id;
  orgId = org.id;
});

test("систем хаалттай: модулийн action (owner байсан ч) → FEATURE_NOT_IN_PLAN", { skip: !DB_READY }, async () => {
  const created = await asOrg(() => createInventoryCategory({ code: "X", name: "X" }));
  assert.match(created.error ?? "", /AI нягтлан/);
});

test("AI/MCP: системийн tool хаалттай, мэдлэгийн tool нээлттэй", { skip: !DB_READY }, async () => {
  assert.match(await tool("list_counterparties"), /FEATURE_NOT_IN_PLAN/);
  assert.match(await tool("create_journal_voucher", { date: "2026-09-24", lines: [] }), /FEATURE_NOT_IN_PLAN/);
  const topics = await tool("list_knowledge_topics");
  assert.doesNotMatch(topics, /FEATURE_NOT_IN_PLAN|SUBSCRIPTION_READ_ONLY/);
});

test("MCP tools/list: зөвхөн багцын tool; instructions нь мэдлэгийн сангийнх", { skip: !DB_READY }, async () => {
  const listed = (await mcp("tools/list")).result.tools as { name: string }[];
  const names = listed.map((entry) => entry.name);
  assert.ok(names.includes("read_knowledge_section"));
  assert.ok(names.every((name) => ACCOUNTING_FREE_TOOLS.has(name)), names.join(", "));
  const init = await mcp("initialize");
  assert.match(String(init.result.instructions), /AI нягтлан/);
});

test("trial дуусмагц мэдлэгийн сан хаагдана", { skip: !DB_READY }, async () => {
  await db
    .update(organizationSubscriptions)
    .set({ trialEndsAt: new Date(Date.now() - HOUR) })
    .where(eq(organizationSubscriptions.organizationId, orgId));
  assert.match(await tool("list_knowledge_topics"), /туршилтын хугацаа дууссан/);
});

test("Standard руу шилжмэгц систем нээгдэж, мэдлэг үнэгүй дагалдана", { skip: !DB_READY }, async () => {
  await db
    .update(organizationSubscriptions)
    .set({ planId: "standard", status: "active", trialEndsAt: null })
    .where(eq(organizationSubscriptions.organizationId, orgId));
  const created = await asOrg(() => createInventoryCategory({ code: "OK", name: "Нээлттэй" }));
  assert.equal(created.error, undefined);
  assert.doesNotMatch(await tool("list_knowledge_topics"), /FEATURE_NOT_IN_PLAN|SUBSCRIPTION_READ_ONLY/);
  const listed = (await mcp("tools/list")).result.tools as { name: string }[];
  assert.ok(listed.some((entry) => entry.name === "create_journal_voucher"));
  const init = await mcp("initialize");
  assert.match(String(init.result.instructions), /get_onboarding_guide/);
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  await db.delete(organizations).where(eq(organizations.id, orgId));
  await db.delete(users).where(eq(users.id, userId));
});
