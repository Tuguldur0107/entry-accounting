// PTD / QTD / YTD шүүлтүүрийн муж — ЦЭВЭР логик (DB хамааралгүй, unit тесттэй).
//
// Сонгосон период (сар) нь ЗАНГУУ болно:
//   PTD (Period to Date)  — тухайн сарын эхнээс
//   QTD (Quarter to Date) — тухайн сарын улирлын эхнээс (I: 1-3, II: 4-6 …)
//   YTD (Year to Date)    — тухайн оны 1 сарын 1-нээс
//
// Дуусах огноо ("to date"-ийн утга):
//   • Өнгөрсөн сар → сарын сүүлийн өдөр (бүтэн сар)
//   • Одоогийн сар → ӨНӨӨДӨР (жинхэнэ "to date")
//   • Ирээдүйн сар → сарын сүүлийн өдөр (өгөгдөл угаас байхгүй)

import { isPeriodCode, lastDayOfMonth, periodCodeOf } from "./period";

export type PeriodScope = "PTD" | "QTD" | "YTD";

export const PERIOD_SCOPES: PeriodScope[] = ["PTD", "QTD", "YTD"];

export const PERIOD_SCOPE_LABELS: Record<PeriodScope, string> = {
  PTD: "PTD · Сар",
  QTD: "QTD · Улирал",
  YTD: "YTD · Жил",
};

export function isPeriodScope(value: string): value is PeriodScope {
  return value === "PTD" || value === "QTD" || value === "YTD";
}

/** Тухайн сарын улирлын ЭХНИЙ сар: "2026-05" → "2026-04". */
export function quarterStartCode(code: string): string {
  if (!isPeriodCode(code)) throw new Error(`Тайлант үеийн код буруу: ${code}`);
  const [year, month] = code.split("-").map(Number);
  const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return `${year}-${String(startMonth).padStart(2, "0")}`;
}

export interface ScopeRange {
  from: string; // YYYY-MM-DD (оруулаад)
  to: string; // YYYY-MM-DD (оруулаад)
}

/**
 * Зангуу период + scope → огнооны муж. `today` нь YYYY-MM-DD — тест
 * тогтвортой байлгахын тулд параметрээр ирнэ.
 */
export function scopeRange(
  code: string,
  scope: PeriodScope,
  today: string
): ScopeRange {
  if (!isPeriodCode(code)) throw new Error(`Тайлант үеийн код буруу: ${code}`);
  const [year] = code.split("-").map(Number);

  const from =
    scope === "PTD"
      ? `${code}-01`
      : scope === "QTD"
        ? `${quarterStartCode(code)}-01`
        : `${year}-01-01`;

  const periodEnd = `${code}-${String(lastDayOfMonth(code)).padStart(2, "0")}`;
  // "To date": зөвхөн ОДООГИЙН сард өнөөдрөөр таслана.
  const to = periodCodeOf(today) === code && today < periodEnd ? today : periodEnd;

  return { from, to };
}
