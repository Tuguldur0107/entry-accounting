// Telegram суваг (core, D3) — Bot API-гаар хэрэглэгчийн холбосон chat руу
// мэдэгдэл илгээнэ. Webhook ШААРДАХГҮЙ: холболтыг `getUpdates`-ээр
// баталгаажуулна (хэрэглэгч bot-д `/start <код>` илгээгээд «Холболт шалгах»
// дарна) — deploy-д нэмэлт тохиргоо зөвхөн TELEGRAM_BOT_TOKEN.
//
// NotificationChannel гэрээ (lib/custom/types.ts) — custom/ багцын сувагтай
// ИЖИЛ interface; хүргэлтийн sweep (channel-delivery.ts) хоёуланг нэг замаар.

import type { NotificationChannel, NotificationChannelContext } from "@/lib/custom/types";

export const TELEGRAM_CHANNEL_KEY = "telegram";
const API = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

function token(): string {
  const value = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN тохируулаагүй");
  return value;
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API}/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram: ${json.description ?? response.status}`);
  return json.result as T;
}

let cachedUsername: string | null = null;

/** Bot-ийн @username (getMe, процессын турш кэш) — холболтын линкэнд. */
export async function telegramBotUsername(): Promise<string | null> {
  if (!telegramConfigured()) return null;
  if (cachedUsername) return cachedUsername;
  try {
    const me = await call<{ username?: string }>("getMe");
    cachedUsername = me.username ?? null;
  } catch (error) {
    console.error("[telegram] getMe:", error);
    return null;
  }
  return cachedUsername;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegramMessage(chatId: string, html: string): Promise<void> {
  await call("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

/**
 * Холболтын кодыг bot-ийн хамгийн сүүлийн 100 update-аас хайна:
 * `/start <код>` эсвэл зөвхөн `<код>` гэсэн мессеж. Олдвол chat id.
 * (Webhook тохируулсан bot-д getUpdates ажиллахгүй — энэ систем webhook хэрэглэхгүй.)
 */
export async function findTelegramChatByCode(code: string): Promise<string | null> {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return null;
  const updates = await call<
    { message?: { chat?: { id: number | string }; text?: string } }[]
  >("getUpdates", { limit: 100, allowed_updates: ["message"] });
  for (const update of [...updates].reverse()) {
    const text = update.message?.text?.trim().toUpperCase() ?? "";
    const chat = update.message?.chat?.id;
    if (!chat) continue;
    if (text === wanted || text === `/START ${wanted}` || text.endsWith(` ${wanted}`))
      return String(chat);
  }
  return null;
}

const SEVERITY_MARK = { info: "•", warning: "⚠", danger: "‼" } as const;

export function telegramMessageFor(ctx: NotificationChannelContext): string {
  const n = ctx.notification;
  return (
    `${SEVERITY_MARK[n.severity]} <b>${escapeHtml(n.title)}</b>` +
    (n.body ? `\n${escapeHtml(n.body)}` : "") +
    `\n<a href="${escapeHtml(n.url)}">Нээх</a>`
  );
}

/** Core Telegram суваг — хэрэглэгч chat холбосон үед л илгээнэ. */
export const telegramChannel: NotificationChannel = {
  key: TELEGRAM_CHANNEL_KEY,
  label: "Telegram",
  // Холбогдсон хэрэглэгчид default асаалттай (холбоогүй бол skipped).
  defaultEnabled: true,
  async deliver(ctx) {
    if (!ctx.preferences.telegramChatId) return "skipped";
    await sendTelegramMessage(ctx.preferences.telegramChatId, telegramMessageFor(ctx));
    return "sent";
  },
};
