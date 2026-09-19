// Нэмэлт сувгуудын хүргэлт (Telegram + custom/) — DB давхарга, хэзээ ч
// шидэхгүй. Мэдэгдэл × суваг бүр notification_deliveries-д НЭГ мөр:
// deliveredAt (амжилттай) эсвэл error ("skipped:…" / алдаа — дахин оролдохгүй).
// И-мэйл суваг тусдаа (email-delivery.ts, emailedAt).

import { and, eq, gte, inArray } from "drizzle-orm";

import { customNotificationChannels } from "@/lib/custom/loader";
import type { NotificationChannel, NotificationChannelContext } from "@/lib/custom/types";
import { db } from "@/lib/db";
import {
  notificationDeliveries,
  notificationPreferences,
  notifications,
  organizations,
  users,
} from "@/lib/db/schema";

import { isNotificationType } from "./catalog";
import { telegramChannel, telegramConfigured } from "./channels/telegram";
import { isChannelEnabled, parseChannelPrefs } from "./preferences";

const PENDING_WINDOW_DAYS = 3;

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

/** Идэвхтэй нэмэлт сувгууд: core Telegram (token байвал) + custom/. */
export function activeNotificationChannels(): NotificationChannel[] {
  const channels: NotificationChannel[] = [];
  if (telegramConfigured()) channels.push(telegramChannel);
  try {
    channels.push(...customNotificationChannels());
  } catch (error) {
    console.error("[notifications] custom сувгууд ачаалагдсангүй:", error);
  }
  return channels;
}

export interface ChannelDeliveryResult {
  channels: string[];
  sent: number;
  skipped: number;
  errors: { channel: string; notificationId: string; error: string }[];
}

export async function deliverPendingChannelsForOrganization(
  organizationId: string,
  channels: NotificationChannel[],
  now = new Date()
): Promise<ChannelDeliveryResult> {
  const result: ChannelDeliveryResult = {
    channels: channels.map((c) => c.key),
    sent: 0,
    skipped: 0,
    errors: [],
  };
  if (channels.length === 0) return result;

  const since = new Date(now.getTime() - PENDING_WINDOW_DAYS * 86_400_000);
  const pending = await db.query.notifications.findMany({
    where: and(eq(notifications.organizationId, organizationId), gte(notifications.createdAt, since)),
  });
  if (pending.length === 0) return result;

  const ids = pending.map((row) => row.id);
  const userIds = [...new Set(pending.map((row) => row.userId))];
  const [done, prefRows, userRows] = await Promise.all([
    db.query.notificationDeliveries.findMany({
      where: inArray(notificationDeliveries.notificationId, ids),
      columns: { notificationId: true, channel: true },
    }),
    db.query.notificationPreferences.findMany({
      where: and(
        eq(notificationPreferences.organizationId, organizationId),
        inArray(notificationPreferences.userId, userIds)
      ),
      columns: { userId: true, channels: true, telegramChatId: true },
    }),
    db.query.users.findMany({
      where: inArray(users.id, userIds),
      columns: { id: true, email: true },
    }),
  ]);
  const doneKeys = new Set(done.map((d) => `${d.notificationId}:${d.channel}`));
  const prefByUser = new Map(prefRows.map((row) => [row.userId, row]));
  const emailByUser = new Map(userRows.map((row) => [row.id, row.email]));
  const base = appBaseUrl();

  for (const channel of channels) {
    for (const row of pending) {
      if (doneKeys.has(`${row.id}:${channel.key}`)) continue;
      if (!isNotificationType(row.type)) continue;
      const pref = prefByUser.get(row.userId);
      const enabled = isChannelEnabled(
        parseChannelPrefs(pref?.channels),
        row.type,
        channel.key,
        channel.defaultEnabled ?? false
      );
      const record = async (outcome: { deliveredAt?: Date; error?: string }) => {
        await db
          .insert(notificationDeliveries)
          .values({
            notificationId: row.id,
            channel: channel.key,
            deliveredAt: outcome.deliveredAt ?? null,
            error: outcome.error ?? null,
          })
          .onConflictDoNothing({
            target: [notificationDeliveries.notificationId, notificationDeliveries.channel],
          });
      };
      if (!enabled) {
        await record({ error: "skipped:disabled" });
        result.skipped += 1;
        continue;
      }
      const ctx: NotificationChannelContext = {
        organizationId,
        userId: row.userId,
        userEmail: emailByUser.get(row.userId) ?? "",
        notification: {
          id: row.id,
          type: row.type,
          category: row.category,
          severity: row.severity as "info" | "warning" | "danger",
          title: row.title,
          body: row.body,
          href: row.href,
          url: `${base}${row.href && row.href.startsWith("/") ? row.href : "/notifications"}`,
          createdAt: row.createdAt.toISOString(),
        },
        preferences: { telegramChatId: pref?.telegramChatId ?? null },
      };
      try {
        const outcome = await channel.deliver(ctx);
        if (outcome === "sent") {
          await record({ deliveredAt: new Date() });
          result.sent += 1;
        } else {
          await record({ error: "skipped" });
          result.skipped += 1;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await record({ error: message.slice(0, 500) });
        result.errors.push({ channel: channel.key, notificationId: row.id, error: message });
      }
    }
  }
  return result;
}

/** Бүх байгууллагад — ticker tick бүрд / cron `job=channels`. */
export async function deliverPendingChannels(now = new Date()): Promise<ChannelDeliveryResult> {
  const channels = activeNotificationChannels();
  const total: ChannelDeliveryResult = {
    channels: channels.map((c) => c.key),
    sent: 0,
    skipped: 0,
    errors: [],
  };
  if (channels.length === 0) return total;
  const orgs = await db.select({ id: organizations.id }).from(organizations);
  for (const org of orgs) {
    try {
      const part = await deliverPendingChannelsForOrganization(org.id, channels, now);
      total.sent += part.sent;
      total.skipped += part.skipped;
      total.errors.push(...part.errors);
    } catch (error) {
      total.errors.push({
        channel: "*",
        notificationId: org.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return total;
}
