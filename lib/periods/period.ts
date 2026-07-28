// Нягтлан бодох периодын ЦЭВЭР туслахууд (DB хамааралгүй, unit тесттэй).
//
// Период = хуанлийн сар, код нь "YYYY-MM". Огноо бүр яг НЭГ периодод харьяална
// — өртгийн Periodic Weighted Average энэ хилээр тооцогдоно.

export type PeriodStatus = "open" | "closed";

export interface PeriodRef {
  code: string; // YYYY-MM
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: PeriodStatus;
}

const CODE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isPeriodCode(value: string): boolean {
  return CODE_RE.test(value);
}

/** Огноо (YYYY-MM-DD) → периодын код. Буруу огноонд алдаа шиднэ. */
export function periodCodeOf(date: string): string {
  if (!DATE_RE.test(date)) throw new Error(`Огноо буруу форматтай: ${date}`);
  const code = date.slice(0, 7);
  if (!isPeriodCode(code)) throw new Error(`Огноо буруу: ${date}`);
  return code;
}

/** Тухайн сарын сүүлийн өдөр (1..31) — UTC-ээр тооцно (цагийн бүсээс хамаарахгүй). */
export function lastDayOfMonth(code: string): number {
  const [year, month] = code.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Периодын код → эхлэх/дуусах огноо (хоёул ОРУУЛААД). */
export function periodRange(code: string): {
  startDate: string;
  endDate: string;
} {
  if (!isPeriodCode(code)) throw new Error(`Периодын код буруу: ${code}`);
  return {
    startDate: `${code}-01`,
    endDate: `${code}-${String(lastDayOfMonth(code)).padStart(2, "0")}`,
  };
}

/** Дараагийн период — "2026-12" → "2027-01". */
export function nextPeriodCode(code: string): string {
  if (!isPeriodCode(code)) throw new Error(`Периодын код буруу: ${code}`);
  const [year, month] = code.split("-").map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Өмнөх период — "2026-01" → "2025-12". */
export function previousPeriodCode(code: string): string {
  if (!isPeriodCode(code)) throw new Error(`Периодын код буруу: ${code}`);
  const [year, month] = code.split("-").map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/** from..to (оруулаад) хоорондох бүх периодын код, өсөх дарааллаар. */
export function periodCodesBetween(from: string, to: string): string[] {
  if (!isPeriodCode(from) || !isPeriodCode(to))
    throw new Error(`Периодын код буруу: ${from}..${to}`);
  if (from > to) return [];
  const codes: string[] = [];
  let cursor = from;
  // 100 жилийн дээд хязгаар — гогцоо хамгаалалт.
  for (let guard = 0; guard < 1200 && cursor <= to; guard += 1) {
    codes.push(cursor);
    cursor = nextPeriodCode(cursor);
  }
  return codes;
}

/**
 * Бичилт хийхийг зөвшөөрөх эсэх. Бүртгэгдээгүй период нь НЭЭЛТТЭЙ гэж
 * үзнэ — период бүртгэл нь хаалт хийхэд л үүсдэг, эс бөгөөс шинэ систем дээр
 * юу ч бичих боломжгүй болно.
 */
export function isPeriodWritable(
  periods: Map<string, PeriodStatus>,
  date: string
): boolean {
  return periods.get(periodCodeOf(date)) !== "closed";
}
