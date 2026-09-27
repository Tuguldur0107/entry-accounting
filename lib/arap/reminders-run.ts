// Төлбөрийн автомат сануулгын ХӨДӨЛГҮҮР (docs/dev/arap.md §5g) — ЭНГИЙН модуль
// ("use server" БИШ, orgId параметртэй): ticker, cron route, script дуудна.
// Request scope ГАДНА: cookies() / getActiveOrg() / revalidatePath() дуудахгүй.
//
// Идемпотент: байгууллага × өдөр `notification_runs` (job "ar_reminders") НЭГ
// дуудагч; нэхэмжлэх × төлөх огноо × шат `ar_invoice_reminders`-ийн unique
// INDEX-ээр булаагдаж байж л захиа явна — олон instance ч давхардахгүй.
// ШИДЭХГҮЙ байгууллага бүрийн алдааг үр дүнд буцаана.

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { Resend } from "resend";

import { logAuditEvent } from "@/lib/audit";
import { loadInvoicePayload } from "@/lib/arap/invoice-payload";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApInvoiceSends,
  arInvoiceReminders,
  arReminderSettings,
  counterparties,
  memberships,
  notificationRuns,
  organizationProfile,
} from "@/lib/db/schema";
import { resolveInvoiceSender, translateResendError } from "@/lib/email/sender";
import { todayInUlaanbaatar } from "@/lib/periods/selection";
import { invoiceQpayAvailable } from "@/lib/qpay/arap";
import { publicAppUrl } from "@/lib/qpay/store";

import {
  DEFAULT_REMINDER_SETTINGS,
  REMINDER_CATCH_UP_DAYS,
  REMINDER_DAILY_LIMIT_PER_ORG,
  REMINDER_MAX_ATTEMPTS,
  buildReminderEmail,
  daysBetween,
  dueReminderStage,
  type ReminderSettings,
} from "./reminders";

export * from "./reminders";

export const AR_REMINDER_JOB = "ar_reminders";

export async function loadReminderSettings(orgId: string): Promise<ReminderSettings> {
  const row = await db.query.arReminderSettings.findFirst({
    where: eq(arReminderSettings.organizationId, orgId),
  });
  if (!row) return DEFAULT_REMINDER_SETTINGS;
  const afterDays = Array.isArray(row.afterDays) ? (row.afterDays as unknown[]).map(Number).filter(Number.isInteger) : [];
  return { enabled: row.enabled, beforeDays: row.beforeDays ?? null, afterDays };
}

/** Мөр авто-үүсгэхэд / аудитад actor болгох хэрэглэгч — байгууллагын owner. */
async function orgOwnerUserId(orgId: string): Promise<string> {
  const owner = await db.query.memberships.findFirst({
    where: and(eq(memberships.organizationId, orgId), eq(memberships.role, "owner")),
    columns: { userId: true },
  });
  if (!owner) throw new Error("Байгууллагын owner гишүүнчлэл олдсонгүй");
  return owner.userId;
}

/**
 * Сануулга илгээх бэлэн байдал — асаах үед ба хөдөлгүүрт НЭГ шалгалт. Алдааг
 * монголоор (Resend түлхүүр, илгээгч хаяг, нийтийн URL).
 */
export async function reminderSenderProblem(orgId: string): Promise<string | null> {
  if (!process.env.RESEND_API_KEY) return "И-мэйл илгээх тохиргоо (RESEND_API_KEY) хийгдээгүй";
  if (!publicAppUrl()) return "Нийтийн хаяг (NEXT_PUBLIC_APP_URL) тохируулаагүй — нэхэмжлэхийн линк үүсгэх боломжгүй";
  try {
    await resolveSender(orgId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function resolveSender(orgId: string) {
  const profile = await db.query.organizationProfile.findFirst({
    where: eq(organizationProfile.organizationId, orgId),
    columns: { invoiceFromEmail: true, invoiceReplyTo: true, emailDomainVerified: true, name: true },
  });
  return resolveInvoiceSender(
    profile
      ? {
          invoiceFromEmail: profile.invoiceFromEmail,
          invoiceReplyTo: profile.invoiceReplyTo,
          emailDomainVerified: profile.emailDomainVerified,
          companyName: profile.name,
        }
      : null,
    process.env
  );
}

export interface OrgReminderResult {
  sent: number;
  failed: number;
  /** Харилцагчид и-мэйл алга эсвэл сануулга хаалттай. */
  skipped: number;
}

/** Нэг байгууллагын өнөөдрийн сануулгууд. Тохиргоо/илгээгчийн алдаа бол ШИДНЭ (дуудагч бүртгэнэ). */
export async function sendOrgInvoiceReminders(orgId: string, today: string): Promise<OrgReminderResult> {
  const result: OrgReminderResult = { sent: 0, failed: 0, skipped: 0 };
  const settings = await loadReminderSettings(orgId);
  if (!settings.enabled) return result;
  const problem = await reminderSenderProblem(orgId);
  if (problem) throw new Error(problem);
  const sender = await resolveSender(orgId);
  const base = publicAppUrl()!;
  const resend = new Resend(process.env.RESEND_API_KEY);

  const maxAfter = Math.max(0, ...settings.afterDays);
  const shift = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ document: arApDocuments, email: counterparties.email, disabled: counterparties.arRemindersDisabled })
    .from(arApDocuments)
    .innerJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentType, "ar_invoice"),
        inArray(arApDocuments.status, ["posted", "partially_paid"]),
        sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} > 0.01`,
        gte(arApDocuments.dueDate, shift(-(maxAfter + REMINDER_CATCH_UP_DAYS))),
        lte(arApDocuments.dueDate, shift(settings.beforeDays ?? 0))
      )
    )
    .orderBy(arApDocuments.dueDate);
  if (rows.length === 0) return result;

  const history = await db
    .select()
    .from(arInvoiceReminders)
    .where(
      and(
        eq(arInvoiceReminders.organizationId, orgId),
        inArray(
          arInvoiceReminders.documentId,
          rows.map((row) => row.document.id)
        )
      )
    );
  const actor = await orgOwnerUserId(orgId);

  for (const { document, email, disabled } of rows) {
    if (result.sent + result.failed >= REMINDER_DAILY_LIMIT_PER_ORG) break;
    const own = history.filter((row) => row.documentId === document.id && row.dueDate === document.dueDate);
    const doneStages = own
      .filter((row) => row.status !== "failed" || row.attempts >= REMINDER_MAX_ATTEMPTS)
      .map((row) => row.stage);
    const stage = dueReminderStage({ settings, dueDate: document.dueDate, today, doneStages });
    if (!stage) continue;
    const recipient = email?.trim();
    if (!recipient || disabled) {
      result.skipped += 1;
      continue;
    }

    // Булаалт: шинэ шат → insert; бүтэлгүй байсан шат → attempts-ийг нөхцөлтэй өсгөнө.
    const previous = own.find((row) => row.stage === stage.key);
    const [claim] = previous
      ? await db
          .update(arInvoiceReminders)
          .set({ status: "sending", attempts: previous.attempts + 1, recipient, error: null })
          .where(
            and(
              eq(arInvoiceReminders.id, previous.id),
              eq(arInvoiceReminders.status, "failed"),
              eq(arInvoiceReminders.attempts, previous.attempts)
            )
          )
          .returning({ id: arInvoiceReminders.id })
      : await db
          .insert(arInvoiceReminders)
          .values({ organizationId: orgId, documentId: document.id, dueDate: document.dueDate, stage: stage.key, recipient })
          .onConflictDoNothing()
          .returning({ id: arInvoiceReminders.id });
    if (!claim) continue;

    const fail = async (message: string) => {
      result.failed += 1;
      await db
        .update(arInvoiceReminders)
        .set({ status: "failed", error: message })
        .where(eq(arInvoiceReminders.id, claim.id));
    };
    try {
      const invoice = await loadInvoicePayload(orgId, document.id);
      if (!invoice) {
        await fail("Нэхэмжлэх олдсонгүй");
        continue;
      }
      const qpay = await invoiceQpayAvailable(orgId, document).catch(() => false);
      const [send] = await db
        .insert(arApInvoiceSends)
        .values({ userId: actor, organizationId: orgId, documentId: document.id, channel: "email", purpose: "reminder", recipient })
        .returning({ id: arApInvoiceSends.id, token: arApInvoiceSends.token });
      const balance = Math.round((Number(document.totalAmount) - Number(document.paidAmount)) * 100) / 100;
      const mail = buildReminderEmail({
        companyName: invoice.company.name || "Байгууллага",
        documentNo: document.documentNo,
        dueDate: document.dueDate,
        today,
        balance,
        currency: document.currency,
        viewUrl: `${base}/invoice/${send.token}`,
        qpay,
        bankAccounts: invoice.company.bankAccounts,
      });
      const { data, error } = await resend.emails.send({
        from: sender.from,
        to: recipient,
        ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
        subject: mail.subject,
        text: mail.text,
      });
      if (error) {
        await db.update(arApInvoiceSends).set({ revokedAt: new Date() }).where(eq(arApInvoiceSends.id, send.id));
        await fail(translateResendError(error.message));
        continue;
      }
      await db
        .update(arApInvoiceSends)
        .set({ messageId: data?.id ?? null })
        .where(eq(arApInvoiceSends.id, send.id));
      await db
        .update(arInvoiceReminders)
        .set({ status: "sent", sendId: send.id, sentAt: new Date() })
        .where(eq(arInvoiceReminders.id, claim.id));
      result.sent += 1;
      const diff = daysBetween(document.dueDate, today);
      await logAuditEvent({
        userId: actor,
        organizationId: orgId,
        action: "reminder_sent",
        entityType: "arap",
        entityId: document.id,
        summary: `${document.documentNo} төлбөрийн сануулга → ${recipient} (${diff < 0 ? `${-diff} хоногийн өмнө` : diff === 0 ? "хугацааны өдөр" : `${diff} хоног хэтэрсэн`})`,
      });
    } catch (error) {
      await fail(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

export interface ReminderRunResult {
  today: string;
  claimed: number;
  sent: number;
  failed: number;
  errors: { organizationId: string; error: string }[];
}

/** Асаалттай бүх байгууллагад өдөрт нэг удаа. */
export async function runInvoiceReminders(today = todayInUlaanbaatar()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { today, claimed: 0, sent: 0, failed: 0, errors: [] };
  const enabled = await db
    .select({ organizationId: arReminderSettings.organizationId })
    .from(arReminderSettings)
    .where(eq(arReminderSettings.enabled, true));
  for (const { organizationId } of enabled) {
    const [claim] = await db
      .insert(notificationRuns)
      .values({ organizationId, job: AR_REMINDER_JOB, periodKey: today })
      .onConflictDoNothing({
        target: [notificationRuns.job, notificationRuns.periodKey, notificationRuns.organizationId],
      })
      .returning({ id: notificationRuns.id });
    if (!claim) continue;
    result.claimed += 1;
    try {
      const org = await sendOrgInvoiceReminders(organizationId, today);
      result.sent += org.sent;
      result.failed += org.failed;
      await db
        .update(notificationRuns)
        .set({ finishedAt: new Date(), emitted: org.sent })
        .where(eq(notificationRuns.id, claim.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push({ organizationId, error: message });
      await db
        .update(notificationRuns)
        .set({ finishedAt: new Date(), error: message })
        .where(eq(notificationRuns.id, claim.id));
    }
  }
  return result;
}
