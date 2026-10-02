// ontology-audit L1 — жижиг зөрүүнүүд:
//   • байхгүй tool — «Алдаа:» угтваргүй тул MCP `isError: false` буцаадаг байв;
//   • 17 tool-ын тайлбарт «10 сая ₮» хатуу (хязгаар байгууллагаар тохируулагддаг);
//   • reopenPeriod exclusive lock-гүй — зэрэгцээ closePeriod(дараагийн сар)-тай
//     хоёулаа давж дунд нь нээлттэй сар үлддэг байв;
//   • давтамжтай нэхэмжлэхийн ажиллуулагч уншсан төлвөө буцааж бичдэг — нэхэмжлэх
//     үүсэх зуур дарсан «Түр зогсоох» «active» болж буцдаг байв.
// Уралдааныг ТОДОРХОЙ давтана: тусдаа холболтоор түгжээ/мөрийг барина.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";

const requireCjs = createRequire(import.meta.url);
try {
  const nextCache = requireCjs("next/cache") as Record<string, unknown>;
  nextCache.revalidatePath = () => {};
} catch {
  // патчлагдахгүй орчинд алгасна
}

import { allAiTools, executeAiTool } from "../lib/ai/tools";
import { runAsOrg } from "../lib/auth";
import { syncStandardAccounts } from "../lib/actions/gl";
import { runRecurringInvoices } from "../lib/arap/recurring-run";
import { db } from "../lib/db";
import { accountingPeriods, arApDocuments, arRecurringInvoices, memberships, organizationProfile, organizations, users } from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";
import { PERIOD_GATE_LOCK_KEY } from "../lib/periods/guard";

test("tool тайлбар: «10 сая ₮»-г хатуу хязгаар гэж бичихгүй (default гэж л)", () => {
  const hardcoded = allAiTools()
    .filter((tool) => /(?<!default )10 сая/.test(tool.description))
    .map((tool) => tool.name);
  assert.deepEqual(hardcoded, []);
});

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];
const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
function ok(result: { resultText: string }) {
  assert.ok(!result.resultText.startsWith("Алдаа"), result.resultText);
  return result.resultText;
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `l1-${STAMP}`, email: `l1-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `L1 ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `L1 ${STAMP}` });
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

/** Тусдаа холболтоор `hold`-ийг транзакц дотор хийж, `action` түгжээ хүлээмэгц commit хийнэ. */
async function whileHolding<T>(
  hold: (tx: postgres.TransactionSql) => Promise<unknown>,
  action: () => Promise<T>
): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 2, onnotice: () => {} });
  try {
    let pending!: Promise<T>;
    let settled = false;
    await sql.begin(async (tx) => {
      await hold(tx);
      pending = action().finally(() => {
        settled = true;
      });
      for (let attempt = 0; !settled; attempt += 1) {
        const [row] = await sql`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`;
        if (row.waiting > 0) break;
        if (attempt > 100) throw new Error("үйлдэл түгжээ хүлээсэнгүй");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
    return await pending;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("байхгүй tool: «Алдаа: [UNKNOWN_TOOL]» — MCP isError: true", { skip: !DB_READY }, async () => {
  await setupOrg();
  const result = await tool("no_such_tool_l1", {});
  assert.match(result.resultText, /^Алдаа: \[UNKNOWN_TOOL\]/);
});

test("reopenPeriod: зэрэгцээ дараагийн сарын хаалттай уралдвал дунд нь нээлттэй сар үлдэхгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("close_period", { code: "2024-01" }));
  // closePeriod(2024-02) хаалтын түгжээ дотор «2024-02 хаагдав» гэж бичиж байх агшин.
  const result = await whileHolding(
    async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${orgId}), ${PERIOD_GATE_LOCK_KEY})`;
      await tx`insert into accounting_periods (user_id, organization_id, code, start_date, end_date, status, closed_at)
               values (${userId}, ${orgId}, '2024-02', '2024-02-01', '2024-02-29', 'closed', now())`;
    },
    () => tool("reopen_period", { code: "2024-01" })
  );
  assert.match(result.resultText, /Алдаа/, result.resultText);
  const january = await db.query.accountingPeriods.findFirst({
    where: and(eq(accountingPeriods.organizationId, orgId), eq(accountingPeriods.code, "2024-01")),
  });
  assert.equal(january?.status, "closed", "2024-02 хаалттай байхад 2024-01 нээгдэхгүй");
});

test("давтамжтай нэхэмжлэх: үүсгэх зуур дарсан «Түр зогсоох» дарагдахгүй", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_counterparty", { name: "Түрээслэгч", counterpartyType: "customer" }));
  ok(await tool("create_arap_invoice", {
    documentType: "ar_invoice", counterparty: "Түрээслэгч", date: "2025-03-01",
    description: "L1 түрээс", lines: [{ description: "Түрээс", amount: 100_000, account: "51100000" }],
  }, "draft"));
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, "L1 түрээс")),
  });
  assert.ok(invoice);
  ok(await tool("create_recurring_invoice", {
    documentId: invoice.documentNo, intervalMonths: 1, dayOfMonth: 1, startDate: "2025-04-01", autoPost: false,
  }, "draft"));
  const template = await db.query.arRecurringInvoices.findFirst({
    where: eq(arRecurringInvoices.organizationId, orgId),
  });
  assert.equal(template?.status, "active");

  // Хэрэглэгч загварыг «Түр зогсоох» (мөрийн түгжээтэй) — ажиллуулагчийн урагшлуулалт хүлээнэ.
  await whileHolding(
    async (tx) => {
      await tx`select id from ar_recurring_invoices where id = ${template!.id} for update`;
      await tx`update ar_recurring_invoices set status = 'paused' where id = ${template!.id}`;
    },
    () => runRecurringInvoices("2025-04-05", { organizationId: orgId })
  );
  const after = await db.query.arRecurringInvoices.findFirst({ where: eq(arRecurringInvoices.id, template!.id) });
  assert.equal(after?.status, "paused", "«Түр зогсоох» хэвээр");
  assert.equal(after?.runCount, (template!.runCount ?? 0) + 1);
  assert.equal(after?.nextRunDate, "2025-05-01");
});
