// Төлбөрийн автомат сануулга (docs/dev/arap.md §5g) — ЦЭВЭР логик (DB импортгүй,
// client-safe): тохиргооны шалгалт, аль шат илгээх вэ, и-мэйлийн агуулга.
// Тест: tests/ar-reminders.test.ts.

export interface ReminderSettings {
  enabled: boolean;
  /** Хугацаанаас хэдэн хоногийн өмнө — null бол урьдчилсан сануулгагүй. */
  beforeDays: number | null;
  /** Хэтэрсний дараах шатууд (хоног, өсөх дараалалтай). */
  afterDays: number[];
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: false, beforeDays: 3, afterDays: [1, 7, 14] };
export const REMINDER_MAX_AFTER_STAGES = 5;
export const REMINDER_BEFORE_MAX_DAYS = 30;
export const REMINDER_AFTER_MAX_DAYS = 180;
/**
 * Шат болсноос хойш энэ хоногийн дотор л илгээнэ. Асаах үед аль эрт хэтэрсэн
 * нэхэмжлэхүүд рүү нэг дор «хуучин өр» захиа цацахгүй; түр зогссон ticker-ийн
 * алгассан өдрийг нөхнө.
 */
export const REMINDER_CATCH_UP_DAYS = 7;
/** Нэг байгууллагад нэг өдөрт илгээх дээд тоо — илгээгчийн хязгаар, санамсаргүй цацалтаас. */
export const REMINDER_DAILY_LIMIT_PER_ORG = 100;
/** Бүтэлгүй шатыг дахин оролдох дээд тоо (өдөрт нэг). */
export const REMINDER_MAX_ATTEMPTS = 3;

export const REMINDER_STATUS_LABELS: Record<string, string> = {
  sent: "Илгээсэн",
  sending: "Илгээж байна",
  failed: "Бүтэлгүй",
};

export interface ReminderStage {
  /** "before:3" | "after:7" — ar_invoice_reminders.stage. */
  key: string;
  /** Төлөх огнооноос хойших хоног (өмнөх бол сөрөг). */
  offset: number;
}

export function reminderStages(settings: Pick<ReminderSettings, "beforeDays" | "afterDays">): ReminderStage[] {
  const stages: ReminderStage[] = [];
  if (settings.beforeDays) stages.push({ key: `before:${settings.beforeDays}`, offset: -settings.beforeDays });
  for (const days of settings.afterDays) stages.push({ key: `after:${days}`, offset: days });
  return stages.sort((a, b) => a.offset - b.offset);
}

/** "before:3" → «3 хоногийн өмнө», "after:7" → «7 хоног хэтэрсэн». */
export function reminderStageLabel(key: string): string {
  const [kind, days] = key.split(":");
  if (kind === "before") return `${days} хоногийн өмнө`;
  if (kind === "after") return `${days} хоног хэтэрсэн`;
  if (kind === "manual") return "Гараар";
  return key;
}

/** Хэрэглэгчийн оролтыг шалгаж хэвшүүлнэ; буруу бол монгол тайлбартай алдаа. */
export function normalizeReminderSettings(input: {
  enabled: boolean;
  beforeDays: number | null | undefined;
  afterDays: number[];
}): { value: ReminderSettings } | { error: string } {
  const beforeDays = input.beforeDays == null || input.beforeDays === 0 ? null : input.beforeDays;
  if (beforeDays !== null && (!Number.isInteger(beforeDays) || beforeDays < 1 || beforeDays > REMINDER_BEFORE_MAX_DAYS))
    return { error: `Урьдчилсан сануулга 1–${REMINDER_BEFORE_MAX_DAYS} хоногийн өмнө байна (хоосон бол илгээхгүй)` };
  const afterDays = [...new Set(input.afterDays)].sort((a, b) => a - b);
  if (afterDays.some((days) => !Number.isInteger(days) || days < 1 || days > REMINDER_AFTER_MAX_DAYS))
    return { error: `Хэтэрсний дараах хоног 1–${REMINDER_AFTER_MAX_DAYS} бүхэл тоо байна` };
  if (afterDays.length > REMINDER_MAX_AFTER_STAGES)
    return { error: `Хэтэрсний дараах сануулга ${REMINDER_MAX_AFTER_STAGES}-аас ихгүй` };
  if (input.enabled && beforeDays === null && afterDays.length === 0)
    return { error: "Асаахад дор хаяж нэг сануулгын шат хэрэгтэй" };
  return { value: { enabled: input.enabled, beforeDays, afterDays } };
}

/** "1, 7, 14" → [1, 7, 14]; тоо биш хэсэг байвал null. */
export function parseDayList(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const days = parts.map(Number);
  return days.every((day) => Number.isInteger(day)) ? days : null;
}

/** YYYY-MM-DD хоёрын зөрүү (to − from) хоногоор. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Өнөөдөр илгээх шат. Зөвхөн хамгийн сүүлд болсон НЭГ шатыг (өмнөх алгассан
 * шатуудыг давхар явуулахгүй), шат болсноос `REMINDER_CATCH_UP_DAYS` хоногийн
 * дотор, түүнээс хойшхи шат аль хэдийн явсан бол илгээхгүй. Урьдчилсан шат нь
 * хугацаа хэтрээгүй үед л.
 */
export function dueReminderStage(args: {
  settings: Pick<ReminderSettings, "beforeDays" | "afterDays">;
  dueDate: string;
  today: string;
  /** Энэ төлөх огноонд аль хэдийн шийдэгдсэн (илгээсэн / оролдлого дууссан) шатууд. */
  doneStages: readonly string[];
}): ReminderStage | null {
  const diff = daysBetween(args.dueDate, args.today);
  const stages = reminderStages(args.settings);
  const passed = stages.filter((stage) => stage.offset <= diff);
  const latest = passed.at(-1);
  if (!latest) return null;
  if (latest.offset < 0 && diff >= 0) return null;
  if (diff - latest.offset > REMINDER_CATCH_UP_DAYS) return null;
  const done = new Set(args.doneStages);
  if (stages.some((stage) => stage.offset >= latest.offset && done.has(stage.key))) return null;
  return latest;
}

export interface ReminderEmailInput {
  companyName: string;
  documentNo: string;
  dueDate: string;
  today: string;
  balance: number;
  currency: string;
  viewUrl: string;
  /** Линк дээр QPay-ээр төлөх боломжтой эсэх (docs/dev/arap.md §5f). */
  qpay: boolean;
  bankAccounts: { bankName: string; accountNo: string; accountName: string }[];
}

const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Гарчигт ДҮН БИЧИХГҮЙ (и-мэйлийн урьдчилан харагдах хэсэг, CLAUDE.md §9d). */
export function buildReminderEmail(input: ReminderEmailInput): { subject: string; text: string } {
  const diff = daysBetween(input.dueDate, input.today);
  const subject =
    diff < 0
      ? `Төлбөрийн сануулга: нэхэмжлэх № ${input.documentNo} — ${input.companyName}`
      : `Хугацаа хэтэрсэн төлбөр: нэхэмжлэх № ${input.documentNo} — ${input.companyName}`;
  const status =
    diff < 0
      ? `Төлөх хугацаа ${-diff} хоногийн дараа (${input.dueDate}) дуусна.`
      : diff === 0
        ? `Төлөх хугацаа өнөөдөр (${input.dueDate}) дуусна.`
        : `Төлөх хугацаа ${input.dueDate}-нд дууссан (${diff} хоног хэтэрсэн).`;
  const lines = [
    "Сайн байна уу,",
    "",
    `${input.companyName}-с илгээсэн № ${input.documentNo} нэхэмжлэхийн төлбөрийг сануулж байна.`,
    status,
    "",
    `Төлөгдөөгүй үлдэгдэл: ${money(input.balance)} ${input.currency}`,
    "",
    input.qpay ? `Нэхэмжлэхийг үзэх, QPay-ээр төлөх: ${input.viewUrl}` : `Нэхэмжлэхийг онлайнаар үзэх: ${input.viewUrl}`,
  ];
  if (input.bankAccounts.length)
    lines.push(
      "",
      "Төлбөр хүлээн авах данс:",
      ...input.bankAccounts.map((account) => `  ${account.bankName} · ${account.accountNo} · ${account.accountName}`)
    );
  lines.push("", "Хэрэв аль хэдийн төлсөн бол энэ захидлыг анхааралгүй өнгөрөөнө үү. Баярлалаа.");
  return { subject, text: lines.join("\n") };
}
