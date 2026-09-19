"use server";

// Telegram холболт — өөрийн (хэрэглэгч × байгууллага) тохиргоо. Урсгал:
//   1. startTelegramLink → 8 тэмдэгтийн код (notification_preferences.telegramLinkCode)
//   2. Хэрэглэгч bot-д `/start <код>` илгээнэ (t.me/<bot>?start=<код> линк)
//   3. verifyTelegramLink → getUpdates-аас кодоо олж chat id хадгална, код устгана
// Эрхийн шалгалт шаардахгүй (өөрийн тохиргоо).

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";
import { actionError, type ActionResult } from "@/lib/action-result";
import {
  findTelegramChatByCode,
  sendTelegramMessage,
  telegramBotUsername,
  telegramConfigured,
} from "@/lib/notifications/channels/telegram";

export interface TelegramLinkStatus {
  configured: boolean;
  botUsername: string | null;
  linked: boolean;
  /** Хүлээгдэж буй холболтын код (байвал). */
  code: string | null;
}

async function prefRow(userId: string, orgId: string) {
  return db.query.notificationPreferences.findFirst({
    where: and(
      eq(notificationPreferences.userId, userId),
      eq(notificationPreferences.organizationId, orgId)
    ),
    columns: { telegramChatId: true, telegramLinkCode: true },
  });
}

export async function getTelegramLinkStatus(): Promise<TelegramLinkStatus> {
  const { orgId, userId } = await getActiveOrg();
  const configured = telegramConfigured();
  const [row, botUsername] = await Promise.all([
    prefRow(userId, orgId),
    configured ? telegramBotUsername() : Promise.resolve(null),
  ]);
  return {
    configured,
    botUsername,
    linked: !!row?.telegramChatId,
    code: row?.telegramLinkCode ?? null,
  };
}

/** Шинэ код үүсгэж хадгална (хуучин кодыг дарна). */
export async function startTelegramLink(): Promise<
  ActionResult<Awaited<ReturnType<typeof startTelegramLinkCore>>>
> {
  try {
    return await startTelegramLinkCore();
  } catch (caught) {
    return actionError("startTelegramLink", caught, "Холболт эхлээгүй");
  }
}

async function startTelegramLinkCore(): Promise<{ code: string; botUsername: string | null }> {
  const { orgId, userId } = await getActiveOrg();
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_TOKEN серверт тохируулаагүй");
  const code = randomBytes(5).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  await db
    .insert(notificationPreferences)
    .values({ userId, organizationId: orgId, telegramLinkCode: code })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.organizationId],
      set: { telegramLinkCode: code, updatedAt: new Date() },
    });
  return { code, botUsername: await telegramBotUsername() };
}

/** Bot-ийн update-аас кодоо хайж холбоно. Олдоогүй бол linked=false. */
export async function verifyTelegramLink(): Promise<
  ActionResult<Awaited<ReturnType<typeof verifyTelegramLinkCore>>>
> {
  try {
    return await verifyTelegramLinkCore();
  } catch (caught) {
    return actionError("verifyTelegramLink", caught, "Баталгаажуулалт амжилтгүй");
  }
}

async function verifyTelegramLinkCore(): Promise<{ linked: boolean }> {
  const { orgId, userId } = await getActiveOrg();
  const row = await prefRow(userId, orgId);
  if (!row?.telegramLinkCode) throw new Error("Холболтын код үүсгээгүй байна");
  const chatId = await findTelegramChatByCode(row.telegramLinkCode);
  if (!chatId) return { linked: false };
  await db
    .update(notificationPreferences)
    .set({ telegramChatId: chatId, telegramLinkCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      )
    );
  try {
    await sendTelegramMessage(chatId, "✅ Entry Accounting-тай холбогдлоо. Мэдэгдэл энд ирнэ.");
  } catch (error) {
    console.error("[telegram] баталгаажуулах мессеж:", error);
  }
  return { linked: true };
}

export async function unlinkTelegram(): Promise<void> {
  const { orgId, userId } = await getActiveOrg();
  await db
    .update(notificationPreferences)
    .set({ telegramChatId: null, telegramLinkCode: null, updatedAt: new Date() })
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.organizationId, orgId)
      )
    );
}
