// Хэрэглэгчийн СОНГОСОН период + scope — cookie-д хадгалагдаж БҮХ хуудсанд
// дагаж явна (server component-ууд эндээс уншина).
//
// Дүрэм: URL-ийн ил параметр (start/end, from/to, period…) сонголтыг
// ДАРНА — deep link хэвээр ажиллана. Cookie нь зөвхөн default-ыг өгнө.

import { cookies } from "next/headers";

import { isPeriodCode, periodCodeOf } from "./period";
import {
  isPeriodScope,
  scopeRange,
  type PeriodScope,
  type ScopeRange,
} from "./scope";

export const PERIOD_COOKIE = "ea-period";

export interface PeriodSelection extends ScopeRange {
  /** Зангуу сар — "2026-07". */
  periodCode: string;
  scope: PeriodScope;
  /** Улаанбаатарын өнөөдөр — YYYY-MM-DD. */
  today: string;
}

export function todayInUlaanbaatar(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Ulaanbaatar",
  });
}

/**
 * Одоогийн сонголт. Cookie байхгүй/эвдэрсэн бол: одоогийн сар + PTD.
 */
export async function getPeriodSelection(): Promise<PeriodSelection> {
  const today = todayInUlaanbaatar();
  let periodCode = periodCodeOf(today);
  let scope: PeriodScope = "PTD";

  const raw = (await cookies()).get(PERIOD_COOKIE)?.value;
  if (raw) {
    const [codePart, scopePart] = raw.split(":");
    if (codePart && isPeriodCode(codePart)) periodCode = codePart;
    if (scopePart && isPeriodScope(scopePart)) scope = scopePart;
  }

  return { periodCode, scope, today, ...scopeRange(periodCode, scope, today) };
}
