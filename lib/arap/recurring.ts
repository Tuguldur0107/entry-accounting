// Давтамжтай нэхэмжлэх (docs/dev/arap.md §5h) — ЦЭВЭР логик (DB импортгүй,
// client-safe): хуваарийн огноо, шалгалт, шошго. Тест: tests/ar-recurring.test.ts.

export const RECURRING_INTERVALS = [1, 3, 6, 12] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export const RECURRING_INTERVAL_LABELS: Record<RecurringInterval, string> = {
  1: "Сар бүр",
  3: "Улирал бүр",
  6: "Хагас жил бүр",
  12: "Жил бүр",
};

export const RECURRING_STATUS_LABELS: Record<string, string> = {
  active: "Идэвхтэй",
  paused: "Түр зогссон",
  ended: "Дууссан",
};

/** Нэг tick-д нэг загвараас нөхөх дээд тоо (сервер удаан унтарсан үед). */
export const RECURRING_MAX_CATCH_UP = 3;
export const RECURRING_MAX_TERMS_DAYS = 365;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** «2026-10» + өдөр → YYYY-MM-DD (0 эсвэл сарын уртаас их бол сарын сүүлийн өдөр). */
export function occurrenceInMonth(year: number, month: number, dayOfMonth: number): string {
  const last = daysInMonth(year, month);
  const day = dayOfMonth <= 0 || dayOfMonth > last ? last : dayOfMonth;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Эхлэх огнооноос хойших (тэр өдөр орно) эхний үүсгэх огноо. */
export function firstOccurrence(startDate: string, dayOfMonth: number, intervalMonths: number): string {
  const [year, month] = startDate.split("-").map(Number);
  const inStartMonth = occurrenceInMonth(year, month, dayOfMonth);
  if (inStartMonth >= startDate) return inStartMonth;
  const next = shiftMonth(year, month, intervalMonths);
  return occurrenceInMonth(next.year, next.month, dayOfMonth);
}

/** Өмнөх үүсгэх огнооноос дараагийнх (сар нэмээд өдрийг дахин тааруулна — 31 → 30 → 31 алдагдахгүй). */
export function nextOccurrence(current: string, dayOfMonth: number, intervalMonths: number): string {
  const [year, month] = current.split("-").map(Number);
  const next = shiftMonth(year, month, intervalMonths);
  return occurrenceInMonth(next.year, next.month, dayOfMonth);
}

/** Өнөөдрийг хүртэл үүсэх ёстой огноонууд (дээд тал нь `max`, дуусах огноог хүндэтгэнэ). */
export function dueOccurrences(args: {
  nextRunDate: string;
  today: string;
  endDate: string | null;
  dayOfMonth: number;
  intervalMonths: number;
  max?: number;
}): string[] {
  const out: string[] = [];
  let current = args.nextRunDate;
  const max = args.max ?? RECURRING_MAX_CATCH_UP;
  while (current <= args.today && out.length < max) {
    if (args.endDate && current > args.endDate) break;
    out.push(current);
    current = nextOccurrence(current, args.dayOfMonth, args.intervalMonths);
  }
  return out;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface RecurringScheduleInput {
  intervalMonths: number;
  dayOfMonth: number;
  paymentTermsDays: number;
  startDate: string;
  endDate: string | null;
  autoPost: boolean;
  sendEmail: boolean;
}

/** Хуваарийн оролтыг шалгана; буруу бол монгол тайлбартай алдаа. */
export function normalizeRecurringSchedule(
  input: RecurringScheduleInput
): { value: RecurringScheduleInput } | { error: string } {
  if (!RECURRING_INTERVALS.includes(input.intervalMonths as RecurringInterval))
    return { error: "Давтамж: сар, улирал, хагас жил эсвэл жил бүр" };
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 0 || input.dayOfMonth > 28)
    return { error: "Сарын өдөр 1–28 эсвэл «сарын сүүлийн өдөр»" };
  if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > RECURRING_MAX_TERMS_DAYS)
    return { error: `Төлөх хугацаа 0–${RECURRING_MAX_TERMS_DAYS} хоног` };
  if (!DATE_RE.test(input.startDate)) return { error: "Эхлэх огноо буруу" };
  const endDate = input.endDate?.trim() || null;
  if (endDate && !DATE_RE.test(endDate)) return { error: "Дуусах огноо буруу" };
  if (endDate && endDate < input.startDate) return { error: "Дуусах огноо эхлэхээс өмнө байж болохгүй" };
  if (input.sendEmail && !input.autoPost)
    return { error: "И-мэйлээр илгээхэд автоматаар батлах шаардлагатай — ноорог нэхэмжлэх илгээгдэхгүй" };
  return { value: { ...input, endDate } };
}

export function recurringScheduleLabel(intervalMonths: number, dayOfMonth: number): string {
  const every = RECURRING_INTERVAL_LABELS[intervalMonths as RecurringInterval] ?? `${intervalMonths} сар тутам`;
  return `${every}, ${dayOfMonth === 0 ? "сарын сүүлийн өдөр" : `сарын ${dayOfMonth}-нд`}`;
}

/** Үүссэн нэхэмжлэхийн утга: «Түрээс — 2026-10». */
export function recurringDescription(base: string, occurrence: string): string {
  return `${base.trim()} — ${occurrence.slice(0, 7)}`;
}

export const recurringExternalRef = (templateId: string, occurrence: string) => `recurring:${templateId}:${occurrence}`;
