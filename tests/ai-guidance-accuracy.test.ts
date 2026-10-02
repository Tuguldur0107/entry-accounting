// AI-д өгөх заавар ↔ бодит зан төлөв (docs/ontology-audit.md M7, §4.2).
// MCP instructions «нээлт/залруулга үргэлж ноорог», ONBOARDING_LIMITS «период
// хаалт үргэлж хүний баталгаа» гэдэг байсан ч 'Шууд бичих' горимд нээлтийн
// журнал хязгаар дотор ШУУД батлагдаж, close_period сарыг ШУУД хаадаг — AI
// хэрэглэгчид худал хэлдэг байв. Product owner (2026-10-02): зан төлөв хэвээр,
// заавар бодит байдлыг хэлнэ. Энэ тест хоёуланг нь зэрэг түгжинэ: зан төлөв
// өөрчлөгдвөл заавар ч ХАМТ шинэчлэгдэнэ.
// DB хэсэг DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import { journalVouchers, memberships, organizations, users } from "../lib/db/schema";
import { ONBOARDING_LIMITS } from "../lib/onboarding/guide";
import { purgeOrganization } from "../lib/org/purge";

/** Худал болсон хуучин нотолгоо — заавар/UI-д дахин орохгүй. */
const FALSE_CLAIMS = [
  /нээлт\/залруулга үргэлж ноорог/i,
  /залруулгын журнал үүнд ХАМААРАХГҮЙ/,
  /Период хаалт[^"]*үргэлж хүний баталгаа/,
  /сар хаалт, цалин үргэлж ноорог/,
];

test("заавар: хуучин худал нотолгоо алга, бодит зан төлөвийг хэлнэ", () => {
  const texts = {
    "lib/mcp/server.ts": fs.readFileSync("lib/mcp/server.ts", "utf8"),
    "components/ai/ai-connect-view.tsx": fs.readFileSync("components/ai/ai-connect-view.tsx", "utf8"),
    ONBOARDING_LIMITS: ONBOARDING_LIMITS.join("\n"),
  };
  for (const [name, text] of Object.entries(texts))
    for (const claim of FALSE_CLAIMS) assert.doesNotMatch(text, claim, `${name}: ${claim}`);

  const mcp = texts["lib/mcp/server.ts"];
  assert.match(mcp, /нээлт\/залруулгын журнал, нээлтийн/);
  assert.match(mcp, /close_period/);
  const limits = texts.ONBOARDING_LIMITS;
  assert.match(limits, /нээлт, зөрүү, залруулгын журнал, нээлтийн бараа ч МӨН/);
  assert.match(limits, /сар хаах\/дахин нээх зөвхөн 'Шууд бичих' горимд/);
});

// ─── DB: зааврын хэлж буй зан төлөв ────────────────────────────────────────────

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const tool = (name: string, input: unknown, mode: "draft" | "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `m7-${STAMP}`, email: `m7-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `M7 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

async function openingVoucher(externalRef: string, amount: number) {
  const result = await tool("create_journal_voucher", {
    date: "2025-01-01",
    description: `[ОНБ] нээлт ${externalRef}`,
    externalRef,
    lines: [
      { account: "11000001", debit: amount },
      { account: "44000001", credit: amount },
    ],
  }, "post");
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.externalRef, externalRef)),
  });
}

test("'Шууд бичих': нээлтийн журнал хязгаар дотор батлагдана, хязгаараас их нь ноорог", { skip: !DB_READY }, async () => {
  await setupOrg();
  assert.equal((await openingVoucher("opening-balance:2025-01-01", 1_000_000))?.status, "posted");
  assert.equal((await openingVoucher("opening-adj:2025-01-01:1", 50_000_000))?.status, "draft");
});

test("close_period: 'Ноорог' горимд хаахгүй — зөвхөн 'Шууд бичих' горимд", { skip: !DB_READY }, async () => {
  await setupOrg();
  const result = await tool("close_period", { code: "2024-12" }, "draft");
  assert.match(result.resultText, /DIRECT_MODE_REQUIRED/, result.resultText);
});
