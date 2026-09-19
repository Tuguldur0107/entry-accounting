// И-мэйл суваг — DB + Resend давхарга (ЭНГИЙН модуль, "use server" БИШ):
// ticker, cron route, script дуудна. Хэзээ ч шидэхгүй.
//
// Урсгал: emailedAt IS NULL мэдэгдлүүд (сүүлийн 3 хоног) → хэрэглэгчийн
// тохиргоо → planEmailDelivery → instant-ыг одоо, digest-ийг цагт нь
// (notification_runs job="digest", periodKey="<өдөр>:<userId>" булаалт —
// өдөрт нэг) → илгээгдсэн мөрүүдэд emailedAt. Илгээгч хаяг нэхэмжлэхийн
// илгээгчтэй ИЖИЛ эрэмбээр (tenant → env → алдаа, sandbox fallback үгүй).
// RESEND_API_KEY байхгүй бол чимээгүй алгасна (нэг удаа логлоно).

import { and, eq, gte, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companySettings,
  notificationPreferences,
  notificationRuns,
  notifications,
  organizations,
  users,
} from "@/lib/db/schema";
import {
  buildNotificationEmailPayload,
  type NotificationEmailItem,
} from "@/lib/email/notification-template";
import { resolveInvoiceSender, translateResendError } from "@/lib/email/sender";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

import { planEmailDelivery } from "./email-plan";
import { parseChannelPrefs } from "./preferences";

/** Илгээгдээгүй мэдэгдлийг хэдэн хоног хүртэл и-мэйлд авч үзэх вэ. */
const PENDING_WINDOW_DAYS = 3;

let warnedNoApiKey = false;
/** Илгээгч тохируулаагүй байгууллага бүрд процессод НЭГ л удаа анхааруулна
 *  (tick бүрд 13 байгууллага × алдаа гэж лог бөглөхгүй — 2026-09-19 deploy). */
const warnedNoSender = new Set<string>();

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

function hourInUlaanbaatar(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ulaanbaatar",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );
}

export interface EmailDeliveryResult {
  organizations: number;
  emails: number;
  notifications: number;
  errors: { organizationId: string; userId?: string; error: string }[];
  skipped?: string;
  /** Илгээгч тохируулаагүйгээс алгассан байгууллагын тоо. */
  skippedOrganizations?: number;
}

async function sendBatch(args: {
  organizationId: string;
  userId: string;
  ids: string[];
  kind: "instant" | "digest";
  date: string;
  apiKey: string;
  orgName: string;
  sender: { from: string; replyTo?: string };
  rowsById: Map<string, typeof notifications.$inferSelect>;
}): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, args.userId),
    columns: { email: true },
  });
  if (!user?.email) return;

  const items: NotificationEmailItem[] = args.ids
    .map((id) => args.rowsById.get(id))
    .filter((row): row is typeof notifications.$inferSelect => !!row)
    .map((row) => ({
      title: row.title,
      body: row.body,
      severity: row.severity as NotificationEmailItem["severity"],
      href: row.href,
      createdAt: row.createdAt.toISOString(),
    }));
  if (items.length === 0) return;

  const { Resend } = await import("resend");
  const resend = new Resend(args.apiKey);
  const { error } = await resend.emails.send(
    buildNotificationEmailPayload({
      to: user.email,
      from: args.sender.from,
      replyTo: args.sender.replyTo,
      orgName: args.orgName,
      appUrl: appBaseUrl(),
      items,
      kind: args.kind,
      date: args.date,
    })
  );
  if (error) throw new Error(translateResendError(error.message));

  await db
    .update(notifications)
    .set({ emailedAt: new Date() })
    .where(inArray(notifications.id, args.ids));
}

/** Нэг байгууллагын илгээгдээгүй мэдэгдлийг и-мэйлээр хүргэнэ. */
export async function deliverPendingEmailsForOrganization(
  organizationId: string,
  now = new Date()
): Promise<{
  emails: number;
  notifications: number;
  errors: EmailDeliveryResult["errors"];
  skippedReason?: "sender-not-configured";
}> {
  const result: {
    emails: number;
    notifications: number;
    errors: EmailDeliveryResult["errors"];
    skippedReason?: "sender-not-configured";
  } = { emails: 0, notifications: 0, errors: [] };
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return result;

  const since = new Date(now.getTime() - PENDING_WINDOW_DAYS * 86_400_000);
  const pending = await db.query.notifications.findMany({
    where: and(
      eq(notifications.organizationId, organizationId),
      isNull(notifications.emailedAt),
      gte(notifications.createdAt, since)
    ),
  });
  if (pending.length === 0) return result;

  const userIds = [...new Set(pending.map((row) => row.userId))];
  const today = todayInUlaanbaatar();
  const [prefRows, digestRuns, org, settings] = await Promise.all([
    db.query.notificationPreferences.findMany({
      where: and(
        eq(notificationPreferences.organizationId, organizationId),
        inArray(notificationPreferences.userId, userIds)
      ),
      columns: { userId: true, channels: true, digestHour: true },
    }),
    db.query.notificationRuns.findMany({
      where: and(
        eq(notificationRuns.organizationId, organizationId),
        eq(notificationRuns.job, "digest"),
        inArray(
          notificationRuns.periodKey,
          userIds.map((userId) => `${today}:${userId}`)
        )
      ),
      columns: { periodKey: true },
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { name: true },
    }),
    db.query.companySettings.findFirst({
      where: eq(companySettings.organizationId, organizationId),
      columns: {
        invoiceFromEmail: true,
        invoiceReplyTo: true,
        emailDomainVerified: true,
        name: true,
      },
    }),
  ]);

  const plan = planEmailDelivery({
    pending: pending.map((row) => ({ id: row.id, userId: row.userId, type: row.type })),
    prefsByUser: new Map(
      prefRows.map((row) => [
        row.userId,
        { channels: parseChannelPrefs(row.channels), digestHour: row.digestHour },
      ])
    ),
    hourUb: hourInUlaanbaatar(now),
    digestSentToday: new Set(digestRuns.map((run) => run.periodKey.split(":")[1])),
  });
  if (plan.instant.size === 0 && plan.digest.size === 0) return result;

  let sender: { from: string; replyTo?: string };
  try {
    sender = resolveInvoiceSender(
      settings
        ? {
            invoiceFromEmail: settings.invoiceFromEmail,
            invoiceReplyTo: settings.invoiceReplyTo,
            emailDomainVerified: settings.emailDomainVerified,
            companyName: settings.name || org?.name,
          }
        : null,
      process.env
    );
  } catch (error) {
    // Илгээгч тохируулаагүй = тохиргооны асуудал (RESEND_FROM_EMAIL эсвэл
    // компанийн мэдээлэл), ажлын алдаа биш — нэг удаа логлоод чимээгүй
    // алгасна; мэдэгдэл in-app-д хэвээр, тохируулмагц 3 хоногийн цонхонд
    // байгаа нь илгээгдэнэ.
    if (!warnedNoSender.has(organizationId)) {
      warnedNoSender.add(organizationId);
      console.log(
        `[notifications] и-мэйл алгаслаа (${organizationId}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    result.skippedReason = "sender-not-configured";
    return result;
  }

  const rowsById = new Map(pending.map((row) => [row.id, row]));
  const orgName = settings?.name || org?.name || "Entry Accounting";

  for (const [userId, ids] of plan.instant) {
    try {
      await sendBatch({
        organizationId,
        userId,
        ids,
        kind: "instant",
        date: today,
        apiKey,
        orgName,
        sender,
        rowsById,
      });
      result.emails += 1;
      result.notifications += ids.length;
    } catch (error) {
      result.errors.push({
        organizationId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const [userId, ids] of plan.digest) {
    try {
      // Өдөрт нэг нэгтгэл — булаалт (ticker × cron давхцал аюулгүй).
      const [claim] = await db
        .insert(notificationRuns)
        .values({ organizationId, job: "digest", periodKey: `${today}:${userId}` })
        .onConflictDoNothing({
          target: [
            notificationRuns.job,
            notificationRuns.periodKey,
            notificationRuns.organizationId,
          ],
        })
        .returning({ id: notificationRuns.id });
      if (!claim) continue;
      try {
        await sendBatch({
          organizationId,
          userId,
          ids,
          kind: "digest",
          date: today,
          apiKey,
          orgName,
          sender,
          rowsById,
        });
        await db
          .update(notificationRuns)
          .set({ finishedAt: new Date(), emitted: ids.length })
          .where(eq(notificationRuns.id, claim.id));
        result.emails += 1;
        result.notifications += ids.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await db
          .update(notificationRuns)
          .set({ finishedAt: new Date(), error: message })
          .where(eq(notificationRuns.id, claim.id));
        throw error;
      }
    } catch (error) {
      result.errors.push({
        organizationId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Бүх байгууллагад — ticker tick бүрд / cron `job=email`. */
export async function deliverPendingEmails(now = new Date()): Promise<EmailDeliveryResult> {
  const result: EmailDeliveryResult = { organizations: 0, emails: 0, notifications: 0, errors: [] };
  if (!process.env.RESEND_API_KEY) {
    if (!warnedNoApiKey) {
      warnedNoApiKey = true;
      console.log("[notifications] RESEND_API_KEY алга — и-мэйл суваг идэвхгүй");
    }
    result.skipped = "RESEND_API_KEY алга";
    return result;
  }
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  result.organizations = orgs.length;
  for (const org of orgs) {
    try {
      const part = await deliverPendingEmailsForOrganization(org.id, now);
      result.emails += part.emails;
      result.notifications += part.notifications;
      result.errors.push(...part.errors);
      if (part.skippedReason)
        result.skippedOrganizations = (result.skippedOrganizations ?? 0) + 1;
    } catch (error) {
      result.errors.push({
        organizationId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
