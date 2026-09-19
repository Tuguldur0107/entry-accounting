"use server";

// Мэдэгдлийн тохиргоо — ӨӨРИЙН (хэрэглэгч × идэвхтэй байгууллага) мөр.
// Эрхийн шалгалт шаардахгүй (өөрийн тохиргоо) — зөвхөн getActiveOrg.
// Хадгалалт: upsert (uniqueIndex user_org дээр — ai_settings-тэй ижил).

import { and, eq } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { notificationPreferences, users } from "@/lib/db/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationCategory,
} from "@/lib/notifications/catalog";
import {
  parseChannelPrefs,
  serializeChannelPrefs,
  type ChannelPrefs,
} from "@/lib/notifications/preferences";

export interface NotificationPreferencesData {
  channels: ChannelPrefs;
  digestHour: number;
  /** ISO эсвэл null. */
  mutedUntil: string | null;
  /** Хэрэглэгчийн и-мэйл (users.email) — хаашаа илгээхийг харуулна. */
  email: string;
  /** Сервер дээр Resend тохируулагдсан эсэх — үгүй бол и-мэйл багана идэвхгүй. */
  emailConfigured: boolean;
}

export async function getNotificationPreferences(): Promise<NotificationPreferencesData> {
  const { orgId, userId } = await getActiveOrg();
  const [row, user] = await Promise.all([
    db.query.notificationPreferences.findFirst({
      where: and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      ),
    }),
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true },
    }),
  ]);
  return {
    channels: parseChannelPrefs(row?.channels),
    digestHour: row?.digestHour ?? 8,
    mutedUntil: row?.mutedUntil ? row.mutedUntil.toISOString() : null,
    email: user?.email ?? "",
    emailConfigured: !!process.env.RESEND_API_KEY,
  };
}

export async function saveNotificationPreferences(input: {
  channels: ChannelPrefs;
  digestHour: number;
  /** ISO эсвэл null (унтраах). */
  mutedUntil: string | null;
}): Promise<ActionResult> {
  try {
    return await saveNotificationPreferencesCore(input);
  } catch (caught) {
    return actionError("saveNotificationPreferences", caught, "Тохиргоо хадгалагдсангүй");
  }
}

async function saveNotificationPreferencesCore(input: {
  channels: ChannelPrefs;
  digestHour: number;
  /** ISO эсвэл null (унтраах). */
  mutedUntil: string | null;
}) {
  const { orgId, userId } = await getActiveOrg();

  const digestHour = Math.round(Number(input.digestHour));
  if (!Number.isFinite(digestHour) || digestHour < 0 || digestHour > 23)
    throw new Error("Нэгтгэлийн цаг 0–23 хооронд байна");

  // Зөвхөн танигдсан категори + утга (serialize → parse round-trip fail-safe).
  const cleaned: ChannelPrefs = {};
  for (const category of Object.keys(NOTIFICATION_CATEGORY_LABELS) as NotificationCategory[]) {
    const pref = input.channels[category];
    if (pref) cleaned[category] = pref;
  }
  const channels = serializeChannelPrefs(parseChannelPrefs(serializeChannelPrefs(cleaned)));

  let mutedUntil: Date | null = null;
  if (input.mutedUntil) {
    mutedUntil = new Date(input.mutedUntil);
    if (Number.isNaN(mutedUntil.getTime())) throw new Error("Дуугүй хугацаа буруу байна");
  }

  await db
    .insert(notificationPreferences)
    .values({ userId, organizationId: orgId, channels, digestHour, mutedUntil })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.organizationId],
      set: { channels, digestHour, mutedUntil, updatedAt: new Date() },
    });
  return {};
}
