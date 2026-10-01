// AI/MCP-ийн лавлагаа хайлт ЦОНХГҮЙ (docs/ontology-audit.md §4.2):
// журнал, захиалга, хүлээн авалт, POS борлуулалт г.м.-ийг сүүлийн 500–1000
// бичлэгийн цонхонд хайдаг, жагсаалтын шүүлтийг сүүлийн 400-д хийдэг байсан
// тул том байгууллагад ХУУЧИН баримт «олдсонгүй» гардаг байв (ENT-033-ийн
// кассын засвартай ижил анги). Хуучин баримтын дээр шинэ бичлэгийн «ханыг»
// шууд insert-ээр босгоод хайна.
// DATABASE_URL шаарддаг; түр байгууллага purgeOrganization-оор.

import "./helpers/load-env";

import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
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
import {
  arApDocuments,
  auditEvents,
  counterparties,
  journalVouchers,
  memberships,
  organizationProfile,
  organizations,
  users,
} from "../lib/db/schema";
import { purgeOrganization } from "../lib/org/purge";

const DB_READY = !!process.env.DATABASE_URL;
const STAMP = Date.now().toString(36);
let userId = "";
let orgId = "";
const cleanup: (() => Promise<void>)[] = [];

const tool = (name: string, input: unknown, mode: "draft" | "post" = "post") =>
  runAsOrg({ userId, orgId }, () => executeAiTool(userId, name, input, mode));
function ok<T extends { resultText: string }>(result: T) {
  assert.ok(
    !result.resultText.startsWith("Алдаа") || result.resultText.includes("static generation store"),
    result.resultText
  );
  return result;
}

async function setupOrg() {
  if (orgId) return;
  const [user] = await db
    .insert(users)
    .values({ name: `ref-${STAMP}`, email: `ref-${STAMP}@test.local`, passwordHash: "x" })
    .returning({ id: users.id });
  const [org] = await db.insert(organizations).values({ name: `Лавлагаа ${STAMP}` }).returning({ id: organizations.id });
  await db.insert(memberships).values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await purgeOrganization(org.id);
    await db.delete(users).where(eq(users.id, user.id));
  });
  userId = user.id;
  orgId = org.id;
  await db.insert(organizationProfile).values({ userId, organizationId: orgId, name: `Лавлагаа ${STAMP}` });
  const sync = await runAsOrg({ userId, orgId }, () => syncStandardAccounts());
  assert.ok(!sync.error, sync.error);
}

test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

/** Хуучин мөрийн хуулбараар `count` ширхэг ШИНЭ (createdAt хожуу) бичлэг. */
function laterCopies<T extends { id: string; createdAt: Date }>(row: T, count: number, patch: (index: number) => Partial<T>) {
  const { id: _id, ...rest } = row;
  void _id;
  return Array.from({ length: count }, (_, index) => ({
    ...rest,
    createdAt: new Date(row.createdAt.getTime() + (index + 1) * 1000),
    ...patch(index),
  }));
}

test("журнал: 500-аас олон шинэ журналын цаана хуучныг дугаар, externalRef-ээр олно", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(
    await tool(
      "create_journal_voucher",
      {
        date: "2025-01-15",
        description: "Хуучин ноорог",
        externalRef: `old-jv-${STAMP}`,
        lines: [
          { account: "11000001", debit: 10_000 },
          { account: "51100000", credit: 10_000 },
        ],
      },
      "draft"
    )
  );
  const old = await db.query.journalVouchers.findFirst({
    where: and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.description, "Хуучин ноорог")),
  });
  assert.ok(old?.documentNo, "дугаартай");
  // Мөргүй ноорог журналын хана — сүүлийн 500-гийн цонхыг дүүргэнэ.
  await db.insert(journalVouchers).values(
    laterCopies(old!, 520, (index) => ({ documentNo: `WALL-${STAMP}-${index}`, externalRef: null, description: "хана" }))
  );

  const byNo = ok(await tool("get_journal_voucher", { voucherId: old!.documentNo! }));
  assert.match(byNo.resultText, /Хуучин ноорог/);
  ok(await tool("get_journal_voucher", { voucherId: `old-jv-${STAMP}` }));
  ok(await tool("update_journal_voucher", { voucherId: old!.documentNo!, description: "Хуучин ноорог (засав)" }));
  ok(await tool("post_journal_voucher", { voucherId: old!.documentNo! }));
  const posted = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, old!.id) });
  assert.equal(posted?.status, "posted");
  ok(await tool("reverse_journal_voucher", { voucherId: old!.id.slice(0, 8) }));
  assert.equal((await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, old!.id) }))?.status, "reversed");
});

test("list_arap_documents: шүүлт DB-д — 400-аас олон шинэ нэхэмжлэхийн цаана хуучин нээлттэй нь гарна", { skip: !DB_READY }, async () => {
  await setupOrg();
  ok(await tool("create_counterparty", { name: `Хуучин харилцагч ${STAMP}`, counterpartyType: "customer" }));
  ok(await tool("create_counterparty", { name: `Шинэ харилцагч ${STAMP}`, counterpartyType: "customer" }));
  ok(
    await tool("create_arap_invoice", {
      documentType: "ar_invoice",
      counterparty: `Хуучин харилцагч ${STAMP}`,
      date: "2025-01-20",
      description: "Хуучин нэхэмжлэх",
      lines: [{ description: "Үйлчилгээ", amount: 50_000, account: "51100000" }],
    })
  );
  const old = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, orgId), eq(arApDocuments.description, "Хуучин нэхэмжлэх")),
  });
  assert.ok(old, "хуучин нэхэмжлэх үүссэн");
  assert.equal(old!.status, "posted", "шууд горимд батлагдсан");
  const fresh = await db.query.counterparties.findFirst({
    where: and(eq(counterparties.organizationId, orgId), eq(counterparties.name, `Шинэ харилцагч ${STAMP}`)),
  });
  await db.insert(arApDocuments).values(
    laterCopies(old!, 420, (index) => ({
      documentNo: `WALL-${STAMP}-${index}`,
      counterpartyId: fresh!.id,
      date: "2025-06-01",
      externalRef: null,
      description: "хана",
    }))
  );

  const listed = ok(await tool("list_arap_documents", { counterparty: `хуучин харилцагч ${STAMP}`, openOnly: true }));
  assert.match(listed.resultText, new RegExp(old!.documentNo));
  const byDate = ok(await tool("list_arap_documents", { from: "2025-01-01", to: "2025-01-31" }));
  assert.match(byDate.resultText, new RegExp(old!.documentNo));
  assert.doesNotMatch(byDate.resultText, /WALL-/);
  const badDate = await tool("list_arap_documents", { from: "2025/01/01" });
  assert.match(badDate.resultText, /YYYY-MM-DD/);
});

test("list_audit_events: үйлдлийн шүүлт DB-д — 400-аас олон шинэ бичлэгийн цаана хуучин нь гарна", { skip: !DB_READY }, async () => {
  await setupOrg();
  // Байгууллагын ХАМГИЙН хуучин аудит (өмнөх тестүүдийн үйлдэл).
  const old = await db.query.auditEvents.findFirst({
    where: eq(auditEvents.organizationId, orgId),
    orderBy: (row, { asc }) => [asc(row.createdAt)],
  });
  assert.ok(old, "өмнөх тестүүдийн аудит");
  await db.insert(auditEvents).values(laterCopies(old!, 420, () => ({ action: "noise", entityType: "noise" })));
  const listed = ok(await tool("list_audit_events", { entityType: old!.entityType, action: old!.action }));
  assert.ok(listed.resultText.includes(`${old!.entityType}/${old!.action}`), listed.resultText);
});
