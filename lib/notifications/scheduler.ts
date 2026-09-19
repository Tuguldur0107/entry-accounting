// Хуваарьт мэдэгдлийн ХӨДӨЛГҮҮР — ЭНГИЙН модуль ("use server" БИШ): cron
// route, in-process ticker, script гурвуул үүнийг дуудна.
//
// Идемпотент: байгууллага × өдөр бүрд notification_runs мөрийг
// `insert … on conflict do nothing returning`-ээр НЭГ л дуудагч авна (олон
// instance / давхар дуудлага аюулгүй — advisory lock шаардахгүй). Мэдэгдэл
// бүр өөрийн dedupeKey-тэй тул ажил дундаа унаж дахин ажилласан ч давхардахгүй.
//
// Request scope ГАДНА ажилладаг: cookies(), revalidatePath() ДУУДАХГҮЙ;
// org scope-ыг параметрээр авна (getActiveOrg биш).

import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { notificationRuns, notifications, organizations } from "@/lib/db/schema";
import { todayInUlaanbaatar } from "@/lib/periods/selection";

import { dailyNotificationDrafts } from "./attention";
import { emitNotification } from "./emit";
import { loadAttentionInput } from "./load-attention";

/** Уншсан мэдэгдэл энэ хоногоос дээш хадгалагдахгүй (D6). */
export const NOTIFICATION_RETENTION_READ_DAYS = 90;
/** Уншаагүй мэдэгдэл энэ хоногоос дээш хадгалагдахгүй (D6). */
export const NOTIFICATION_RETENTION_UNREAD_DAYS = 180;

export interface DailyRunResult {
  today: string;
  organizations: number;
  /** Энэ дуудлага ажиллуулсан байгууллагууд (бусдыг өөр дуудагч аль хэдийн). */
  claimed: number;
  emitted: number;
  errors: { organizationId: string; error: string }[];
  purged: number;
}

/** Нэг байгууллагын өдрийн ажлыг булаан авч ажиллуулна; аль хэдийн хийгдсэн бол null. */
export async function runDailyForOrganization(
  organizationId: string,
  today: string
): Promise<{ emitted: number } | null> {
  const [claim] = await db
    .insert(notificationRuns)
    .values({ organizationId, job: "daily", periodKey: today })
    .onConflictDoNothing({
      target: [
        notificationRuns.job,
        notificationRuns.periodKey,
        notificationRuns.organizationId,
      ],
    })
    .returning({ id: notificationRuns.id });
  if (!claim) return null;

  try {
    const input = await loadAttentionInput(organizationId, today);
    let emitted = 0;
    for (const draft of dailyNotificationDrafts(input))
      emitted += await emitNotification(organizationId, draft);
    await db
      .update(notificationRuns)
      .set({ finishedAt: new Date(), emitted })
      .where(eq(notificationRuns.id, claim.id));
    return { emitted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(notificationRuns)
      .set({ finishedAt: new Date(), error: message })
      .where(eq(notificationRuns.id, claim.id));
    throw error;
  }
}

/** Хуучин мэдэгдлийг цэвэрлэнэ (D6: уншсан 90, уншаагүй 180 хоног). */
export async function purgeOldNotifications(now = new Date()): Promise<number> {
  const readBefore = new Date(now.getTime() - NOTIFICATION_RETENTION_READ_DAYS * 86_400_000);
  const unreadBefore = new Date(
    now.getTime() - NOTIFICATION_RETENTION_UNREAD_DAYS * 86_400_000
  );
  const [read, unread] = await Promise.all([
    db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, readBefore)))
      .returning({ id: notifications.id }),
    db
      .delete(notifications)
      .where(and(isNull(notifications.readAt), lt(notifications.createdAt, unreadBefore)))
      .returning({ id: notifications.id }),
  ]);
  return read.length + unread.length;
}

/**
 * Бүх байгууллагад өдрийн дүрмүүдийг ажиллуулна. Дахин дуудахад аюулгүй.
 * Байгууллага бүрийн алдаа бусдыг зогсоохгүй — үр дүнд жагсана.
 */
export async function runDailyNotifications(
  today: string = todayInUlaanbaatar()
): Promise<DailyRunResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(`Огноо буруу: ${today}`);

  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(sql`${organizations.createdAt} asc`);

  const result: DailyRunResult = {
    today,
    organizations: orgs.length,
    claimed: 0,
    emitted: 0,
    errors: [],
    purged: 0,
  };

  for (const org of orgs) {
    try {
      const run = await runDailyForOrganization(org.id, today);
      if (!run) continue;
      result.claimed += 1;
      result.emitted += run.emitted;
    } catch (error) {
      result.errors.push({
        organizationId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    result.purged = await purgeOldNotifications();
  } catch (error) {
    console.error("[notifications] цэвэрлэгээ:", error);
  }

  return result;
}
