// Landing-ийн чатын Telegram bot — Entry багийн групп руу зочны мессежийг
// relay хийж, группаас Reply/командаар хариу авна (webhook).
//
// Мэдэгдлийн bot (lib/notifications/channels/telegram.ts)-оос ТУСДАА bot:
// тэр нь холболтын кодоо `getUpdates`-ээр уншдаг тул webhook тавибал эвдэрнэ.
// env: PUBLIC_CHAT_TELEGRAM_BOT_TOKEN, PUBLIC_CHAT_TELEGRAM_CHAT_ID (багийн
// групп), PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET (Telegram-ийн secret_token).
// Тохируулаагүй бол relay алгасна — мессеж DB-д, Console-д харагдсаар.

import { timingSafeEqual } from "node:crypto";

import { escapeHtml, relayText, type PublicChatScope } from "./rules";
import { setTelegramMessageId } from "./store";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export type PublicChatTelegramConfig = { token: string; chatId: string; webhookSecret: string | null };

export function publicChatTelegramConfig(): PublicChatTelegramConfig | null {
  const token = process.env.PUBLIC_CHAT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.PUBLIC_CHAT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return { token, chatId, webhookSecret: process.env.PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET?.trim() || null };
}

async function call<T>(config: PublicChatTelegramConfig, method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API}/bot${config.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? response.status}`);
  return json.result as T;
}

type InlineButton = { text: string; callback_data: string };

function moderationKeyboard(messageId: string, hidden: boolean): { inline_keyboard: InlineButton[][] } {
  return {
    inline_keyboard: [
      [
        hidden
          ? { text: "↩ Сэргээх", callback_data: `unhide:${messageId}` }
          : { text: "🙈 Нуух", callback_data: `hide:${messageId}` },
        { text: "⛔ Зочныг хаах", callback_data: `block:${messageId}` },
      ],
    ],
  };
}

export async function sendTeamText(config: PublicChatTelegramConfig, html: string, replyTo?: number): Promise<number> {
  const sent = await call<{ message_id: number }>(config, "sendMessage", {
    chat_id: config.chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
  return sent.message_id;
}

/**
 * Зочны мессежийг багийн групп руу. ХЭЗЭЭ Ч шидэхгүй — зочны хүсэлт commit
 * болсны ДАРАА (`after()`) дуудагдана; амжилтгүй бол telegramMessageId null
 * үлдэж Console «relay болоогүй» гэж харуулна.
 */
export async function relayVisitorMessage(input: {
  messageId: string;
  scope: PublicChatScope;
  name: string;
  body: string;
  email?: string | null;
  phone?: string | null;
  threadId?: string | null;
  isNewThread?: boolean;
  masked?: boolean;
}): Promise<void> {
  const config = publicChatTelegramConfig();
  if (!config) return;
  try {
    const sent = await call<{ message_id: number }>(config, "sendMessage", {
      chat_id: config.chatId,
      text: relayText(input),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(input.scope === "room" ? { reply_markup: moderationKeyboard(input.messageId, false) } : {}),
    });
    await setTelegramMessageId(input.messageId, sent.message_id);
  } catch (error) {
    console.error("[public-chat] telegram relay:", error);
  }
}

export async function answerCallback(config: PublicChatTelegramConfig, callbackId: string, text: string): Promise<void> {
  try {
    await call(config, "answerCallbackQuery", { callback_query_id: callbackId, text });
  } catch (error) {
    console.error("[public-chat] answerCallbackQuery:", error);
  }
}

export async function updateModerationButtons(
  config: PublicChatTelegramConfig,
  telegramMessageId: number,
  messageId: string,
  hidden: boolean
): Promise<void> {
  try {
    await call(config, "editMessageReplyMarkup", {
      chat_id: config.chatId,
      message_id: telegramMessageId,
      reply_markup: moderationKeyboard(messageId, hidden),
    });
  } catch (error) {
    console.error("[public-chat] editMessageReplyMarkup:", error);
  }
}

/** Telegram webhook-ийн `X-Telegram-Bot-Api-Secret-Token` (timing-safe). */
export function webhookAuthorized(config: PublicChatTelegramConfig, header: string | null): boolean {
  if (!config.webhookSecret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(config.webhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Console-оос бичсэн багийн мессежийг группт мөн харуулна (баг нэг газраас
 * бүгдийг хардаг) — түүн дээр Reply хийхэд тэр яриа руу очно. Шидэхгүй.
 */
export async function mirrorTeamMessage(input: {
  messageId: string;
  scope: PublicChatScope;
  threadId: string | null;
  staff: string;
  body: string;
}): Promise<void> {
  const config = publicChatTelegramConfig();
  if (!config) return;
  const where = input.scope === "room" ? "нийтийн өрөө" : `хувийн <code>${(input.threadId ?? "").slice(0, 8)}</code>`;
  try {
    const sentId = await sendTeamText(
      config,
      `🗨 <b>Entry баг</b> → ${where} (Console · ${escapeHtml(input.staff)})\n\n${escapeHtml(input.body)}`
    );
    await setTelegramMessageId(input.messageId, sentId);
  } catch (error) {
    console.error("[public-chat] telegram mirror:", error);
  }
}
