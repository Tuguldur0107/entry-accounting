// Цалингийн цэвэр тооцоолол — DB/framework хамааралгүй (тесттэй).
//
// Эх сурвалж (хувь хэмжээг ЭНДЭЭС өөр газар бичихийг хориглоно):
//   knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/social-insurance.md
//   knowledge/02-нягтлан-бодох-мэргэжлийн/payroll/pit.md
//   knowledge/01-онол-хууль-стандарт/tax/2026-updates.md
//
// Effective date guardrail (§10): ХАОАТ 2025 хүртэл 10% flat, 2026-аас
// шатлалт (10/15/20%). Хамаарах огноог заавал өгнө — таамаглахгүй.

/** Ажилтны НДШ — 11.5% (тэтгэвэр 8.5 + тэтгэмж 0.8 + ажилгүйдэл 0.2 + ЭМД 2.0). */
const EMPLOYEE_SI_RATE = 0.115;
/** Ажил олгогчийн НДШ ҮОМШӨ-гүй суурь — 11.7% (8.5 + 1.0 + 0.2 + 2.0). */
const EMPLOYER_SI_BASE_RATE = 0.117;

/** ХАОАТ-ын шатлал 2026-аас (pit.md). */
const PIT_BRACKETS_2026 = [
  { upTo: 10_000_000, rate: 0.1 },
  { upTo: 15_000_000, rate: 0.15 },
  { upTo: Infinity, rate: 0.2 },
] as const;

/** Бага орлогын ХАОАТ-ын хөнгөлөлт (pit.md, 23.1 зүйл). */
const PIT_CREDITS = [
  { upTo: 500_000, credit: 20_000 },
  { upTo: 1_000_000, credit: 18_000 },
  { upTo: 1_500_000, credit: 16_000 },
  { upTo: 2_000_000, credit: 14_000 },
  { upTo: 2_500_000, credit: 12_000 },
  { upTo: 3_000_000, credit: 10_000 },
] as const;

export function pitCreditOf(taxableIncome: number): number {
  for (const row of PIT_CREDITS)
    if (taxableIncome <= row.upTo) return row.credit;
  return 0;
}

/** Шатлалт (2026-аас) эсвэл flat 10% (2025 хүртэл) ХАОАТ — хөнгөлөлтгүй дүн. */
export function pitBeforeCredit(taxableIncome: number, date: string): number {
  if (taxableIncome <= 0) return 0;
  const year = Number(date.slice(0, 4));
  if (year < 2026) return Math.round(taxableIncome * 0.1);
  let tax = 0;
  let previous = 0;
  for (const bracket of PIT_BRACKETS_2026) {
    const portion = Math.min(taxableIncome, bracket.upTo) - previous;
    if (portion <= 0) break;
    tax += portion * bracket.rate;
    previous = bracket.upTo;
  }
  return Math.round(tax);
}

export type PayrollInput = {
  /** Нийт олголт (үндсэн + илүү цаг + урамшуулал). */
  earnings: number;
  /** Бусад суутгал (зээл г.м) — татварт нөлөөгүй, гарт олгохоос хасагдана. */
  otherDeductions?: number;
  /** ҮОМШӨ % (0.8–3.0, салбараас). */
  accidentRatePercent: number;
  /** Тооцооллын огноо YYYY-MM-DD — ХАОАТ-ын горимыг шийднэ. */
  date: string;
  /** Хөдөлмөрийн хөлсний доод хэмжээ (тохиргооноос). */
  minimumWage: number;
  /** НДШ cap үржүүлэгч (тохиргооноос, ихэвчлэн 10). */
  siCapMultiplier: number;
  /** Сарын татваргүй босго (2026: 800,000 — тохиргооноос; 0 = идэвхгүй). */
  monthlyTaxFree?: number;
};

export type PayrollResult = {
  earnings: number;
  cappedBase: number;
  employeeSi: number;
  employerSi: number;
  taxableIncome: number;
  pit: number;
  otherDeductions: number;
  netSalary: number;
  /** Компанийн нийт хөдөлмөрийн зардал = earnings + employerSi. */
  totalCost: number;
};

export function computeEmployeePayroll(input: PayrollInput): PayrollResult {
  const earnings = Math.round(input.earnings * 100) / 100;
  if (!(earnings >= 0) || !Number.isFinite(earnings))
    throw new Error("Нийт олголт 0-ээс багагүй байна");
  const otherDeductions = Math.round((input.otherDeductions ?? 0) * 100) / 100;
  if (!(otherDeductions >= 0))
    throw new Error("Бусад суутгал 0-ээс багагүй байна");
  const accidentRate = input.accidentRatePercent / 100;
  if (!(accidentRate >= 0) || accidentRate > 0.05)
    throw new Error("ҮОМШӨ хувь 0–5%-ийн хооронд байна");

  const siCap = input.minimumWage * input.siCapMultiplier;
  const cappedBase = Math.min(earnings, siCap);

  // Бүрэлдэхүүн тус бүрээр бөөрөнхийлнө (social-insurance.md-ийн жишээтэй ижил).
  const employeeSi =
    Math.round(cappedBase * 0.085) +
    Math.round(cappedBase * 0.008) +
    Math.round(cappedBase * 0.002) +
    Math.round(cappedBase * 0.02);
  const employerSi =
    Math.round(cappedBase * 0.085) +
    Math.round(cappedBase * 0.01) +
    Math.round(cappedBase * 0.002) +
    Math.round(cappedBase * 0.02) +
    Math.round(cappedBase * accidentRate);

  const taxFree = Math.max(0, input.monthlyTaxFree ?? 0);
  const taxableIncome = Math.max(0, earnings - employeeSi - taxFree);
  const pit = Math.max(
    0,
    pitBeforeCredit(taxableIncome, input.date) - pitCreditOf(taxableIncome)
  );

  const netSalary =
    Math.round((earnings - employeeSi - pit - otherDeductions) * 100) / 100;
  if (netSalary < 0)
    throw new Error("Суутгалууд нийт олголтоос их байна — гарт олгох сөрөг");

  return {
    earnings,
    cappedBase,
    employeeSi,
    employerSi,
    taxableIncome,
    pit,
    otherDeductions,
    netSalary,
    totalCost: Math.round((earnings + employerSi) * 100) / 100,
  };
}

// ── GL журналын мөр (gl-journal.md + CLAUDE.md §7-ийн 7 мөрийн схем) ────────

export type PayrollTotals = {
  earnings: number;
  employeeSi: number;
  employerSi: number;
  pit: number;
  otherDeductions: number;
  netSalary: number;
};

export type PayrollAccountNumbers = {
  salaryExpense: string;
  employerSiExpense: string;
  siPayable: string;
  pitPayable: string;
  salaryPayable: string;
  deduction: string;
};

export type PayrollJournalLine = {
  account: string;
  debit: number;
  credit: number;
  description: string;
};

/**
 * Цалингийн GL журналын мөрүүд:
 *   Dr Цалингийн зардал (нийт олголт) / Dr АО НДШ зардал
 *   Cr НДШ өглөг (ажилтан + АО) / Cr ХАОАТ өглөг / Cr Цалингийн өглөг (нэт)
 *   Cr Бусад суутгал (байвал)
 * Тэнцвэр: Dr = earnings + employerSi = Cr бүх мөр. 0-дүнтэй мөр орохгүй.
 */
export function buildPayrollJournalLines(
  totals: PayrollTotals,
  accounts: PayrollAccountNumbers,
  periodMonth: string
): PayrollJournalLine[] {
  const lines: PayrollJournalLine[] = [
    {
      account: accounts.salaryExpense,
      debit: totals.earnings,
      credit: 0,
      description: `Цалингийн зардал ${periodMonth}`,
    },
    {
      account: accounts.employerSiExpense,
      debit: totals.employerSi,
      credit: 0,
      description: `НДШ ажил олгогчийн зардал ${periodMonth}`,
    },
    {
      account: accounts.siPayable,
      debit: 0,
      credit: totals.employeeSi + totals.employerSi,
      description: `НДШ өглөг (ажилтан + АО) ${periodMonth}`,
    },
    {
      account: accounts.pitPayable,
      debit: 0,
      credit: totals.pit,
      description: `ХАОАТ өглөг ${periodMonth}`,
    },
    {
      account: accounts.salaryPayable,
      debit: 0,
      credit: totals.netSalary,
      description: `Цалингийн өглөг (нэт) ${periodMonth}`,
    },
  ];
  if (totals.otherDeductions > 0)
    lines.push({
      account: accounts.deduction,
      debit: 0,
      credit: totals.otherDeductions,
      description: `Бусад суутгал ${periodMonth}`,
    });
  return lines.filter((line) => line.debit > 0 || line.credit > 0);
}

// НДШ-ийн нэгдсэн хувь (тайлбар/шалгалтад) — экспортлоно.
export const PAYROLL_RATES = {
  employeeSiPercent: EMPLOYEE_SI_RATE * 100,
  employerSiBasePercent: EMPLOYER_SI_BASE_RATE * 100,
} as const;
