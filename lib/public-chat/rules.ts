// Landing-ийн чат (entry.mn) — ЦЭВЭР дүрэм (DB, сүлжээгүй, тесттэй).
// docs/dev/public-chat.md. Хоёр суваг НЭГ хүснэгтэд:
//   room    — НИЙТИЙН өрөө: бүх зочин хардаг; бүртгэлгүй, зөвхөн нэр
//   private — зочин ↔ Entry баг 1:1 (thread); зочны токеноор л нээгдэнэ
// AI автоматаар ХАРИУЛАХГҮЙ (CLAUDE.md §9a) — хариуг зөвхөн Entry баг бичнэ.

export type PublicChatScope = "room" | "private";
/** ai — landing-ийн «AI туслах» (зөвхөн хувийн ярианд, assistant-rules.ts). */
export type PublicChatAuthor = "visitor" | "team" | "ai";

export const PUBLIC_CHAT_MAX_BODY = 1000;
export const PUBLIC_CHAT_MAX_NAME = 40;
export const PUBLIC_CHAT_DEFAULT_NAME = "Зочин";
/** Багийн мессежийн нийтэд харагдах нэр — ажилтны нэр зөвхөн дотооддоо. */
export const PUBLIC_CHAT_TEAM_NAME = "Entry баг";
/** Нэг хүсэлтэд буцаах дээд мөр (polling). */
export const PUBLIC_CHAT_PAGE = 50;
/** Ижил зочны ижил текстийг энэ хугацаанд давтахгүй (спам). */
export const PUBLIC_CHAT_DUPLICATE_WINDOW_MS = 60_000;

/**
 * IP бүрийн хязгаар (sliding window, lib/rate-limit.ts). Polling 5 сек тутам =
 * 12/мин тул уншилтын хязгаар хэд хэдэн табыг даана.
 */
export const PUBLIC_CHAT_LIMITS = {
  read: { limit: 60, windowMs: 60_000 },
  session: { limit: 10, windowMs: 3_600_000 },
  roomPost: { limit: 5, windowMs: 60_000 },
  roomPostHourly: { limit: 30, windowMs: 3_600_000 },
  threadCreate: { limit: 3, windowMs: 3_600_000 },
  threadPost: { limit: 20, windowMs: 600_000 },
} as const;

export class PublicChatInputError extends Error {}

// Удирдах тэмдэгт (мөр шилжилтээс бусад) — харагдахгүй тэмдэгтээр нэр/текст
// хуурамчлахаас сэргийлнэ (zero-width, bidi override ч орно).
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;

export function normalizeBody(raw: unknown): string {
  if (typeof raw !== "string") throw new PublicChatInputError("Мессеж хоосон байна");
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new PublicChatInputError("Мессеж хоосон байна");
  if (text.length > PUBLIC_CHAT_MAX_BODY)
    throw new PublicChatInputError(`Мессеж ${PUBLIC_CHAT_MAX_BODY} тэмдэгтээс урт байна`);
  return text;
}

// Багийн нэрийг дуурайхаас сэргийлнэ — баг нь `author = team` тэмдэгтэй
// гардаг ч «Entry баг» гэсэн нэртэй зочин төөрөгдүүлнэ.
const RESERVED_NAME = /entry|энтри|админ|admin|support|дэмжлэг|модератор|moderator/i;

export function normalizeName(raw: unknown): string {
  if (raw == null || raw === "") return PUBLIC_CHAT_DEFAULT_NAME;
  if (typeof raw !== "string") throw new PublicChatInputError("Нэр буруу байна");
  const name = raw.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (!name) return PUBLIC_CHAT_DEFAULT_NAME;
  if (name.length > PUBLIC_CHAT_MAX_NAME)
    throw new PublicChatInputError(`Нэр ${PUBLIC_CHAT_MAX_NAME} тэмдэгтээс урт байна`);
  if (RESERVED_NAME.test(name)) throw new PublicChatInputError("Энэ нэрийг ашиглах боломжгүй");
  return name;
}

export function normalizeEmail(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new PublicChatInputError("И-мэйл буруу байна");
  const email = raw.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new PublicChatInputError("И-мэйл буруу байна");
  return email;
}

/** Монгол дугаар (8 орон, +976 зөвшөөрнө) → зөвхөн цифр. */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new PublicChatInputError("Утасны дугаар буруу байна");
  const digits = raw.replace(/[\s\-()]/g, "").replace(/^\+?976/, "");
  if (!digits) return null;
  if (!/^\d{8}$/.test(digits)) throw new PublicChatInputError("Утасны дугаар 8 оронтой байна");
  return digits;
}

// Нийтийн өрөөнд холбоос ХОРИОТОЙ (спам, фишинг). Хувийн чатад зөвшөөрнө —
// зөвхөн Entry баг хардаг.
const LINK = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|mn|net|org|io|ru|cn|xyz|top|link|site|online|info|biz|me|app|dev)\b)/i;

export function containsLink(text: string): boolean {
  return LINK.test(text);
}

/**
 * Нийтийн өрөөнд хувийн мэдээлэл автоматаар НУУГДАНА: и-мэйл, утас, РД,
 * урт тоо (данс, карт). Хүн өөрийгөө олон нийтэд задлахаас хамгаална —
 * UI нь `masked` үед «Хувиар асуух»-ыг санал болгоно.
 */
export function maskPersonalData(text: string): { text: string; masked: boolean } {
  let masked = false;
  const replace = (pattern: RegExp, label: string) => (value: string) =>
    value.replace(pattern, () => {
      masked = true;
      return label;
    });
  const steps = [
    replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[и-мэйл нуусан]"),
    // РД: үгийн эхэнд 2 кирилл үсэг + 8 цифр (том үсгийн дараа зай зөвшөөрнө;
    // «утас 99112233»-ийн «ас» РД биш)
    replace(/(?<![А-ЯЁӨҮа-яёөү])(?:[А-ЯЁӨҮ]{2}[\s-]?|[а-яёөү]{2})\d{8}(?!\d)/g, "[РД нуусан]"),
    // Утас: +976 сонголттой, 5–9-өөр эхэлсэн 8 цифр (4-4 хуваасан ч). 1-ээр
    // эхэлсэн (10000000 г.м. дүн) хөндөгдөхгүй.
    replace(/(?<!\d[\s-]?)(?:\+?976[\s-]?)?[5-9]\d{3}[\s-]?\d{4}(?![\s-]?\d)/g, "[утас нуусан]"),
    // Данс: 9+ залгаа цифр; карт: 4-4-4(-4) бүлэг. Зайтай дүн (150 000 000)
    // хөндөгдөхгүй.
    replace(/(?<!\d)(?:\d{9,}|\d{4}(?:[\s-]\d{4}){2,})(?!\d)/g, "[дугаар нуусан]"),
  ];
  const result = steps.reduce((value, step) => step(value), text);
  return { text: result, masked };
}

export type PreparedRoomMessage = { name: string; body: string; masked: boolean };

/** Нийтийн өрөөний зочны мессеж: нэр, текст, холбоос хориг, хувийн мэдээлэл нуух. */
export function prepareRoomMessage(input: { name?: unknown; body?: unknown }): PreparedRoomMessage {
  const name = normalizeName(input.name);
  const body = normalizeBody(input.body);
  if (containsLink(body))
    throw new PublicChatInputError("Нийтийн өрөөнд холбоос оруулах боломжгүй — хувиар асууна уу");
  const { text, masked } = maskPersonalData(body);
  return { name, body: text, masked };
}

export type PreparedThreadStart = {
  name: string;
  email: string | null;
  phone: string | null;
  body: string;
};

export function prepareThreadStart(input: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  body?: unknown;
}): PreparedThreadStart {
  return {
    name: normalizeName(input.name),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    body: normalizeBody(input.body),
  };
}

/** Зочны токен: URL-safe, 32 байт санамсаргүй (DB-д зөвхөн sha256). */
export function isVisitorToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Зөвшөөрөгдсөн origin-ууд (CORS). `PUBLIC_CHAT_ALLOWED_ORIGINS` — таслалаар;
 * байхгүй бол entry.mn + www. Origin-гүй (сервер-сервер, curl) хүсэлт CORS-д
 * хамаарахгүй — хамгаалалт нь rate limit + Turnstile.
 */
export function allowedOrigins(env: string | undefined): string[] {
  const list = (env ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : ["https://entry.mn", "https://www.entry.mn"];
}

// ─── Telegram (багийн групп) ───────────────────────────────────────────────

export type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number | string };
    from?: { first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
    text?: string;
    reply_to_message?: { message_id: number };
  };
  callback_query?: {
    id: string;
    from?: { first_name?: string; last_name?: string; username?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number | string }; text?: string };
  };
};

export type ModerationAction = "hide" | "unhide" | "block";

export type TeamCommand =
  | { kind: "reply"; replyToTelegramId: number; body: string; staff: string; telegramMessageId: number }
  | { kind: "room_post"; body: string; staff: string; telegramMessageId: number }
  | { kind: "moderate"; action: ModerationAction; messageId: string; staff: string; callbackId: string }
  | { kind: "help" }
  | { kind: "ignore" };

function staffName(from?: { first_name?: string; last_name?: string; username?: string }): string {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return (name || from?.username || "Telegram").slice(0, 80);
}

/**
 * Багийн группаас ирсэн update-ийг команд болгоно. Зөвхөн ТОХИРУУЛСАН chat
 * (`PUBLIC_CHAT_TELEGRAM_CHAT_ID`) — бусад chat-аас ирсэн бүхнийг үл тоомсорлоно.
 *   - Relay мессежид «Reply» → тухайн өрөө/thread-д багийн хариу
 *   - `/room <текст>` → нийтийн өрөөнд багийн мессеж (FAQ дүүргэх)
 *   - [Нуух]/[Сэргээх]/[Зочныг хаах] товч → модерац
 */
export function parseTeamUpdate(update: TelegramUpdate, teamChatId: string): TeamCommand {
  const callback = update.callback_query;
  if (callback) {
    if (String(callback.message?.chat.id ?? "") !== teamChatId) return { kind: "ignore" };
    const match = /^(hide|unhide|block):([0-9a-f-]{36})$/i.exec(callback.data ?? "");
    if (!match || !isUuid(match[2])) return { kind: "ignore" };
    return {
      kind: "moderate",
      action: match[1].toLowerCase() as ModerationAction,
      messageId: match[2].toLowerCase(),
      staff: staffName(callback.from),
      callbackId: callback.id,
    };
  }
  const message = update.message;
  if (!message || String(message.chat.id) !== teamChatId || message.from?.is_bot) return { kind: "ignore" };
  const text = message.text?.trim() ?? "";
  if (!text) return { kind: "ignore" };
  const command = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text);
  if (command) {
    const name = command[1].toLowerCase();
    const rest = command[2]?.trim() ?? "";
    if (name === "room" && rest)
      return { kind: "room_post", body: rest, staff: staffName(message.from), telegramMessageId: message.message_id };
    if (name === "help" || name === "start" || name === "room") return { kind: "help" };
    return { kind: "ignore" };
  }
  if (message.reply_to_message)
    return {
      kind: "reply",
      replyToTelegramId: message.reply_to_message.message_id,
      body: text,
      staff: staffName(message.from),
      telegramMessageId: message.message_id,
    };
  return { kind: "ignore" };
}

export const TEAM_HELP_TEXT =
  "Entry чатын бот:\n" +
  "• Зочны мессеж дээр Reply хийж бичвэл тэр зочинд (эсвэл нийтийн өрөөнд) хариу очно\n" +
  "• /room <текст> — нийтийн өрөөнд Entry багийн нэрээр бичнэ\n" +
  "• [Нуух] товч — нийтийн өрөөнөөс мессежийг нууна\n" +
  "• [Зочныг хаах] — тэр хөтчөөс бичихийг хааж, нийтийн мессежийг нь бүгдийг нууна";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Багийн групп руу илгээх relay текст (HTML). Дүн, нууц агуулахгүй. */
export function relayText(input: {
  scope: PublicChatScope;
  name: string;
  body: string;
  email?: string | null;
  phone?: string | null;
  threadId?: string | null;
  isNewThread?: boolean;
  masked?: boolean;
}): string {
  const head =
    input.scope === "room"
      ? `💬 <b>Нийтийн өрөө</b> · ${escapeHtml(input.name)}`
      : `🔒 <b>${input.isNewThread ? "Шинэ хувийн асуулт" : "Хувийн"}</b> · ${escapeHtml(input.name)}`;
  const contact = [input.phone, input.email].filter(Boolean).map((v) => escapeHtml(String(v))).join(" · ");
  const lines = [head];
  if (contact) lines.push(contact);
  lines.push("", escapeHtml(input.body));
  if (input.masked) lines.push("", "<i>(хувийн мэдээлэл автоматаар нуугдсан)</i>");
  if (input.threadId) lines.push("", `<code>${input.threadId.slice(0, 8)}</code> · Reply хийж хариулна`);
  else lines.push("", "Reply → нийтийн өрөөнд хариулна");
  return lines.join("\n");
}
