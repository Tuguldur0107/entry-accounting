// Цалингийн тохиргооны оролтын ЦЭВЭР шалгалт (DB-гүй, тесттэй).
//
// Хэрэглэгч тохиргоог UI-аас (Цалин → Тохиргоо) өөрчилдөг тул утга бүр
// хязгаартай: сөрөг цалин, 0 ажлын өдөр, хуулиас ДООГУУР коэффициент орвол
// бүх ажилтны бодолт чимээгүй буруудна.
//
// ЗАРЧИМ (CLAUDE.md §7): хуулийн доод хэмжээнээс ДООШ тавихыг ХОРИГЛОНО —
// байгууллага ДЭЭГҮҮР тогтоож болно. Дүнг «зөв рүү нь засаад» чимээгүй
// хадгалахгүй: алдааг монголоор буцааж, хэрэглэгч өөрөө шийднэ.

import { LEGAL_OVERTIME_COEFFICIENTS } from "./additions";

export interface PayrollSettingsInput {
  // Тооцооллын үзүүлэлт
  minimumWage: number;
  siCapMultiplier: number;
  monthlyTaxFree: number;
  standardMonthlyHours: number;
  monthlyWorkDays: number;
  averageEarningsMonths: number;
  // Нэмэгдлийн коэффициент (ХЗ 103·106·107·108)
  overtimeMultiplier: number;
  restDayMultiplier: number;
  holidayMultiplier: number;
  nightBonusRate: number;
}

/** Талбар бүрийн МОНГОЛ нэр — алдааны текстэд шууд орно. */
export const PAYROLL_SETTING_LABELS: Record<keyof PayrollSettingsInput, string> = {
  minimumWage: "Хөдөлмөрийн хөлсний доод хэмжээ",
  siCapMultiplier: "НДШ-ийн дээд хязгаарын үржүүлэгч",
  monthlyTaxFree: "Сарын татваргүй босго",
  standardMonthlyHours: "Сарын стандарт ажлын цаг",
  monthlyWorkDays: "Сарын ажлын өдрийн норм",
  averageEarningsMonths: "Дундаж цалин бодох сарын тоо",
  overtimeMultiplier: "Илүү цагийн коэффициент",
  restDayMultiplier: "Амралтын өдрийн коэффициент",
  holidayMultiplier: "Баярын өдрийн коэффициент",
  nightBonusRate: "Шөнийн нэмэгдлийн хувь",
};

/** Коэффициент бүрийн ХУУЛИЙН доод хэмжээ — түүнээс доош тавьж болохгүй. */
const LEGAL_MINIMUMS = {
  overtimeMultiplier: LEGAL_OVERTIME_COEFFICIENTS.overtime,
  restDayMultiplier: LEGAL_OVERTIME_COEFFICIENTS.restDay,
  holidayMultiplier: LEGAL_OVERTIME_COEFFICIENTS.holiday,
  nightBonusRate: LEGAL_OVERTIME_COEFFICIENTS.nightBonus,
} as const;

const LEGAL_ARTICLE: Record<keyof typeof LEGAL_MINIMUMS, string> = {
  overtimeMultiplier: "ХЗ 103",
  restDayMultiplier: "ХЗ 107",
  holidayMultiplier: "ХЗ 108",
  nightBonusRate: "ХЗ 106",
};

function num(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} — тоо оруулна уу`);
  return parsed;
}

/**
 * Тохиргоог шалгаж DB-д бичих ХЭЛБЭРТ (numeric нь string) хөрвүүлнэ.
 * Алдаа гарвал ШИДНЭ — дуудагч action нь мессежийг хэрэглэгчид буцаана.
 */
export function validatePayrollSettings(input: PayrollSettingsInput) {
  const minimumWage = num(input.minimumWage, PAYROLL_SETTING_LABELS.minimumWage);
  if (minimumWage <= 0)
    throw new Error(`${PAYROLL_SETTING_LABELS.minimumWage} 0-ээс их байна`);

  const siCapMultiplier = num(
    input.siCapMultiplier,
    PAYROLL_SETTING_LABELS.siCapMultiplier
  );
  if (!Number.isInteger(siCapMultiplier) || siCapMultiplier < 1)
    throw new Error(
      `${PAYROLL_SETTING_LABELS.siCapMultiplier} 1-ээс багагүй бүхэл тоо байна`
    );

  const monthlyTaxFree = num(
    input.monthlyTaxFree,
    PAYROLL_SETTING_LABELS.monthlyTaxFree
  );
  if (monthlyTaxFree < 0)
    throw new Error(`${PAYROLL_SETTING_LABELS.monthlyTaxFree} сөрөг байж болохгүй`);

  const standardMonthlyHours = num(
    input.standardMonthlyHours,
    PAYROLL_SETTING_LABELS.standardMonthlyHours
  );
  // Цагийн хөлсний ХУВААГЧ — 0 бол бүх ажилтны бодолт хуваагдахгүй.
  if (standardMonthlyHours <= 0)
    throw new Error(
      `${PAYROLL_SETTING_LABELS.standardMonthlyHours} 0-ээс их байна (цагийн хөлсний хуваагч)`
    );

  const monthlyWorkDays = num(
    input.monthlyWorkDays,
    PAYROLL_SETTING_LABELS.monthlyWorkDays
  );
  // Өдрийн дундаж хөлсний ХУВААГЧ (ээлжийн амралт, ХЧТА).
  if (!(monthlyWorkDays > 0) || monthlyWorkDays > 31)
    throw new Error(
      `${PAYROLL_SETTING_LABELS.monthlyWorkDays} 0–31 хооронд байна (өдрийн дунджийн хуваагч)`
    );

  const averageEarningsMonths = num(
    input.averageEarningsMonths,
    PAYROLL_SETTING_LABELS.averageEarningsMonths
  );
  if (
    !Number.isInteger(averageEarningsMonths) ||
    averageEarningsMonths < 1 ||
    averageEarningsMonths > 60
  )
    throw new Error(
      `${PAYROLL_SETTING_LABELS.averageEarningsMonths} 1–60 хооронд бүхэл тоо байна`
    );

  const coefficients = {} as Record<keyof typeof LEGAL_MINIMUMS, number>;
  for (const key of Object.keys(LEGAL_MINIMUMS) as (keyof typeof LEGAL_MINIMUMS)[]) {
    const value = num(input[key], PAYROLL_SETTING_LABELS[key]);
    const minimum = LEGAL_MINIMUMS[key];
    if (value < minimum)
      throw new Error(
        `${PAYROLL_SETTING_LABELS[key]} нь хуулийн доод хэмжээ ${minimum}-аас багагүй байна (${LEGAL_ARTICLE[key]})`
      );
    coefficients[key] = value;
  }

  return {
    minimumWage: String(minimumWage),
    siCapMultiplier,
    monthlyTaxFree: String(monthlyTaxFree),
    standardMonthlyHours: String(standardMonthlyHours),
    monthlyWorkDays: String(monthlyWorkDays),
    averageEarningsMonths,
    overtimeMultiplier: String(coefficients.overtimeMultiplier),
    restDayMultiplier: String(coefficients.restDayMultiplier),
    holidayMultiplier: String(coefficients.holidayMultiplier),
    nightBonusRate: String(coefficients.nightBonusRate),
  };
}
