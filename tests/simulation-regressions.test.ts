// SIM Trade ХХК симуляцийн олдворуудын (entry_simulation_issues.xlsx, ENT-xxx)
// DB integration регресс тест. DATABASE_URL шаарддаг (ai-tools-flow-тэй ижил
// хэв маяг): түр байгууллага үүсгэж, төгсгөлд нь cascade-аар устгана.

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
  // патчлагдахгүй орчинд okOrRevalidate fallback ажиллана
}

import { executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { db } from "../lib/db";
import { memberships, organizations, users } from "../lib/db/schema";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

let userId = "";
let orgId = "";

function okOrRevalidate(resultText: string): boolean {
  return !resultText.startsWith("Алдаа") || resultText.includes("static generation store");
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `sim-${STAMP}`, email: `sim-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `SIM регресс ${STAMP}` })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, `стандарт данс: ${sync.error}`);
}

export function tool(name: string, input: unknown, mode: "draft" | "post" = "draft") {
  return runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
}

test("ENT-069: get_counterparty_balance SQL алдаагүй, asOf-оор үлдэгдэл/aging", { skip: !DB_READY }, async () => {
  await setupOrg();
  const cp = await tool("create_counterparty", { name: "Скай Трэйдинг", counterpartyType: "customer" });
  assert.ok(okOrRevalidate(cp.resultText), cp.resultText);
  const invoice = await tool(
    "create_arap_invoice",
    {
      documentType: "ar_invoice",
      counterparty: "Скай Трэйдинг",
      date: "2025-01-10",
      dueDate: "2025-02-09",
      description: "Борлуулалт",
      externalRef: `sim-${STAMP}-ar1`,
      lines: [{ account: "51100000", description: "Бараа", amount: 2_750_000 }],
    },
    "post"
  );
  assert.ok(okOrRevalidate(invoice.resultText), invoice.resultText);

  const balance = await tool("get_counterparty_balance", {
    counterparty: "Скай",
    asOf: "2025-03-31",
    aging: true,
  });
  assert.ok(!balance.resultText.startsWith("Алдаа"), balance.resultText);
  assert.match(balance.resultText, /2,750,000/);

  const before = await tool("get_counterparty_balance", { asOf: "2025-01-05" });
  assert.ok(!before.resultText.startsWith("Алдаа"), before.resultText);
  assert.doesNotMatch(before.resultText, /2,750,000/);
});

test("цэвэрлэгээ", { skip: !DB_READY }, async () => {
  for (const fn of cleanup.reverse()) await fn();
});
