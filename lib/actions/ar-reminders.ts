"use server";

// Төлбөрийн автомат сануулгын тохиргоо + түүх (docs/dev/arap.md §5g). Илгээлт
// өөрөө request scope-гүй хөдөлгүүрт (lib/arap/reminders-run.ts) — энд зөвхөн
// тохиргоо, харилцагчийн хасалт, түүхийн уншилт.

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import {
  loadReminderSettings,
  normalizeReminderSettings,
  reminderSenderProblem,
  type ReminderSettings,
} from "@/lib/arap/reminders-run";
import { db } from "@/lib/db";
import { arApDocuments, arInvoiceReminders, arReminderSettings, counterparties } from "@/lib/db/schema";

export interface ArReminderRow {
  id: string;
  documentId: string;
  documentNo: string;
  counterpartyName: string;
  dueDate: string;
  stage: string;
  status: string;
  recipient: string;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
}

export interface ArReminderOverview {
  settings: ReminderSettings;
  /** Илгээх боломжгүй шалтгаан (Resend, илгээгч, нийтийн URL) — null бол бэлэн. */
  problem: string | null;
  excluded: { id: string; name: string }[];
  customers: { id: string; name: string; email: string | null }[];
  recent: ArReminderRow[];
}

const REMINDERS_PATH = "/receivables/reminders";

export async function getArReminderOverview(): Promise<ActionResult<ArReminderOverview>> {
  try {
    const { orgId } = await requireModuleAction("ar", "read");
    const [settings, problem, people, recent] = await Promise.all([
      loadReminderSettings(orgId),
      reminderSenderProblem(orgId),
      db
        .select({
          id: counterparties.id,
          name: counterparties.name,
          email: counterparties.email,
          disabled: counterparties.arRemindersDisabled,
        })
        .from(counterparties)
        .where(
          and(
            eq(counterparties.organizationId, orgId),
            eq(counterparties.isActive, true),
            inArray(counterparties.counterpartyType, ["customer", "both"])
          )
        )
        .orderBy(counterparties.name),
      db
        .select({
          reminder: arInvoiceReminders,
          documentNo: arApDocuments.documentNo,
          counterpartyName: counterparties.name,
        })
        .from(arInvoiceReminders)
        .innerJoin(arApDocuments, eq(arApDocuments.id, arInvoiceReminders.documentId))
        .innerJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
        .where(eq(arInvoiceReminders.organizationId, orgId))
        .orderBy(desc(arInvoiceReminders.createdAt))
        .limit(200),
    ]);
    return {
      settings,
      problem,
      excluded: people.filter((row) => row.disabled).map(({ id, name }) => ({ id, name })),
      customers: people.filter((row) => !row.disabled).map(({ id, name, email }) => ({ id, name, email })),
      recent: recent.map(({ reminder, documentNo, counterpartyName }) => ({
        id: reminder.id,
        documentId: reminder.documentId,
        documentNo,
        counterpartyName,
        dueDate: reminder.dueDate,
        stage: reminder.stage,
        status: reminder.status,
        recipient: reminder.recipient,
        error: reminder.error,
        attempts: reminder.attempts,
        createdAt: reminder.createdAt.toISOString(),
        sentAt: reminder.sentAt?.toISOString() ?? null,
      })),
    };
  } catch (caught) {
    return actionError("getArReminderOverview", caught, "Сануулгын мэдээлэл ачаалагдсангүй");
  }
}

export async function saveArReminderSettings(input: {
  enabled: boolean;
  beforeDays: number | null;
  afterDays: number[];
}): Promise<ActionResult<{ settings: ReminderSettings }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", "post");
    const normalized = normalizeReminderSettings(input);
    if ("error" in normalized) return { error: normalized.error };
    const settings = normalized.value;
    if (settings.enabled) {
      const problem = await reminderSenderProblem(orgId);
      if (problem) return { error: `Асаах боломжгүй: ${problem}` };
    }
    const values = {
      enabled: settings.enabled,
      beforeDays: settings.beforeDays,
      afterDays: settings.afterDays,
      updatedAt: new Date(),
      updatedBy: userId,
    };
    await db
      .insert(arReminderSettings)
      .values({ organizationId: orgId, ...values })
      .onConflictDoUpdate({ target: arReminderSettings.organizationId, set: values });
    const stages = [
      settings.beforeDays ? `${settings.beforeDays} хоногийн өмнө` : null,
      settings.afterDays.length ? `хэтэрсний дараа ${settings.afterDays.join(", ")} хоног` : null,
    ]
      .filter(Boolean)
      .join("; ");
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "settings",
      entityId: "ar_reminders",
      summary: `Төлбөрийн автомат сануулга ${settings.enabled ? "асаав" : "унтраав"}${stages ? ` (${stages})` : ""}`,
    });
    revalidatePath(REMINDERS_PATH);
    return { settings };
  } catch (caught) {
    return actionError("saveArReminderSettings", caught, "Тохиргоо хадгалагдсангүй");
  }
}

/** Харилцагчийг сануулгаас хасах / буцааж оруулах. */
export async function setCounterpartyReminderOptOut(
  counterpartyId: string,
  disabled: boolean
): Promise<ActionResult<{ id: string }>> {
  try {
    const { orgId, userId } = await requireModuleAction("ar", "write");
    const [row] = await db
      .update(counterparties)
      .set({ arRemindersDisabled: disabled })
      .where(and(eq(counterparties.id, counterpartyId), eq(counterparties.organizationId, orgId)))
      .returning({ id: counterparties.id, name: counterparties.name });
    if (!row) return { error: "Харилцагч олдсонгүй" };
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: "update",
      entityType: "counterparty",
      entityId: row.id,
      summary: `${row.name}: төлбөрийн автомат сануулга ${disabled ? "хаав" : "нээв"}`,
    });
    revalidatePath(REMINDERS_PATH);
    return { id: row.id };
  } catch (caught) {
    return actionError("setCounterpartyReminderOptOut", caught, "Харилцагч хадгалагдсангүй");
  }
}
