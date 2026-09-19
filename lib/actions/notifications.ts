"use server";

// Мэдэгдлийн inbox-ийн Server Actions — зөвхөн ӨӨРИЙН (userId × идэвхтэй
// байгууллага) мөрүүд. ID нь эрх ОЛГОХГҮЙ: уншсан гэж тэмдэглэх бүр userId +
// orgId-аар шүүгдэнэ (IDOR-оос хамгаалалт). Эрхийн шалгалт шаардахгүй —
// мэдэгдэл аль хэдийн эрхээр шүүгдэж бичигдсэн (lib/notifications/recipients.ts).

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export interface NotificationRow {
  id: string;
  type: string;
  category: string;
  severity: "info" | "warning" | "danger";
  title: string;
  body: string;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  /** ISO эсвэл null. */
  readAt: string | null;
  /** ISO. */
  createdAt: string;
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toRow(row: typeof notifications.$inferSelect): NotificationRow {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    severity: (row.severity as NotificationRow["severity"]) ?? "info",
    title: row.title,
    body: row.body,
    href: row.href,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: parsePayload(row.payload),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(input?: {
  limit?: number;
  unreadOnly?: boolean;
}): Promise<{ rows: NotificationRow[]; unread: number }> {
  const { orgId, userId } = await getActiveOrg();
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 500);
  const scope = and(
    eq(notifications.organizationId, orgId),
    eq(notifications.userId, userId)
  );
  const [rows, [unreadRow]] = await Promise.all([
    db.query.notifications.findMany({
      where: input?.unreadOnly ? and(scope, isNull(notifications.readAt)) : scope,
      orderBy: [desc(notifications.createdAt)],
      limit,
    }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(scope, isNull(notifications.readAt))),
  ]);
  return { rows: rows.map(toRow), unread: unreadRow?.n ?? 0 };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { orgId, userId } = await getActiveOrg();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt)
      )
    );
  return row?.n ?? 0;
}

export async function markNotificationsRead(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { orgId, userId } = await getActiveOrg();
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        inArray(notifications.id, ids.slice(0, 500))
      )
    )
    .returning({ id: notifications.id });
  return updated.length;
}

export async function markAllNotificationsRead(): Promise<number> {
  const { orgId, userId } = await getActiveOrg();
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return updated.length;
}
