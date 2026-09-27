"use server";

// Давтамжтай нэхэмжлэх (docs/dev/arap.md §5h) — загвар үүсгэх (эх нэхэмжлэхээс),
// тохиргоо, түр зогсоох / сэргээх, устгах, «Одоо үүсгэх», жагсаалт. Үүсгэлт өөрөө
// lib/arap/recurring-run.ts (ticker 09:00-оос).

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import {
  createRecurringFromDocument,
  firstOccurrence,
  listRecurringTemplates,
  loadRecurringSource,
  normalizeRecurringSchedule,
  recurringScheduleLabel,
  runRecurringNow,
  type RecurringScheduleInput,
} from "@/lib/arap/recurring-run";
import { db } from "@/lib/db";
import { arRecurringInvoices } from "@/lib/db/schema";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

export interface RecurringRow {
  id: string;
  counterpartyName: string;
  counterpartyHasEmail: boolean;
  description: string;
  totalAmount: number;
  intervalMonths: number;
  dayOfMonth: number;
  scheduleLabel: string;
  paymentTermsDays: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  status: string;
  autoPost: boolean;
  sendEmail: boolean;
  runCount: number;
  lastDocumentId: string | null;
  lastDocumentNo: string | null;
  lastError: string | null;
}

const RECURRING_PATH = "/receivables/recurring";

export async function getRecurringInvoices(): Promise<ActionResult<{ rows: RecurringRow[]; today: string }>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    const rows = await listRecurringTemplates(orgId);
    return {
      today: todayInUlaanbaatar(),
      rows: rows.map(({ template, counterpartyName, counterpartyEmail, lastDocumentNo }) => ({
        id: template.id,
        counterpartyName,
        counterpartyHasEmail: !!counterpartyEmail?.trim(),
        description: template.description,
        totalAmount: Number(template.totalAmount),
        intervalMonths: template.intervalMonths,
        dayOfMonth: template.dayOfMonth,
        scheduleLabel: recurringScheduleLabel(template.intervalMonths, template.dayOfMonth),
        paymentTermsDays: template.paymentTermsDays,
        startDate: template.startDate,
        endDate: template.endDate,
        nextRunDate: template.nextRunDate,
        status: template.status,
        autoPost: template.autoPost,
        sendEmail: template.sendEmail,
        runCount: template.runCount,
        lastDocumentId: template.lastDocumentId,
        lastDocumentNo: lastDocumentNo ?? null,
        lastError: template.lastError,
      })),
    };
  } catch (caught) {
    return actionError("getRecurringInvoices", caught, "Давтамжтай нэхэмжлэх ачаалагдсангүй");
  }
}

/** «Давтамжтай болгох» цонхны анхдагч утга — давтах боломжгүй бол шалтгаан. */
export async function getRecurringSourcePreview(
  documentId: string
): Promise<ActionResult<{ termsDays: number; dayOfMonth: number; startDate: string; totalAmount: number }>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    const { document, termsDays } = await loadRecurringSource(orgId, documentId);
    const day = Math.min(Number(document.date.slice(8, 10)), 28);
    const today = todayInUlaanbaatar();
    return {
      termsDays,
      dayOfMonth: day,
      startDate: firstOccurrence(today, day, 1),
      totalAmount: Number(document.totalAmount),
    };
  } catch (caught) {
    return actionError("getRecurringSourcePreview", caught, "Нэхэмжлэхийг давтах боломжгүй");
  }
}

export async function createRecurringInvoice(
  documentId: string,
  schedule: RecurringScheduleInput
): Promise<ActionResult<{ id: string; nextRunDate: string }>> {
  try {
    // Шууд батлах тохиргоо нь батлах эрх шаардана (ноорог бол бичих эрх хангалттай).
    const { orgId, userId } = await requireModuleAction("ar", schedule.autoPost ? "post" : "write");
    const row = await createRecurringFromDocument(orgId, userId, documentId, schedule);
    revalidatePath(RECURRING_PATH);
    return { id: row.id, nextRunDate: row.nextRunDate };
  } catch (caught) {
    return actionError("createRecurringInvoice", caught, "Давтамжтай нэхэмжлэх үүссэнгүй");
  }
}

/**
 * Тохиргоо засах — батлах/илгээх, төлөх хугацаа, дуусах огноо. Давтамж, өдрийг
 * ЗАСАХГҮЙ (тэр сарын нэхэмжлэх давхардах эрсдэлтэй) — шинэ загвар үүсгэнэ.
 */
export async function updateRecurringInvoice(
  id: string,
  input: { autoPost: boolean; sendEmail: boolean; paymentTermsDays: number; endDate: string | null }
): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", input.autoPost ? "post" : "write");
    const current = await db.query.arRecurringInvoices.findFirst({
      where: and(eq(arRecurringInvoices.id, id), eq(arRecurringInvoices.organizationId, orgId)),
    });
    if (!current) return { error: "Давтамжтай нэхэмжлэх олдсонгүй" };
    const normalized = normalizeRecurringSchedule({
      intervalMonths: current.intervalMonths,
      dayOfMonth: current.dayOfMonth,
      startDate: current.startDate,
      ...input,
    });
    if ("error" in normalized) return { error: normalized.error };
    const { value } = normalized;
    const reopen = current.status === "ended" && (!value.endDate || value.endDate >= current.nextRunDate);
    await db
      .update(arRecurringInvoices)
      .set({
        autoPost: value.autoPost,
        sendEmail: value.sendEmail,
        paymentTermsDays: value.paymentTermsDays,
        endDate: value.endDate,
        ...(reopen ? { status: "active" } : {}),
        updatedAt: new Date(),
      })
      .where(eq(arRecurringInvoices.id, id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "ar_recurring",
      entityId: id,
      summary: `Давтамжтай нэхэмжлэх: ${value.autoPost ? "шууд батлана" : "ноорог"}${value.sendEmail ? " + и-мэйл" : ""}, төлөх ${value.paymentTermsDays} хоног${value.endDate ? `, ${value.endDate} хүртэл` : ""}`,
    });
    revalidatePath(RECURRING_PATH);
    return { id };
  } catch (caught) {
    return actionError("updateRecurringInvoice", caught, "Хадгалагдсангүй");
  }
}

/**
 * Түр зогсоох / сэргээх. Сэргээхэд зогссон хугацааны нэхэмжлэх НӨХӨГДӨХГҮЙ —
 * дараагийн огноо өнөөдрөөс хойших эхний occurrence.
 */
export async function setRecurringInvoiceStatus(id: string, paused: boolean): Promise<ActionResult<{ nextRunDate: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", "write");
    const current = await db.query.arRecurringInvoices.findFirst({
      where: and(eq(arRecurringInvoices.id, id), eq(arRecurringInvoices.organizationId, orgId)),
    });
    if (!current) return { error: "Давтамжтай нэхэмжлэх олдсонгүй" };
    if (current.status === "ended") return { error: "Дууссан загвар — дуусах огноог сунгана уу" };
    const today = todayInUlaanbaatar();
    const nextRunDate = paused
      ? current.nextRunDate
      : current.nextRunDate >= today
        ? current.nextRunDate
        : firstOccurrence(today, current.dayOfMonth, current.intervalMonths);
    await db
      .update(arRecurringInvoices)
      .set({ status: paused ? "paused" : "active", nextRunDate, updatedAt: new Date() })
      .where(eq(arRecurringInvoices.id, id));
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: paused ? "pause" : "resume",
      entityType: "ar_recurring",
      entityId: id,
      summary: `Давтамжтай нэхэмжлэх ${paused ? "түр зогсоов" : `сэргээв — дараагийнх ${nextRunDate}`}`,
    });
    revalidatePath(RECURRING_PATH);
    return { nextRunDate };
  } catch (caught) {
    return actionError("setRecurringInvoiceStatus", caught, "Хадгалагдсангүй");
  }
}

export async function deleteRecurringInvoice(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", "write");
    const [row] = await db
      .delete(arRecurringInvoices)
      .where(and(eq(arRecurringInvoices.id, id), eq(arRecurringInvoices.organizationId, orgId)))
      .returning({ id: arRecurringInvoices.id, description: arRecurringInvoices.description });
    if (!row) return { error: "Давтамжтай нэхэмжлэх олдсонгүй" };
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "delete",
      entityType: "ar_recurring",
      entityId: id,
      summary: `Давтамжтай нэхэмжлэх устгав: ${row.description} (үүссэн нэхэмжлэхүүд хэвээр)`,
    });
    revalidatePath(RECURRING_PATH);
    return { id };
  } catch (caught) {
    return actionError("deleteRecurringInvoice", caught, "Устгагдсангүй");
  }
}

/** «Дараагийнхыг одоо үүсгэх». */
export async function runRecurringInvoiceNow(
  id: string
): Promise<ActionResult<{ documentId: string; documentNo: string | null; emailed: boolean; note: string | null }>> {
  try {
    const template = await requireModuleAction("ar", "write").then(({ orgId }) =>
      db.query.arRecurringInvoices.findFirst({
        where: and(eq(arRecurringInvoices.id, id), eq(arRecurringInvoices.organizationId, orgId)),
        columns: { autoPost: true },
      })
    );
    if (!template) return { error: "Давтамжтай нэхэмжлэх олдсонгүй" };
    const { orgId, userId } = await requireModuleAction("ar", template.autoPost ? "post" : "write");
    const outcome = await runRecurringNow(orgId, userId, id);
    if (outcome.status === "failed") return { error: outcome.error };
    revalidatePath(RECURRING_PATH);
    revalidatePath("/receivables/documents");
    return outcome.status === "created"
      ? { documentId: outcome.documentId, documentNo: outcome.documentNo, emailed: outcome.emailed, note: outcome.note ?? null }
      : { documentId: outcome.documentId, documentNo: null, emailed: false, note: "энэ үеийн нэхэмжлэх аль хэдийн үүссэн" };
  } catch (caught) {
    return actionError("runRecurringInvoiceNow", caught, "Нэхэмжлэх үүссэнгүй");
  }
}
