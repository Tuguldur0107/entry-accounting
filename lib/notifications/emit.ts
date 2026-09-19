// Мэдэгдэл БИЧИХ цэг — DB давхарга (ЭНГИЙН модуль, "use server" БИШ:
// аудитын гүүр, scheduler, script гурвуул шууд дуудна).
//
// Хатуу дүрэм: ХЭЗЭЭ Ч шидэхгүй (lib/audit.ts-тэй ижил) — мэдэгдэл алдагдах
// нь бичилт унахаас дээр. Транзакц дотор дуудвал executor-оо (tx) өгнө:
// insert нь тэр tx-тэй хамт commit/rollback хийгдэнэ. Уншилтууд (гишүүд,
// тохиргоо) db-гээр — түгжээ шаардахгүй.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  memberships,
  notificationPreferences,
  notifications,
  type MembershipRole,
} from "@/lib/db/schema";

import { NOTIFICATION_CATALOG } from "./catalog";
import { isInAppEnabled, parseChannelPrefs } from "./preferences";
import { selectRecipients } from "./recipients";
import type { NotificationDraft } from "./types";

/** db эсвэл tx — tx дотор бичих/унших (commit-оос өмнөх мөрийг харна). */
export type NotificationExecutor = Pick<typeof db, "insert" | "select">;

export interface EmitOptions {
  /** Үйлдлийг хийсэн хүн — өөрт нь очихгүй. */
  actorUserId?: string | null;
  /** Транзакц дотроос дуудахад tx. */
  executor?: NotificationExecutor;
  now?: Date;
}

/**
 * Нэг ноорог мэдэгдлийг хүлээн авагч бүрд мөр болгож бичнэ.
 * Буцаах утга: бичигдсэн мөрийн тоо (dedupe-ээр алгассаныг тоолохгүй).
 */
export async function emitNotification(
  organizationId: string,
  draft: NotificationDraft,
  options: EmitOptions = {}
): Promise<number> {
  try {
    if (draft.audience.kind === "entity-owner") {
      // Гүүр (bridge.ts) users болгож шийдээгүй — таамаглахгүй, алгасна.
      console.error("[notifications] шийдэгдээгүй entity-owner audience:", draft.type);
      return 0;
    }

    const members = await db.query.memberships.findMany({
      where: eq(memberships.organizationId, organizationId),
      columns: { userId: true, role: true, permissions: true },
    });
    const recipients = selectRecipients(
      members.map((m) => ({
        userId: m.userId,
        role: m.role as MembershipRole,
        permissions: m.permissions,
      })),
      draft.audience,
      options.actorUserId
    );
    if (recipients.length === 0) return 0;

    // Тохиргоо: түр дуугүй (mutedUntil) ба категорийн in-app унтраалт.
    const now = options.now ?? new Date();
    const prefRows = await db.query.notificationPreferences.findMany({
      where: and(
        eq(notificationPreferences.organizationId, organizationId),
        inArray(notificationPreferences.userId, recipients)
      ),
      columns: { userId: true, channels: true, mutedUntil: true },
    });
    const prefByUser = new Map(prefRows.map((row) => [row.userId, row]));
    const enabled = recipients.filter((userId) => {
      const pref = prefByUser.get(userId);
      if (!pref) return true;
      if (pref.mutedUntil && pref.mutedUntil > now) return false;
      return isInAppEnabled(parseChannelPrefs(pref.channels), draft.type);
    });
    if (enabled.length === 0) return 0;

    const def = NOTIFICATION_CATALOG[draft.type];
    const executor = options.executor ?? db;
    const inserted = await executor
      .insert(notifications)
      .values(
        enabled.map((userId) => ({
          organizationId,
          userId,
          type: draft.type,
          category: def.category,
          severity: draft.severity ?? def.severity,
          title: draft.title,
          body: draft.body,
          href: draft.href ?? null,
          entityType: draft.entityType ?? null,
          entityId: draft.entityId ?? null,
          payload: draft.payload ? JSON.stringify(draft.payload) : null,
          actorUserId: options.actorUserId ?? null,
          dedupeKey: draft.dedupeKey,
        }))
      )
      .onConflictDoNothing({
        target: [
          notifications.organizationId,
          notifications.userId,
          notifications.dedupeKey,
        ],
      })
      .returning({ id: notifications.id });
    return inserted.length;
  } catch (error) {
    console.error("[notifications] бичиж чадсангүй:", draft.type, error);
    return 0;
  }
}
