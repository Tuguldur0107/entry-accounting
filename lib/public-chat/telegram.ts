// Landing-ийн чатын Telegram bot — Entry багийн групп руу зочны мессежийг
// relay хийж, группаас Reply/командаар хариу авна (webhook).
//
// Мэдэгдлийн bot (lib/notifications/channels/telegram.ts)-оос ТУСДАА bot:
// тэр нь холболтын кодоо `getUpdates`-ээр уншдаг тул webhook тавибал эвдэрнэ.
// env: PUBLIC_CHAT_TELEGRAM_BOT_TOKEN, PUBLIC_CHAT_TELEGRAM_CHAT_ID (групп),
// PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET (Telegram-ийн secret_token).
// Тохируулаагүй бол relay алгасна — мессеж DB-д, Console-д харагдсаар.
//
// НЭЭЛТТЭЙ ГРУПП (олон нийтийн group-ийг ашиглах) — PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID
// тавибал: хувийн ярианы relay (зочны утас, и-мэйл, AI-ийн хариу) ЗӨВХӨН тэр
// chat руу (эзний bot-той DM эсвэл хаалттай групп) — нийтийн группт ОЧИХГҮЙ;
// группаас хариулах / `/room` / модерацын товч ЗӨВХӨН группын админд.

import { timingSafeEqual } from "node:crypto";

import { PUBLIC_CHAT_FAQ, faqCallbackData } from "./faq";
import { escapeHtml, relayText, telegramRef, type PublicChatScope, type TelegramChatRole } from "./rules";
import { setTelegramMessageId } from "./store";

const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export type PublicChatTelegramConfig = {
  token: string;
  chatId: string;
  /** null — хувийн яриа ч группт (хаалттай багийн групп). */
  privateChatId: string | null;
  webhookSecret: string | null;
};

export function publicChatTelegramConfig(): PublicChatTelegramConfig | null {
  const token = process.env.PUBLIC_CHAT_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.PUBLIC_CHAT_TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  const privateChatId = process.env.PUBLIC_CHAT_TELEGRAM_PRIVATE_CHAT_ID?.trim() || null;
  return {
    token,
    chatId,
    privateChatId: privateChatId && privateChatId !== chatId ? privateChatId : null,
    webhookSecret: process.env.PUBLIC_CHAT_TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Группыг олон нийтэд нээлттэй гэж үзэх үү (хувийн chat тусдаа тохируулсан). */
export function teamGroupIsPublic(config: PublicChatTelegramConfig): boolean {
  return config.privateChatId !== null;
}

/** Тухайн хүрээний relay аль chat руу очих. */
export function relayChatFor(config: PublicChatTelegramConfig, scope: PublicChatScope): TelegramChatRole {
  return scope === "private" && config.privateChatId ? "private" : "team";
}

function chatIdOf(config: PublicChatTelegramConfig, chat: TelegramChatRole): string {
  return chat === "private" && config.privateChatId ? config.privateChatId : config.chatId;
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

/** Багийн chat руу текст; DB-д хадгалах түлхүүрийг (`telegramRef`) буцаана. */
export async function sendTeamText(
  config: PublicChatTelegramConfig,
  html: string,
  replyTo?: number,
  chat: TelegramChatRole = "team"
): Promise<string> {
  const sent = await call<{ message_id: number }>(config, "sendMessage", {
    chat_id: chatIdOf(config, chat),
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
  });
  return telegramRef(chat, sent.message_id);
}

// Группын админуудын id — товч/хариу бүрд Telegram руу дуудахгүйн тулд богино кэш.
const ADMIN_CACHE_MS = 60_000;
let adminCache: { chatId: string; at: number; ids: Set<number> } | null = null;

/**
 * Нээлттэй группт «Entry баг» нэрээр бичих / модерац хийх эрх — группын
 * creator / administrator. Telegram алдаа өгвөл ЭРХГҮЙ гэж үзнэ (fail closed).
 */
export async function isTeamChatAdmin(config: PublicChatTelegramConfig, userId: number | null): Promise<boolean> {
  if (userId == null) return false;
  const now = Date.now();
  if (!adminCache || adminCache.chatId !== config.chatId || now - adminCache.at > ADMIN_CACHE_MS) {
    try {
      const admins = await call<Array<{ user: { id: number }; status: string }>>(config, "getChatAdministrators", {
        chat_id: config.chatId,
      });
      adminCache = { chatId: config.chatId, at: now, ids: new Set(admins.map((a) => a.user.id)) };
    } catch (error) {
      console.error("[public-chat] getChatAdministrators:", error);
      return false;
    }
  }
  return adminCache.ids.has(userId);
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
  const chat = relayChatFor(config, input.scope);
  try {
    const sent = await call<{ message_id: number }>(config, "sendMessage", {
      chat_id: chatIdOf(config, chat),
      text: relayText(input),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(input.scope === "room" ? { reply_markup: moderationKeyboard(input.messageId, false) } : {}),
    });
    await setTelegramMessageId(input.messageId, telegramRef(chat, sent.message_id));
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

/**
 * `/faq` — бэлэн хариултын товчнууд. `targetMessageId` (relay-ийн DB мөр) байвал
 * тэр зочин/мессежид, null бол нийтийн өрөөнд очно.
 */
export async function sendFaqMenu(
  config: PublicChatTelegramConfig,
  chat: TelegramChatRole,
  targetMessageId: string | null,
  replyTo: number
): Promise<void> {
  const buttons = PUBLIC_CHAT_FAQ.map((faq) => ({ text: faq.title, callback_data: faqCallbackData(faq.key, targetMessageId) }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  await call(config, "sendMessage", {
    chat_id: chatIdOf(config, chat),
    text: targetMessageId ? "Бэлэн хариулт — сонговол энэ зочинд очно:" : "Бэлэн хариулт — сонговол нийтийн өрөөнд очно:",
    reply_markup: { inline_keyboard: rows },
    reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
  });
}

/** Бэлэн хариулт илгээгдсэний дараа товчтой мессежийг илгээсэн текстээр солино (дахин дарахгүй). */
export async function markFaqSent(
  config: PublicChatTelegramConfig,
  chat: TelegramChatRole,
  buttonMessageId: number,
  html: string
): Promise<void> {
  try {
    await call(config, "editMessageText", {
      chat_id: chatIdOf(config, chat),
      message_id: buttonMessageId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error("[public-chat] editMessageText:", error);
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
    const ref = await sendTeamText(
      config,
      `🗨 <b>Entry баг</b> → ${where} (Console · ${escapeHtml(input.staff)})\n\n${escapeHtml(input.body)}`,
      undefined,
      relayChatFor(config, input.scope)
    );
    await setTelegramMessageId(input.messageId, ref);
  } catch (error) {
    console.error("[public-chat] telegram mirror:", error);
  }
}
