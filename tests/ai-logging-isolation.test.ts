// AI бүртгэлийн INTEGRATION тест — DATABASE_URL шаарддаг.
//
// Хамрах хүрээ (docs/ai-logging.md):
//   1. Tenant тусгаарлалт — cross-tenant унших/бичих БҮРЭН хаагдсан эсэх
//   2. Polymorphic linked_document — journal / arap / cash гурвуулд
//   3. Баримт устгагдвал юу болох, сургалтын шүүлтүүрт орохгүй эсэх
//   4. Буцаалтын нүх — post → хаалт → БУЦААЛТ → шошго хүчингүй болох
//   5. resolution шилжилтийн хамгаалалт
//   6. Период хаах / дахин нээх (⑥ нэг hook)
//
// Түр өгөгдөл үүсгээд ТӨГСГӨЛД НЬ устгана (org cascade).

import "./helpers/load-env";

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "../lib/db";
import {
  arApDocuments,
  cashDocuments,
  counterparties,
  journalVouchers,
  memberships,
  organizations,
  users,
} from "../lib/db/schema";
import { logAuditEvent } from "../lib/audit";
import { isTrainingEligible } from "../lib/ai-logging/resolution";
import {
  aiLoggingHealthStats,
  aiSuggestionStats,
  findOutcomesForDocument,
  listAiSuggestions,
  listTrainingRows,
  logAiSuggestion,
  markPeriodTrainingFlags,
  resolveAiSuggestion,
} from "../lib/ai-logging/service";

const STAMP = Date.now().toString(36);
const cleanup: (() => Promise<void>)[] = [];

async function makeOrg(tag: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: `ai-log-${tag}-${STAMP}`,
      email: `ai-log-${tag}-${STAMP}@test.local`,
      passwordHash: "x",
    })
    .returning({ id: users.id });
  const [org] = await db
    .insert(organizations)
    .values({ name: `AiLog ${tag} ${STAMP}` })
    .returning({ id: organizations.id });
  await db
    .insert(memberships)
    .values({ organizationId: org.id, userId: user.id, role: "owner" });
  cleanup.push(async () => {
    await db.delete(organizations).where(eq(organizations.id, org.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
  return { userId: user.id, orgId: org.id };
}

/** Гурван ӨӨР төрлийн баримт — polymorphic холбоосыг шалгах. */
async function makeDocuments(ctx: { orgId: string; userId: string }, date: string) {
  const [voucher] = await db
    .insert(journalVouchers)
    .values({
      userId: ctx.userId,
      organizationId: ctx.orgId,
      date,
      description: "AI саналаар үүссэн журнал",
      status: "draft",
    })
    .returning({ id: journalVouchers.id });

  const [counterparty] = await db
    .insert(counterparties)
    .values({
      userId: ctx.userId,
      organizationId: ctx.orgId,
      name: `Нийлүүлэгч ${STAMP}`,
      counterpartyType: "supplier",
    })
    .returning({ id: counterparties.id });

  const [invoice] = await db
    .insert(arApDocuments)
    .values({
      userId: ctx.userId,
      organizationId: ctx.orgId,
      documentNo: `AP-${STAMP}`,
      documentType: "ap_bill",
      counterpartyId: counterparty.id,
      date,
      dueDate: date,
      controlAccountNumber: "31000001",
      description: "AI саналаар үүссэн нэхэмжлэх",
      totalAmount: "1000",
      baseTotalAmount: "1000",
      status: "draft",
    })
    .returning({ id: arApDocuments.id });

  const [cash] = await db
    .insert(cashDocuments)
    .values({
      userId: ctx.userId,
      organizationId: ctx.orgId,
      documentNo: `CM-${STAMP}`,
      documentType: "payment",
      date,
      description: "AI саналаар үүссэн кассын баримт",
      amount: "1000",
      status: "draft",
    })
    .returning({ id: cashDocuments.id });

  return { voucher: voucher.id, invoice: invoice.id, cash: cash.id };
}

/** Санал үүсгээд баримтад холбоно. */
async function suggest(
  ctx: { orgId: string; userId: string },
  documentType: "journal" | "arap" | "cash",
  documentId: string,
  date: string
) {
  const id = await logAiSuggestion(ctx, {
    toolName: `create_${documentType}`,
    inputPayload: { tool: `create_${documentType}`, mode: "draft" },
    suggestedValue: { counterpartyName: "Болор Трейд ХХК", amount: 1000, date },
    confidence: 0.87,
    latencyMs: 120,
  });
  assert.ok(id, "санал бүртгэгдсэн байх ёстой");
  const ok = await resolveAiSuggestion(ctx, id!, {
    resolution: "accepted",
    finalValue: { documentType, documentId },
    linkedDocumentType: documentType,
    linkedDocumentId: documentId,
    linkedDocumentDate: date,
  });
  assert.ok(ok, "үр дүн бичигдсэн байх ёстой");
  return id!;
}

async function outcomeOf(
  ctx: { orgId: string },
  documentType: "journal" | "arap" | "cash",
  documentId: string
) {
  const rows = await findOutcomesForDocument(ctx, documentType, documentId);
  assert.equal(rows.length, 1, "баримтад НЭГ үр дүн холбогдсон байх ёстой");
  return rows[0];
}

// DB-гүй орчинд (release.yml-ийн нэгж тест) алгасна — бусад integration тестийн адил.
const DB_READY = !!process.env.DATABASE_URL;

test("AI бүртгэл — тусгаарлалт, polymorphic холбоос, буцаалт", { skip: !DB_READY }, async (t) => {
  const a = await makeOrg("a");
  const b = await makeOrg("b");
  const DATE = "2026-05-15";
  const RANGE = { startDate: "2026-05-01", endDate: "2026-05-31" };

  try {
    const docsA = await makeDocuments(a, DATE);

    // ── 1. Polymorphic linked_document — 3 төрөл тус бүрд ────────────────
    await t.test("journal / arap / cash гурвуулд холбож уншина", async () => {
      const ids = {
        journal: await suggest(a, "journal", docsA.voucher, DATE),
        arap: await suggest(a, "arap", docsA.invoice, DATE),
        cash: await suggest(a, "cash", docsA.cash, DATE),
      };

      const journal = await outcomeOf(a, "journal", docsA.voucher);
      assert.equal(journal.suggestionId, ids.journal);
      assert.equal(journal.linkedDocumentType, "journal");
      assert.equal(journal.linkedDocumentId, docsA.voucher);
      assert.equal(journal.resolution, "accepted");

      const arap = await outcomeOf(a, "arap", docsA.invoice);
      assert.equal(arap.suggestionId, ids.arap);
      assert.equal(arap.linkedDocumentId, docsA.invoice);

      const cash = await outcomeOf(a, "cash", docsA.cash);
      assert.equal(cash.suggestionId, ids.cash);
      assert.equal(cash.linkedDocumentId, docsA.cash);

      // Бүртгэл нь ТҮҮХИЙ утгыг хадгалсан (tenant_only — цэвэрлэгдээгүй).
      const payload = journal.suggestedValue as Record<string, unknown>;
      assert.equal(payload.counterpartyName, "Болор Трейд ХХК");
      assert.equal(journal.trainingScope, "tenant_only");
    });

    // ── 2. Tenant тусгаарлалт ───────────────────────────────────────────
    await t.test("Б байгууллага А-гийн бүртгэлийг ХАРАХГҮЙ", async () => {
      const seenByB = await listAiSuggestions(b, { limit: 100 });
      assert.equal(seenByB.length, 0, "Б-д А-гийн мөр харагдаж БОЛОХГҮЙ");

      const crossRead = await findOutcomesForDocument(b, "journal", docsA.voucher);
      assert.deepEqual(crossRead, [], "баримтын ID мэдсэн ч уншиж БОЛОХГҮЙ");

      const statsB = await aiSuggestionStats(b);
      assert.equal(statsB.total, 0);

      const statsA = await aiSuggestionStats(a);
      assert.equal(statsA.total, 3);
      assert.equal(statsA.accepted, 3);
    });

    await t.test("health тоолуур: зөвхөн нэгтгэл тоо, байгууллагын ID гарахгүй", async () => {
      const health = await aiLoggingHealthStats();
      assert.ok(health, "хүснэгт байгаа үед null биш");
      assert.ok(health.total >= 3, "А-гийн 3 санал тоологдоно");
      assert.ok(health.organizations >= 1);
      assert.ok(health.accepted >= 3);
      const serialized = JSON.stringify(health);
      assert.doesNotMatch(serialized, new RegExp(a.orgId), "org ID ил гарахгүй");
      assert.doesNotMatch(serialized, /Болор Трейд/, "payload ил гарахгүй");
    });

    await t.test("Б байгууллага А-гийн саналд үр дүн БИЧИЖ ЧАДАХГҮЙ", async () => {
      const rows = await listAiSuggestions(a, { limit: 10 });
      const victim = rows[0].suggestionId;

      const wrote = await resolveAiSuggestion(b, victim, {
        resolution: "rejected",
      });
      assert.equal(wrote, false, "cross-tenant бичилт ТАТГАЛЗАГДАХ ёстой");

      // А-гийн мөр ХЭВЭЭР — өөрчлөгдөөгүй.
      const after = await findOutcomesForDocument(
        a,
        rows[0].linkedDocumentType!,
        rows[0].linkedDocumentId!
      );
      assert.equal(after[0].resolution, "accepted");
    });

    await t.test("Б-гийн периодын хаалт А-гийн шошгыг ХӨНДӨХГҮЙ", async () => {
      await markPeriodTrainingFlags(b, { ...RANGE, closed: true });
      const journal = await outcomeOf(a, "journal", docsA.voucher);
      assert.equal(journal.isPeriodClosed, false);
    });

    // ── 3. Аудитын гүүр: батлах ─────────────────────────────────────────
    await t.test("post аудит → is_posted true", async () => {
      await logAuditEvent({
        userId: a.userId,
        organizationId: a.orgId,
        action: "post",
        entityType: "journal",
        entityId: docsA.voucher,
        summary: "батлав",
      });
      const journal = await outcomeOf(a, "journal", docsA.voucher);
      assert.equal(journal.isPosted, true);
      // Үе хараахан хаагдаагүй тул сургалтад ОРОХГҮЙ.
      assert.equal(journal.isPeriodClosed, false);
      assert.ok(!isTrainingEligible(journal));
    });

    // ── 4. Периодын хаалт (⑥) ───────────────────────────────────────────
    await t.test("период хаагдав → сургалтын шошго идэвхжинэ", async () => {
      await markPeriodTrainingFlags(a, { ...RANGE, closed: true });
      const journal = await outcomeOf(a, "journal", docsA.voucher);
      assert.equal(journal.isPeriodClosed, true);
      assert.ok(
        isTrainingEligible(journal),
        "batlagdsan + хаагдсан + буцаалтгүй = шошго"
      );

      const training = await listTrainingRows(a, { trainingScope: "tenant_only" });
      assert.equal(training.length, 1, "зөвхөн журналын мөр шошго болсон байх");
      assert.equal(training[0].linkedDocumentId, docsA.voucher);
    });

    // ── 5. БУЦААЛТЫН НҮХ (A хэсэг) ──────────────────────────────────────
    await t.test(
      "хаагдсаны ДАРАА буцаалт → шошго хүчингүй болно",
      async () => {
        // Дараалал: санал → батлав → сар хаагдав → шошго болов
        //         → ДАРАА нь алдаа илэрч БУЦААЛТ хийгдэв.
        await logAuditEvent({
          userId: a.userId,
          organizationId: a.orgId,
          action: "reverse",
          entityType: "journal",
          entityId: docsA.voucher,
          summary: "буцаав",
        });

        const journal = await outcomeOf(a, "journal", docsA.voucher);
        assert.equal(journal.hasReversal, true);
        assert.equal(journal.invalidatedReason, "reverse");
        // is_posted ба is_period_closed ХЭВЭЭР — түүх гуйвуулагдахгүй.
        assert.equal(journal.isPosted, true);
        assert.equal(journal.isPeriodClosed, true);
        // Гэвч сургалтад ОРОХГҮЙ — энэ бол яг AI алдсан тохиолдол.
        assert.ok(
          !isTrainingEligible(journal),
          "буцаагдсан бичилт эерэг шошго болж БОЛОХГҮЙ"
        );

        const training = await listTrainingRows(a, {
          trainingScope: "tenant_only",
        });
        assert.equal(training.length, 0, "сургалтын түүврээс хасагдсан байх");
      }
    );

    // ── 6. Баримт УСТГАГДАХ ─────────────────────────────────────────────
    await t.test("баримт устгагдвал → rejected + шүүлтүүрээс хасагдана", async () => {
      await logAuditEvent({
        userId: a.userId,
        organizationId: a.orgId,
        action: "post",
        entityType: "cash",
        entityId: docsA.cash,
        summary: "батлав",
      });
      await logAuditEvent({
        userId: a.userId,
        organizationId: a.orgId,
        action: "delete",
        entityType: "cash",
        entityId: docsA.cash,
        summary: "устгав",
      });
      // Баримт нь ҮНЭХЭЭР устлаа — FK байхгүй тул бүртгэл ҮЛДЭНЭ
      // (сөрөг шошго алдагдахгүй; docs/ai-logging.md §3).
      await db.delete(cashDocuments).where(eq(cashDocuments.id, docsA.cash));

      const cash = await outcomeOf(a, "cash", docsA.cash);
      assert.equal(cash.resolution, "rejected", "устгал = хүн татгалзав");
      assert.equal(cash.hasReversal, true);
      assert.equal(cash.invalidatedReason, "delete");
      assert.ok(!isTrainingEligible(cash), "устгагдсан баримт шошго болохгүй");
      // Холбоос нь «унжсан» — ID үлдэнэ, баримт байхгүй. Энэ нь ЗОРИУД:
      // «AI санал болгосон → хүн устгасан» бол үнэ цэнтэй СӨРӨГ шошго.
      assert.equal(cash.linkedDocumentId, docsA.cash);
    });

    // ── 7. resolution шилжилтийн хамгаалалт ─────────────────────────────
    await t.test("rejected нь ЭЦСИЙН — буцааж accepted болохгүй", async () => {
      const rows = await findOutcomesForDocument(a, "cash", docsA.cash);
      const id = rows[0].suggestionId;
      const wrote = await resolveAiSuggestion(a, id, { resolution: "accepted" });
      assert.equal(wrote, false, "хориотой шилжилт ТАТГАЛЗАГДАХ ёстой");
      const after = await outcomeOf(a, "cash", docsA.cash);
      assert.equal(after.resolution, "rejected", "төлөв өөрчлөгдөөгүй байх");
    });

    await t.test("accepted → modified зөвшөөрөгдөнө (аудитын update)", async () => {
      await logAuditEvent({
        userId: a.userId,
        organizationId: a.orgId,
        action: "update",
        entityType: "arap",
        entityId: docsA.invoice,
        summary: "заслаа",
      });
      const arap = await outcomeOf(a, "arap", docsA.invoice);
      assert.equal(arap.resolution, "modified");
    });

    // ── 8. Период ДАХИН НЭЭГДЭХ ─────────────────────────────────────────
    await t.test("период дахин нээгдэв → шошго БУЦААНА", async () => {
      await markPeriodTrainingFlags(a, { ...RANGE, closed: false });
      const arap = await outcomeOf(a, "arap", docsA.invoice);
      assert.equal(arap.isPeriodClosed, false);
    });

    // ── 9. 1:1 гэрээ ────────────────────────────────────────────────────
    await t.test("санал бүрд ҮР ДҮН НЭГ (1:1)", async () => {
      const rows = await findOutcomesForDocument(a, "arap", docsA.invoice);
      assert.equal(rows.length, 1);
      // Дахин бичихэд ШИНЭ мөр үүсэхгүй, байрандаа шинэчлэгдэнэ.
      await resolveAiSuggestion(a, rows[0].suggestionId, {
        resolution: "rejected",
      });
      const after = await findOutcomesForDocument(a, "arap", docsA.invoice);
      assert.equal(after.length, 1);
      assert.equal(after[0].resolution, "rejected");
      // Холбоос нь ДАРАГДААГҮЙ — coalesce хамгаалалт.
      assert.equal(after[0].linkedDocumentId, docsA.invoice);
      assert.equal(after[0].linkedDocumentDate, DATE);
    });
  } finally {
    for (const fn of cleanup.reverse()) await fn();
  }
});
