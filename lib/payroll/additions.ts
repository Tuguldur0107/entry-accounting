// Цалингийн НЭМЭГДЭЛ, ОЛГОВРУУДЫН цэвэр тооцоолол (DB-гүй, тесттэй).
//
// Knowledge: knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/overtime.md,
// law-reference.md (Хөдөлмөрийн тухай хууль 103, 106, 107, 108, 109).
//
// ЗАРЧИМ: бүх дүн ЦАГ / ХОНОГ-оос автоматаар бодогдоно, хэрэглэгч дүнг гараар
// дарж бичиж болно (мөрд «гар» тэмдэглэгээ үлдэж, дахин бодолт түүнийг
// ДАРАХГҮЙ — lib/actions/payroll.ts). Энэ модуль өөрөө тэмдэглэгээг мэдэхгүй:
// зөвхөн "ямар дүн байх ёстой вэ" гэдгийг бодно.

import { isPeriodCode } from "@/lib/periods/period";

// ── Илүү цаг, шөнийн, амралт/баярын өдрийн нэмэгдэл ────────────────────────

export interface OvertimeCoefficients {
  /** Ердийн илүү цаг — ХЗ 103: 1.5× */
  overtime: number;
  /** Амралтын өдөр ажилласан — ХЗ 107: 1.5× (эсвэл нөхөн амралт) */
  restDay: number;
  /** Баярын өдөр ажилласан — ХЗ 108: 2.0× */
  holiday: number;
  /** Шөнийн ажил (22:00–06:00) — ХЗ 106: цагийн хөлсний +20% НЭМЭГДЭЛ */
  nightBonus: number;
}

/** Хуулийн суурь коэффициентүүд — тохиргооны default (байгууллага өөрчилж болно). */
export const LEGAL_OVERTIME_COEFFICIENTS: OvertimeCoefficients = {
  overtime: 1.5,
  restDay: 1.5,
  holiday: 2,
  nightBonus: 0.2,
};

export interface OvertimeHours {
  overtimeHours: number;
  restDayHours: number;
  holidayHours: number;
  nightHours: number;
}

export interface OvertimeBreakdown {
  overtime: number;
  restDay: number;
  holiday: number;
  night: number;
  /** Нийт нэмэгдэл — нийт олголтод (татварын сууринд) НЭМЭГДЭНЭ. */
  total: number;
}

function requireNonNegative(value: number, label: string): number {
  const rounded = Math.round(value * 100) / 100;
  if (!Number.isFinite(rounded) || rounded < 0)
    throw new Error(`${label} 0-ээс багагүй тоо байна`);
  return rounded;
}

/**
 * Илүү цаг / амралтын / баярын өдөр / шөнийн нэмэгдэл.
 *
 * Илүү цаг, амралтын ба баярын өдрийн цаг нь ажиллавал зохих цагаас ГАДУУР
 * ажилласан тул БҮТЭН коэффициентээр нэмэлт олголт болно (overtime.md-ийн
 * жишээ: 11,905 × 1.5 × 5 = 89,288₮).
 *
 * Шөнийн цаг нь ихэвчлэн ажлын цагийн ДОТОР байдаг тул зөвхөн НЭМЭГДЭЛ
 * хэсгийг (цагийн хөлсний 20%) тооцно — үндсэн олголт нь ажилласан цагаараа
 * аль хэдийн бодогдсон.
 */
export function computeOvertimePay(input: {
  hourlyRate: number;
  hours: OvertimeHours;
  coefficients?: Partial<OvertimeCoefficients>;
}): OvertimeBreakdown {
  const hourlyRate = requireNonNegative(input.hourlyRate, "Цагийн хөлс");
  const c = { ...LEGAL_OVERTIME_COEFFICIENTS, ...(input.coefficients ?? {}) };
  for (const [key, value] of Object.entries(c))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Коэффициент буруу: ${key}`);

  const overtimeHours = requireNonNegative(input.hours.overtimeHours, "Илүү цаг");
  const restDayHours = requireNonNegative(
    input.hours.restDayHours,
    "Амралтын өдрийн цаг"
  );
  const holidayHours = requireNonNegative(
    input.hours.holidayHours,
    "Баярын өдрийн цаг"
  );
  const nightHours = requireNonNegative(input.hours.nightHours, "Шөнийн цаг");

  const overtime = Math.round(hourlyRate * c.overtime * overtimeHours);
  const restDay = Math.round(hourlyRate * c.restDay * restDayHours);
  const holiday = Math.round(hourlyRate * c.holiday * holidayHours);
  const night = Math.round(hourlyRate * c.nightBonus * nightHours);
  return {
    overtime,
    restDay,
    holiday,
    night,
    total: overtime + restDay + holiday + night,
  };
}

// ── Дундаж цалин (ээлжийн амралт, тэтгэмжийн суурь) ────────────────────────

export interface EarningsHistoryRow {
  /** YYYY-MM */
  periodMonth: string;
  /** Тухайн сарын НИЙТ олголт (татварын суурь). */
  earnings: number;
}

export interface AverageEarnings {
  /** Сарын дундаж олголт. */
  monthly: number;
  /** Хэдэн сарын дата ашигласан (0 = түүх алга). */
  monthsUsed: number;
  /** Суурь: түүхээс үү, эсвэл түүхгүй тул үндсэн цалингаас уу. */
  basis: "history" | "baseSalary";
}

/** YYYY-MM → тухайн сараас өмнөх N сарын кодууд (шинэ→хуучин). */
export function previousPeriodCodes(periodMonth: string, months: number): string[] {
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");
  if (!Number.isInteger(months) || months <= 0)
    throw new Error("Сарын тоо эерэг бүхэл байна");
  const [year, month] = periodMonth.split("-").map(Number);
  const out: string[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < months; i++) {
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Дундаж сарын олголт — тухайн сараас ӨМНӨХ `months` сарын бодит олголтоор
 * (бодолт хийгдсэн сарууд л тооцогдоно; завсрын хоосон сар дундажийг
 * бууруулахгүй). Түүх огт байхгүй (шинэ ажилтан) бол үндсэн цалинг дундаж
 * болгон авч, `basis: "baseSalary"` гэж ИЛ тэмдэглэнэ — дүнг зохиохгүй,
 * харин хаанаас гарснаа хэрэглэгчид хэлнэ.
 */
export function averageMonthlyEarnings(input: {
  periodMonth: string;
  history: EarningsHistoryRow[];
  months: number;
  baseSalary: number;
}): AverageEarnings {
  const codes = new Set(previousPeriodCodes(input.periodMonth, input.months));
  const rows = input.history.filter(
    (row) => codes.has(row.periodMonth) && Number.isFinite(row.earnings) && row.earnings > 0
  );
  if (rows.length === 0)
    return {
      monthly: Math.round(requireNonNegative(input.baseSalary, "Үндсэн цалин")),
      monthsUsed: 0,
      basis: "baseSalary",
    };
  const sum = rows.reduce((total, row) => total + row.earnings, 0);
  return {
    monthly: Math.round(sum / rows.length),
    monthsUsed: rows.length,
    basis: "history",
  };
}

/** Өдрийн дундаж хөлс = сарын дундаж / сарын ажлын өдрийн норм. */
export function averageDailyWage(monthly: number, monthlyWorkDays: number): number {
  const average = requireNonNegative(monthly, "Сарын дундаж олголт");
  if (!(monthlyWorkDays > 0))
    throw new Error("Сарын ажлын өдөр 0-ээс их байх ёстой");
  return Math.round((average / monthlyWorkDays) * 100) / 100;
}

/** Ээлжийн амралтын олговор = өдрийн дундаж × амралтын хоног (ХЗ 109). */
export function computeVacationPay(dailyWage: number, days: number): number {
  const daily = requireNonNegative(dailyWage, "Өдрийн дундаж хөлс");
  const vacationDays = requireNonNegative(days, "Ээлжийн амралтын хоног");
  return Math.round(daily * vacationDays);
}

/**
 * ХЧТА (хөдөлмөрийн чадвар түр алдалт)-ын тэтгэмж = өдрийн дундаж × хоног ×
 * тэтгэмжийн хувь. Хувь нь НД-ын шимтгэл төлсөн жилээс хамаардаг тул
 * ажилтан бүрд ИЛ тохируулагдана — тохируулаагүй бол `null` буцааж
 * АВТОМАТААР бодохгүй (хувийг ЗОХИОХГҮЙ; хэрэглэгч гараар оруулна).
 */
export function computeSickBenefit(
  dailyWage: number,
  days: number,
  percent: number | null
): number | null {
  const daily = requireNonNegative(dailyWage, "Өдрийн дундаж хөлс");
  const sickDays = requireNonNegative(days, "ХЧТА хоног");
  if (sickDays === 0) return 0;
  if (percent === null || percent === undefined) return null;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    throw new Error("ХЧТА тэтгэмжийн хувь 0–100 хооронд байна");
  return Math.round((daily * sickDays * percent) / 100);
}
