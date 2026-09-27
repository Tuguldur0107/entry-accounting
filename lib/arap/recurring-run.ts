// Давтамжтай нэхэмжлэхийн ХӨДӨЛГҮҮР (docs/dev/arap.md §5h) — ЭНГИЙН модуль
// ("use server" БИШ, orgId параметртэй): ticker, cron route, action дуудна.
// Request scope ГАДНА (ticker): cookies() / getActiveOrg() дуудахгүй — нэхэмжлэх
// нь owner-ийн нэрээр `runAsOrg`-оор, ердийн `createArApDocument`-ийн БҮХ дүрмээр
// (период, данс, харилцагч, дугаар, eBarimt дараалал) үүснэ — тусдаа логик ҮГҮЙ.
//
// Давхардалгүй: occurrence бүр `externalRef = recurring:<id>:<огноо>`
// (ar_ap_documents unique) — олон instance / давтан tick аюулгүй; nextRunDate-ийг
// нөхцөлтэй (`where nextRunDate = хуучин`) урагшлуулна. ШИДЭХГҮЙ: алдаа нь
// `lastError` + аудит `recurring_failed` (→ мэдэгдэл).

import { and, eq, inArray, lte } from "drizzle-orm";

import { createArApDocument } from "@/lib/actions/arap";
import { sendInvoiceEmail } from "@/lib/actions/invoice-send";
import { logAuditEvent } from "@/lib/audit";
import { runAsOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { arApDocuments, arRecurringInvoices, counterparties, memberships } from "@/lib/db/schema";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

import {
  addDays,
  dueOccurrences,
  firstOccurrence,
  nextOccurrence,
  normalizeRecurringSchedule,
  recurringDescription,
  recurringExternalRef,
  type RecurringScheduleInput,
} from "./recurring";

export * from "./recurring";

type Template = typeof arRecurringInvoices.$inferSelect;
interface TemplateLine {
  account: string;
  description: string;
  amount: number;
}

async function orgOwnerUserId(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын owner гишүүнчлэл олдсонгүй");
  return owner.userId;
}

/**
 * Нэхэмжлэхийг загвар болгох боломжтой эсэх + загварын мөрүүд. Зөвхөн бараагүй
 * (үйлчилгээ, түрээс), MNT, POS/PO-гүй АР нэхэмжлэх — бараа материал, ханш
 * хөндөхгүй (ханш ЗОХИОХГҮЙ).
 */
export async function loadRecurringSource(orgId: string, documentId: string) {
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, documentId), eq(arApDocuments.organizationId, orgId)),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!document || document.documentType !== "ar_invoice") throw new Error("Авлагын нэхэмжлэх олдсонгүй");
  if (document.status === "reversed") throw new Error("Буцаагдсан нэхэмжлэхийг давтахгүй");
  if (document.sourceType === "pos") throw new Error("POS-оос үүссэн нэхэмжлэхийг давтахгүй");
  if (document.purchaseOrderId) throw new Error("Захиалгатай (PO) нэхэмжлэхийг давтахгүй");
  if (document.currency !== "MNT")
    throw new Error("Одоогоор зөвхөн ₮ нэхэмжлэх давтагдана — валютын ханшийг сар бүр зохиохгүйн тулд");
  if (document.lines.some((line) => line.itemId || line.costComponentId))
    throw new Error("Бараатай нэхэмжлэх давтагдахгүй (бараа материал хөдөлгөнө) — үйлчилгээ, түрээсийн нэхэмжлэхэд");
  const lines: TemplateLine[] = document.lines.map((line) => ({
    account: line.accountNumber,
    description: line.description,
    amount: Number(line.amount),
  }));
  if (lines.length === 0) throw new Error("Нэхэмжлэхэд мөр алга");
  const termsDays = Math.max(
    0,
    Math.round((Date.parse(`${document.dueDate}T00:00:00Z`) - Date.parse(`${document.date}T00:00:00Z`)) / 86_400_000)
  );
  return { document, lines, termsDays };
}

/** Эх нэхэмжлэхээс загвар үүсгэнэ (action нь эрхийг шалгасны дараа). */
export async function createRecurringFromDocument(
  orgId: string,
  userId: string,
  documentId: string,
  schedule: RecurringScheduleInput
): Promise<Template> {
  const normalized = normalizeRecurringSchedule(schedule);
  if ("error" in normalized) throw new Error(normalized.error);
  const { document, lines } = await loadRecurringSource(orgId, documentId);
  const value = normalized.value;
  const [row] = await db
    .insert(arRecurringInvoices)
    .values({
      organizationId: orgId,
      userId,
      counterpartyId: document.counterpartyId,
      sourceDocumentId: document.id,
      controlAccountNumber: document.controlAccountNumber,
      currency: document.currency,
      description: document.description,
      lines,
      totalAmount: document.totalAmount,
      intervalMonths: value.intervalMonths,
      dayOfMonth: value.dayOfMonth,
      paymentTermsDays: value.paymentTermsDays,
      startDate: value.startDate,
      endDate: value.endDate,
      nextRunDate: firstOccurrence(value.startDate, value.dayOfMonth, value.intervalMonths),
      autoPost: value.autoPost,
      sendEmail: value.sendEmail,
    })
    .returning();
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "create",
    entityType: "ar_recurring",
    entityId: row.id,
    summary: `${document.documentNo}-ээс давтамжтай нэхэмжлэх — дараагийнх ${row.nextRunDate}`,
  });
  return row;
}

export type OccurrenceOutcome =
  | { status: "created"; documentId: string; documentNo: string; emailed: boolean; note?: string }
  | { status: "exists"; documentId: string }
  | { status: "failed"; error: string };

/**
 * Нэг occurrence-ийн нэхэмжлэх. `invoiceDate` нь ихэвчлэн occurrence өөрөө;
 * «Одоо үүсгэх»-д өнөөдөр. Давхардал externalRef-ээр.
 */
async function generateOccurrence(
  template: Template,
  occurrence: string,
  invoiceDate: string,
  actor: string,
  system: boolean
): Promise<OccurrenceOutcome> {
  const externalRef = recurringExternalRef(template.id, occurrence);
  const existing = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.organizationId, template.organizationId), eq(arApDocuments.externalRef, externalRef)),
    columns: { id: true },
  });
  if (existing) return { status: "exists", documentId: existing.id };

  const lines = (template.lines as TemplateLine[]).map((line) => ({
    account: line.account,
    description: line.description,
    amount: Number(line.amount),
  }));
  const created = await runAsOrg({ userId: actor, orgId: template.organizationId }, () =>
    createArApDocument({
      documentType: "ar_invoice",
      counterpartyId: template.counterpartyId,
      date: invoiceDate,
      dueDate: addDays(invoiceDate, template.paymentTermsDays),
      currency: template.currency,
      controlAccountNumber: template.controlAccountNumber,
      description: recurringDescription(template.description, occurrence),
      lines,
      postNow: template.autoPost,
      externalRef,
    })
  );
  if (created.error || !created.id) {
    // Зэрэгцээ дуудагч түрүүлж үүсгэсэн (unique externalRef) бол алдаа биш.
    const raced = await db.query.arApDocuments.findFirst({
      where: and(eq(arApDocuments.organizationId, template.organizationId), eq(arApDocuments.externalRef, externalRef)),
      columns: { id: true },
    });
    if (raced) return { status: "exists", documentId: raced.id };
    return { status: "failed", error: created.error ?? "Нэхэмжлэх үүссэнгүй" };
  }

  let emailed = false;
  let note: string | undefined;
  if (template.autoPost && template.sendEmail) {
    const counterparty = await db.query.counterparties.findFirst({
      where: eq(counterparties.id, template.counterpartyId),
      columns: { email: true },
    });
    const email = counterparty?.email?.trim();
    if (!email) note = "харилцагчид и-мэйл бүртгэлгүй тул илгээгдсэнгүй";
    else {
      const sent = await runAsOrg({ userId: actor, orgId: template.organizationId }, () =>
        sendInvoiceEmail(created.id, email)
      );
      if (sent.error) note = `и-мэйл илгээгдсэнгүй: ${sent.error}`;
      else emailed = true;
    }
  }
  await logAuditEvent({
    userId: actor,
    system,
    organizationId: template.organizationId,
    action: "recurring_created",
    entityType: "arap",
    entityId: created.id,
    summary: `Давтамжтай нэхэмжлэх ${created.documentNo} ${template.autoPost ? "батлагдлаа" : "НООРОГ үүслээ — шалгаад батална уу"}${emailed ? ", и-мэйлээр илгээв" : ""}${note ? ` (${note})` : ""}`,
  });
  return { status: "created", documentId: created.id, documentNo: created.documentNo, emailed, note };
}

async function recordFailure(template: Template, actor: string, system: boolean, error: string) {
  await db
    .update(arRecurringInvoices)
    .set({ lastError: error, lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(arRecurringInvoices.id, template.id));
  await logAuditEvent({
    userId: actor,
    system,
    organizationId: template.organizationId,
    action: "recurring_failed",
    entityType: "ar_recurring",
    entityId: template.id,
    summary: `Давтамжтай нэхэмжлэх үүссэнгүй (${template.nextRunDate}): ${error}`,
  });
}

/** Амжилттай occurrence-ийн дараа загварыг урагшлуулна (нөхцөлтэй — давхар урагшлахгүй). */
async function advance(template: Template, occurrence: string, documentId: string, note?: string) {
  const next = nextOccurrence(occurrence, template.dayOfMonth, template.intervalMonths);
  const ended = !!template.endDate && next > template.endDate;
  const [row] = await db
    .update(arRecurringInvoices)
    .set({
      nextRunDate: next,
      status: ended ? "ended" : template.status,
      runCount: template.runCount + 1,
      lastRunAt: new Date(),
      lastDocumentId: documentId,
      lastError: note ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(arRecurringInvoices.id, template.id), eq(arRecurringInvoices.nextRunDate, occurrence)))
    .returning();
  return row ?? null;
}

export interface RecurringRunResult {
  today: string;
  created: number;
  failed: number;
  errors: { templateId: string; error: string }[];
}

/** Хугацаа нь болсон бүх идэвхтэй загвар (бүх байгууллага) — ticker 15 мин тутам. */
export async function runRecurringInvoices(today = todayInUlaanbaatar()): Promise<RecurringRunResult> {
  const result: RecurringRunResult = { today, created: 0, failed: 0, errors: [] };
  const due = await db
    .select()
    .from(arRecurringInvoices)
    .where(and(eq(arRecurringInvoices.status, "active"), lte(arRecurringInvoices.nextRunDate, today)));
  const owners = new Map<string, string>();
  for (let template of due) {
    try {
      let actor = owners.get(template.organizationId);
      if (!actor) {
        actor = await orgOwnerUserId(template.organizationId);
        owners.set(template.organizationId, actor);
      }
      for (const occurrence of dueOccurrences({ ...template, today })) {
        const outcome = await generateOccurrence(template, occurrence, occurrence, actor, true);
        if (outcome.status === "failed") {
          // Нэг өдөр нэг мэдэгдэл (dedupe), алдаа засагдтал дараагийн tick дахин оролдоно.
          if (template.lastError !== outcome.error) await recordFailure(template, actor, true, outcome.error);
          result.failed += 1;
          result.errors.push({ templateId: template.id, error: outcome.error });
          break;
        }
        if (outcome.status === "created") result.created += 1;
        const advanced = await advance(template, occurrence, outcome.documentId, outcome.status === "created" ? outcome.note : undefined);
        if (!advanced) break; // өөр дуудагч урагшлуулсан
        template = advanced;
        if (template.status !== "active") break;
      }
      if (template.endDate && template.nextRunDate > template.endDate && template.status === "active")
        await db.update(arRecurringInvoices).set({ status: "ended", updatedAt: new Date() }).where(eq(arRecurringInvoices.id, template.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed += 1;
      result.errors.push({ templateId: template.id, error: message });
    }
  }
  return result;
}

/**
 * «Дараагийнхыг одоо үүсгэх» — дараагийн occurrence-ийн нэхэмжлэхийг ӨНӨӨДРИЙН
 * огноогоор (ирээдүйн сар батлагдахгүй тул) үүсгээд загварыг урагшлуулна. Тэр
 * огноо ирэхэд ticker давхар үүсгэхгүй (externalRef + nextRunDate).
 */
export async function runRecurringNow(orgId: string, actorUserId: string, templateId: string): Promise<OccurrenceOutcome> {
  const template = await db.query.arRecurringInvoices.findFirst({
    where: and(eq(arRecurringInvoices.id, templateId), eq(arRecurringInvoices.organizationId, orgId)),
  });
  if (!template) throw new Error("Давтамжтай нэхэмжлэх олдсонгүй");
  if (template.status === "ended") throw new Error("Хугацаа нь дууссан загвар — дуусах огноог сунгана уу");
  const today = todayInUlaanbaatar();
  const occurrence = template.nextRunDate;
  const outcome = await generateOccurrence(template, occurrence, occurrence < today ? occurrence : today, actorUserId, false);
  if (outcome.status === "failed") {
    await recordFailure(template, actorUserId, false, outcome.error);
    return outcome;
  }
  await advance(template, occurrence, outcome.documentId, outcome.status === "created" ? outcome.note : undefined);
  return outcome;
}

/** Идэвхтэй / түр зогссон / дууссан тоолол + дараагийн огнооны хураангуй (AI, самбар). */
export async function listRecurringTemplates(orgId: string) {
  return db
    .select({
      template: arRecurringInvoices,
      counterpartyName: counterparties.name,
      counterpartyEmail: counterparties.email,
      lastDocumentNo: arApDocuments.documentNo,
    })
    .from(arRecurringInvoices)
    .innerJoin(counterparties, eq(counterparties.id, arRecurringInvoices.counterpartyId))
    .leftJoin(arApDocuments, eq(arApDocuments.id, arRecurringInvoices.lastDocumentId))
    .where(and(eq(arRecurringInvoices.organizationId, orgId), inArray(arRecurringInvoices.status, ["active", "paused", "ended"])))
    .orderBy(arRecurringInvoices.nextRunDate);
}
