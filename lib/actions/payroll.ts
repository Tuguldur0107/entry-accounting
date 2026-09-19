"use server";

// Цалингийн модулийн server actions.
//
// Урсгал (human-in-the-loop §9):
//   Ажилтан бүртгэх → Сарын бодолт (calculatePayrollRun) → мөр засварлах
//   → GL НООРОГ журнал үүсгэх (createPayrollVoucher) → нягтланч GL-ээс батална.
// Payroll post нь ЗААВАЛ нягтланчийн баталгаажуулалт шаарддаг тул энэ модуль
// хэзээ ч шууд posted журнал бичихгүй.

import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";

import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocuments,
  chartOfAccounts,
  counterparties,
  employees,
  journalVouchers,
  payrollRunLines,
  payrollRuns,
  payrollSettings,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { createVoucher } from "@/lib/actions/gl";
import { createArApDocument } from "@/lib/actions/arap";
import {
  SALARY_BILL_LABEL,
  salaryBillRefOf,
  type SalaryBillKind,
} from "@/lib/payroll/bills";
import { unwrapAction } from "@/lib/action-result";
import { assertPeriodOpen } from "@/lib/periods/guard";
import { isPeriodCode, periodRange } from "@/lib/periods/period";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import {
  buildPayrollJournalLines,
  computeEarnings,
  computeEmployeePayroll,
  type PayrollResult,
} from "@/lib/payroll/calc";
import {
  averageDailyWage,
  averageMonthlyEarnings,
  computeOvertimePay,
  computeSickBenefit,
  computeVacationPay,
  previousPeriodCodes,
  type AverageEarnings,
  type EarningsHistoryRow,
  type OvertimeCoefficients,
} from "@/lib/payroll/additions";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import { canAutoDefaultSegment } from "@/lib/gl/posting-code";
import { logAuditEvent } from "@/lib/audit";

function revalidatePayroll() {
  revalidatePath("/payroll");
  revalidatePath("/payroll/employees");
  revalidatePath("/payroll/reports");
  revalidatePath("/gl/journal");
  revalidatePath("/payables");
}

const voucherRefOf = (periodMonth: string) => `payroll:${periodMonth}`;



// ── Ажилтан ─────────────────────────────────────────────────────────────────

export type EmploymentType = "primary" | "contract" | "hourly";

export interface EmployeeInput {
  id?: string;
  name: string;
  lastName?: string;
  registerNo?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  homeAddress?: string;
  bankName?: string;
  bankAccountNo?: string;
  iban?: string;
  hireDate?: string;
  terminationDate?: string;
  department?: string;
  employmentType?: EmploymentType;
  position?: string;
  baseSalary: number;
  employerSiPercent: number;
  /**
   * ХЧТА (хөдөлмөрийн чадвар түр алдалт)-ын тэтгэмжийн хувь — НД-ын шимтгэл
   * төлсөн жилээс хамаарна. Тохируулаагүй (null) бол тэтгэмж АВТОМАТААР
   * бодогдохгүй: хувийг ЗОХИОХГҮЙ, хэрэглэгч дүнг гараар оруулна.
   */
  sickBenefitPercent?: number | null;
  isActive?: boolean;
}

const cleanOptional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const assertOptionalDate = (value: string | null, label: string) => {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error(`${label} YYYY-MM-DD форматтай байна`);
};

/**
 * Ажилтны талбаруудыг шалгаж DB-ийн утга болгоно. Нэр/овог давхцаж болно —
 * зөвхөн РД (өгөгдсөн үед) байгууллага дотор давхцахгүй.
 */
function validateEmployeeInput(data: EmployeeInput) {
  const name = data.name.trim();
  if (!name) throw new Error("Ажилтны нэр оруулна уу");
  const baseSalary = Number(data.baseSalary);
  if (!(baseSalary >= 0) || !Number.isFinite(baseSalary))
    throw new Error("Үндсэн цалин 0-ээс багагүй байна");
  const employerSiPercent = Number(data.employerSiPercent);
  if (!(employerSiPercent >= 0) || employerSiPercent > 20)
    throw new Error("АО-НДШ хувь 0–20%-ийн хооронд байна");

  const registerNo = cleanOptional(data.registerNo)?.toUpperCase() ?? null;
  const iban = cleanOptional(data.iban)?.replaceAll(" ", "").toUpperCase() ?? null;
  if (iban && !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban))
    throw new Error("IBAN формат буруу байна (ж: MN...20 тэмдэгт)");
  const email = cleanOptional(data.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("И-мэйл хаяг буруу байна");
  const birthDate = cleanOptional(data.birthDate);
  const hireDate = cleanOptional(data.hireDate);
  const terminationDate = cleanOptional(data.terminationDate);
  assertOptionalDate(birthDate, "Төрсөн огноо");
  assertOptionalDate(hireDate, "Ажилд орсон огноо");
  assertOptionalDate(terminationDate, "Гарсан огноо");
  if (hireDate && terminationDate && terminationDate < hireDate)
    throw new Error("Гарсан огноо ажилд орсон огнооноос өмнө байж болохгүй");
  // undefined = талбарыг ХӨНДӨХГҮЙ (Excel импорт энэ баганагүй), null =
  // цэвэрлэх (автомат бодолт унтарна).
  const sickBenefitPercent =
    data.sickBenefitPercent === undefined
      ? undefined
      : data.sickBenefitPercent === null
        ? null
        : Number(data.sickBenefitPercent);
  if (
    sickBenefitPercent !== undefined &&
    sickBenefitPercent !== null &&
    (!Number.isFinite(sickBenefitPercent) ||
      sickBenefitPercent < 0 ||
      sickBenefitPercent > 100)
  )
    throw new Error("ХЧТА тэтгэмжийн хувь 0–100%-ийн хооронд байна");
  const employmentType: EmploymentType = data.employmentType ?? "primary";
  if (!["primary", "contract", "hourly"].includes(employmentType))
    throw new Error("Ажил эрхлэлтийн төрөл буруу байна");

  return {
    name,
    lastName: data.lastName?.trim() ?? "",
    registerNo,
    birthDate,
    phone: cleanOptional(data.phone),
    email,
    homeAddress: cleanOptional(data.homeAddress),
    bankName: cleanOptional(data.bankName),
    bankAccountNo: cleanOptional(data.bankAccountNo),
    iban,
    hireDate,
    terminationDate,
    department: data.department?.trim() ?? "",
    employmentType,
    position: data.position?.trim() ?? "",
    baseSalary: String(baseSalary),
    employerSiPercent: String(employerSiPercent),
    ...(sickBenefitPercent === undefined
      ? {}
      : {
          sickBenefitPercent:
            sickBenefitPercent === null ? null : String(sickBenefitPercent),
        }),
    isActive: data.isActive ?? true,
  };
}

/** РД өгөгдсөн бол байгууллага дотор давхцаагүйг шалгана (өөрөөс нь бусад). */
async function assertRegisterUnique(
  orgId: string,
  registerNo: string | null,
  excludeId?: string
) {
  if (!registerNo) return;
  const duplicate = await db.query.employees.findFirst({
    where: and(
      eq(employees.organizationId, orgId),
      eq(employees.registerNo, registerNo)
    ),
    columns: { id: true, name: true, lastName: true },
  });
  if (duplicate && duplicate.id !== excludeId)
    throw new Error(
      `${registerNo} регистртэй ажилтан бүртгэлтэй байна: ${[duplicate.lastName, duplicate.name].filter(Boolean).join(" ")}`
    );
}

export async function upsertEmployee(data: EmployeeInput) {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  const values = validateEmployeeInput(data);
  await assertRegisterUnique(orgId, values.registerNo, data.id);

  if (data.id) {
    const [updated] = await db
      .update(employees)
      .set(values)
      .where(and(eq(employees.id, data.id), eq(employees.organizationId, orgId)))
      .returning({ id: employees.id });
    if (!updated) throw new Error("Ажилтан олдсонгүй");
  } else {
    await db.insert(employees).values({ userId, organizationId: orgId, ...values });
  }
  revalidatePayroll();
}

/**
 * Excel импорт — мөр бүр тусдаа шалгагдаж, РД таарвал байгаа ажилтныг
 * ШИНЭЧИЛНЭ, үгүй бол шинээр үүсгэнэ (жагсаалт татах → Excel-д засах →
 * буцааж оруулах round-trip). Мөр бүрд тусдаа амжилт/алдаа буцаана.
 */
export async function importEmployees(
  rows: EmployeeInput[]
): Promise<{ created: number; updated: number; errors: { index: number; message: string }[] }> {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  if (rows.length === 0) return { created: 0, updated: 0, errors: [] };
  if (rows.length > 500) throw new Error("Нэг удаад дээд тал нь 500 мөр");

  let created = 0;
  let updated = 0;
  const errors: { index: number; message: string }[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const values = validateEmployeeInput(row);
      const existing = values.registerNo
        ? await db.query.employees.findFirst({
            where: and(
              eq(employees.organizationId, orgId),
              eq(employees.registerNo, values.registerNo)
            ),
            columns: { id: true },
          })
        : null;
      if (existing) {
        await db
          .update(employees)
          .set(values)
          .where(
            and(
              eq(employees.id, existing.id),
              eq(employees.organizationId, orgId)
            )
          );
        updated += 1;
      } else {
        await db
          .insert(employees)
          .values({ userId, organizationId: orgId, ...values });
        created += 1;
      }
    } catch (caught) {
      errors.push({
        index,
        message: caught instanceof Error ? caught.message : "Алдаа гарлаа",
      });
    }
  }
  if (created + updated > 0) revalidatePayroll();
  return { created, updated, errors };
}

export async function toggleEmployee(id: string, isActive: boolean) {
  const { orgId } = await requireModuleAction("payroll", "write");
  await db
    .update(employees)
    .set({ isActive })
    .where(and(eq(employees.id, id), eq(employees.organizationId, orgId)));
  revalidatePayroll();
}

// ── Сарын бодолт ────────────────────────────────────────────────────────────

export type PayrollLineView = {
  id: string;
  employeeId: string;
  employeeName: string;
  position: string;
  employerSiPercent: number;
  /** Урьдчилгааны цагийн хөлс тооцох суурь (ажилтны үндсэн цалин). */
  baseSalary: number;
  /** Сард бодитоор ажилласан цаг (бүтэн сараар) — үндсэн олголтыг тогтооно. */
  workedHours: number;
  /** Үндсэн олголт = цалин × ажилласан / ажиллавал зохих цаг. */
  baseEarnings: number;
  /** Ээлжийн амралтын олговор — хоног × өдрийн дундажаас автомат. */
  vacationPay: number;
  /** Илүү цаг/шөнө/амралт-баярын нэмэгдэл — цагаас автомат. */
  overtimePay: number;
  otherAdditions: number;
  // Нэмэгдлийн ОРЦ (хэрэглэгч бөглөнө → дүн автоматаар бодогдоно)
  overtimeHours: number;
  restDayHours: number;
  holidayHours: number;
  nightHours: number;
  vacationDays: number;
  sickDays: number;
  /** ХЧТА тэтгэмж — татвар/НДШ-гүй, гарт олгоход нэмэгдэнэ. */
  sickBenefit: number;
  /** Дүнг гараар дарж бичсэн эсэх (дахин бодолт хөндөхгүй). */
  vacationPayManual: boolean;
  overtimePayManual: boolean;
  sickBenefitManual: boolean;
  /** Олговрын суурь дундаж — ил харуулах, аудитад. */
  averageMonthlyEarnings: number;
  averageMonthsUsed: number;
  /** ХЧТА-ийн хувь тохируулаагүй бол null — автомат бодогдохгүй. */
  sickBenefitPercent: number | null;
  /** Нийт олголт = үндсэн олголт + ээлжийн амралт + илүү цаг + бусад нэмэгдэл. */
  earnings: number;
  otherDeductions: number;
  employeeSi: number;
  employerSi: number;
  pit: number;
  /** Сарын НИЙТ гарт олгох = урьдчилгаа + сүүл цалин. */
  netSalary: number;
  /** Тухайн сард ажиллавал зохих цаг — цагийн хөлсний хуваагч. */
  standardHours: number;
  hourlyRate: number;
  advanceHours: number;
  advanceAmount: number;
  finalNet: number;
};

export type SalaryBillView = {
  id: string;
  documentNo: string;
  status: string;
  date: string;
  totalAmount: number;
  paidAmount: number;
};

export type PayrollRunView = {
  periodMonth: string;
  runId: string | null;
  status: string;
  voucher: { id: string; status: string } | null;
  /** Урьдчилгаа олгох огноо (хэрэглэгчийн сонгосон) — нэхэмжлэхтэй хамт. */
  advanceDate: string | null;
  bills: Record<SalaryBillKind, SalaryBillView | null>;
  lines: PayrollLineView[];
  settings: {
    minimumWage: number;
    siCapMultiplier: number;
    monthlyTaxFree: number;
    standardMonthlyHours: number;
    /** Ээлжийн амралт/ХЧТА-ийн өдрийн дундаж хөлсний хуваагч. */
    monthlyWorkDays: number;
    /** Дундаж цалин бодох өмнөх сарын тоо (ХЗ-ийн «дундаж цалин хөлс»). */
    averageEarningsMonths: number;
    coefficients: {
      overtime: number;
      restDay: number;
      holiday: number;
      nightBonus: number;
    };
    accounts: Record<string, string>;
  };
  activeEmployeeCount: number;
};

const BILL_COLUMNS = {
  id: true,
  documentNo: true,
  status: true,
  date: true,
  totalAmount: true,
  paidAmount: true,
} as const;

type BillRow = {
  id: string;
  documentNo: string;
  status: string;
  date: string;
  totalAmount: string;
  paidAmount: string;
};

const toSalaryBillView = (row: BillRow | null): SalaryBillView | null =>
  row
    ? {
        id: row.id,
        documentNo: row.documentNo,
        status: row.status,
        date: row.date,
        totalAmount: Number(row.totalAmount),
        paidAmount: Number(row.paidAmount),
      }
    : null;

export async function getPayrollRunData(
  periodMonth: string
): Promise<PayrollRunView> {
  const { orgId, userId } = await getActiveOrg();
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");

  const [settings, run, activeEmployees] = await Promise.all([
    loadPayrollSettings(orgId, userId),
    db.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.periodMonth, periodMonth)
      ),
      with: {
        voucher: { columns: { id: true, status: true } },
        advanceDocument: { columns: BILL_COLUMNS },
        finalDocument: { columns: BILL_COLUMNS },
        lines: {
          orderBy: [asc(payrollRunLines.sortOrder)],
          with: { employee: true },
        },
      },
    }),
    db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true))),
  ]);

  return {
    periodMonth,
    runId: run?.id ?? null,
    status: run?.status ?? "draft",
    voucher: run?.voucher ?? null,
    advanceDate: run?.advanceDate ?? null,
    bills: {
      advance: toSalaryBillView(run?.advanceDocument ?? null),
      final: toSalaryBillView(run?.finalDocument ?? null),
    },
    lines: (run?.lines ?? []).map((line) => {
      const netSalary = Number(line.netSalary);
      const advanceAmount = Number(line.advanceAmount);
      // Мөрийн стандарт цаг (бодолт хийхэд тохиргооноос бөглөгддөг) —
      // хуучин, бөглөгдөөгүй мөрүүдэд тохиргооны утга руу унана.
      const standardHours =
        Number(line.standardHours) || Number(settings.standardMonthlyHours);
      const baseSalary = Number(line.employee.baseSalary);
      return {
        id: line.id,
        employeeId: line.employeeId,
        employeeName: line.employee.name,
        position: line.employee.position,
        employerSiPercent: Number(line.employee.employerSiPercent),
        baseSalary,
        workedHours: Number(line.workedHours),
        baseEarnings:
          Math.round(
            (Number(line.earnings) -
              Number(line.vacationPay) -
              Number(line.overtimePay) -
              Number(line.otherAdditions)) *
              100
          ) / 100,
        vacationPay: Number(line.vacationPay),
        overtimePay: Number(line.overtimePay),
        otherAdditions: Number(line.otherAdditions),
        overtimeHours: Number(line.overtimeHours),
        restDayHours: Number(line.restDayHours),
        holidayHours: Number(line.holidayHours),
        nightHours: Number(line.nightHours),
        vacationDays: Number(line.vacationDays),
        sickDays: Number(line.sickDays),
        sickBenefit: Number(line.sickBenefit),
        vacationPayManual: line.vacationPayManual,
        overtimePayManual: line.overtimePayManual,
        sickBenefitManual: line.sickBenefitManual,
        averageMonthlyEarnings: Number(line.averageMonthlyEarnings),
        averageMonthsUsed: line.averageMonthsUsed,
        sickBenefitPercent:
          line.employee.sickBenefitPercent === null
            ? null
            : Number(line.employee.sickBenefitPercent),
        earnings: Number(line.earnings),
        otherDeductions: Number(line.otherDeductions),
        employeeSi: Number(line.employeeSi),
        employerSi: Number(line.employerSi),
        pit: Number(line.pit),
        netSalary,
        standardHours,
        hourlyRate:
          standardHours > 0
            ? Math.round((baseSalary / standardHours) * 100) / 100
            : 0,
        advanceHours: Number(line.advanceHours),
        advanceAmount,
        // Сүүл цалин = нийт гарт олгох − урьдчилгаа (хадгалагдсан дүнгээс
        // гаргана — calc.ts-тэй ижил томьёо, давхар хадгалалт үүсгэхгүй).
        finalNet: Math.round((netSalary - advanceAmount) * 100) / 100,
      };
    }),
    settings: {
      minimumWage: Number(settings.minimumWage),
      siCapMultiplier: settings.siCapMultiplier,
      monthlyTaxFree: Number(settings.monthlyTaxFree),
      standardMonthlyHours: Number(settings.standardMonthlyHours),
      monthlyWorkDays: Number(settings.monthlyWorkDays),
      averageEarningsMonths: settings.averageEarningsMonths,
      coefficients: {
        overtime: Number(settings.overtimeMultiplier),
        restDay: Number(settings.restDayMultiplier),
        holiday: Number(settings.holidayMultiplier),
        nightBonus: Number(settings.nightBonusRate),
      },
      accounts: {
        salaryExpense: settings.salaryExpenseAccountNumber,
        employerSiExpense: settings.employerSiExpenseAccountNumber,
        siPayable: settings.siPayableAccountNumber,
        pitPayable: settings.pitPayableAccountNumber,
        salaryPayable: settings.salaryPayableAccountNumber,
        deduction: settings.deductionAccountNumber,
      },
    },
    activeEmployeeCount: activeEmployees.length,
  };
}

type PayrollComputeSettings = {
  minimumWage: number;
  siCapMultiplier: number;
  monthlyTaxFree: number;
  standardMonthlyHours: number;
  /** Өдрийн дундаж хөлсний хуваагч (ээлжийн амралт, ХЧТА). */
  monthlyWorkDays: number;
  /** Дундаж цалинг хэдэн сараар бодох (ХЗ-ийн «дундаж цалин хөлс»). */
  averageEarningsMonths: number;
  coefficients: OvertimeCoefficients;
};

/** Мөрийн нэмэгдэл/олговрын ОРЦ ба гараар дарж бичсэн дүнгүүд. */
type LineAdditionsInput = {
  overtimeHours: number;
  restDayHours: number;
  holidayHours: number;
  nightHours: number;
  vacationDays: number;
  sickDays: number;
  /** Хадгалагдсан дүнгүүд — «гар» тэмдэгтэй бол ЭДГЭЭР нь хүчинтэй. */
  vacationPay: number;
  overtimePay: number;
  sickBenefit: number;
  vacationPayManual: boolean;
  overtimePayManual: boolean;
  sickBenefitManual: boolean;
  /** Ажилтны ХЧТА-ийн хувь — null бол автомат бодогдохгүй. */
  sickBenefitPercent: number | null;
  /** Ээлжийн амралт/ХЧТА-ийн суурь дундаж (өмнөх N сараас). */
  average: AverageEarnings;
};

/** Автомат бодогдсон (эсвэл гараар дарагдсан) олговруудын эцсийн дүн. */
type ResolvedAdditions = {
  vacationPay: number;
  overtimePay: number;
  sickBenefit: number;
  averageMonthly: number;
  averageMonthsUsed: number;
};

/**
 * Цаг/хоногоос олговруудыг бодно. «Гар» тэмдэгтэй дүнг ХЭЗЭЭ Ч дарж бичихгүй
 * — хэрэглэгчийн засвар давамгайлна (тэмдгийг арилгавал дахин автомат болно).
 */
function resolveAdditions(
  input: LineAdditionsInput & { hourlyRate: number },
  settings: PayrollComputeSettings
): ResolvedAdditions {
  const dailyWage = averageDailyWage(
    input.average.monthly,
    settings.monthlyWorkDays
  );
  const autoOvertime = computeOvertimePay({
    hourlyRate: input.hourlyRate,
    hours: {
      overtimeHours: input.overtimeHours,
      restDayHours: input.restDayHours,
      holidayHours: input.holidayHours,
      nightHours: input.nightHours,
    },
    coefficients: settings.coefficients,
  }).total;
  const autoVacation = computeVacationPay(dailyWage, input.vacationDays);
  // Хувь тохируулаагүй бол null — дүнг ЗОХИОХГҮЙ, хадгалагдсаныг нь үлдээнэ.
  const autoSick = computeSickBenefit(
    dailyWage,
    input.sickDays,
    input.sickBenefitPercent
  );
  return {
    vacationPay: input.vacationPayManual ? input.vacationPay : autoVacation,
    overtimePay: input.overtimePayManual ? input.overtimePay : autoOvertime,
    sickBenefit: input.sickBenefitManual
      ? input.sickBenefit
      : (autoSick ?? input.sickBenefit),
    averageMonthly: input.average.monthly,
    averageMonthsUsed: input.average.monthsUsed,
  };
}

type PayrollSettingsRow = Awaited<ReturnType<typeof loadPayrollSettings>>;

function computeSettingsOf(row: PayrollSettingsRow): PayrollComputeSettings {
  return {
    minimumWage: Number(row.minimumWage),
    siCapMultiplier: row.siCapMultiplier,
    monthlyTaxFree: Number(row.monthlyTaxFree),
    standardMonthlyHours: Number(row.standardMonthlyHours),
    monthlyWorkDays: Number(row.monthlyWorkDays),
    averageEarningsMonths: row.averageEarningsMonths,
    coefficients: {
      overtime: Number(row.overtimeMultiplier),
      restDay: Number(row.restDayMultiplier),
      holiday: Number(row.holidayMultiplier),
      nightBonus: Number(row.nightBonusRate),
    },
  };
}

/**
 * Ажилтан бүрийн өмнөх N сарын бодит олголт — дундаж цалингийн суурь.
 * Зөвхөн БОДОГДСОН сарууд орно (хоосон сар дундажийг бууруулахгүй).
 */
async function loadEarningsHistory(
  orgId: string,
  periodMonth: string,
  months: number
): Promise<Map<string, EarningsHistoryRow[]>> {
  const codes = previousPeriodCodes(periodMonth, months);
  const rows = await db
    .select({
      employeeId: payrollRunLines.employeeId,
      periodMonth: payrollRuns.periodMonth,
      earnings: payrollRunLines.earnings,
    })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRunLines.runId, payrollRuns.id))
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        inArray(payrollRuns.periodMonth, codes)
      )
    );
  const byEmployee = new Map<string, EarningsHistoryRow[]>();
  for (const row of rows) {
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push({ periodMonth: row.periodMonth, earnings: Number(row.earnings) });
    byEmployee.set(row.employeeId, list);
  }
  return byEmployee;
}

type PayrollLineRow = typeof payrollRunLines.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

/** Мөрийн хадгалагдсан орц + ажилтны хувь + дундаж → нэмэгдлийн орц. */
function lineAdditionsOf(
  existing: PayrollLineRow | undefined,
  person: EmployeeRow,
  periodMonth: string,
  history: EarningsHistoryRow[],
  settings: PayrollComputeSettings
): LineAdditionsInput {
  const average = averageMonthlyEarnings({
    periodMonth,
    history,
    months: settings.averageEarningsMonths,
    baseSalary: Number(person.baseSalary),
  });
  const num = (value: string | null | undefined) => (value ? Number(value) : 0);
  return {
    overtimeHours: num(existing?.overtimeHours),
    restDayHours: num(existing?.restDayHours),
    holidayHours: num(existing?.holidayHours),
    nightHours: num(existing?.nightHours),
    vacationDays: num(existing?.vacationDays),
    sickDays: num(existing?.sickDays),
    vacationPay: num(existing?.vacationPay),
    overtimePay: num(existing?.overtimePay),
    sickBenefit: num(existing?.sickBenefit),
    vacationPayManual: existing?.vacationPayManual ?? false,
    overtimePayManual: existing?.overtimePayManual ?? false,
    sickBenefitManual: existing?.sickBenefitManual ?? false,
    sickBenefitPercent:
      person.sickBenefitPercent === null || person.sickBenefitPercent === undefined
        ? null
        : Number(person.sickBenefitPercent),
    average,
  };
}

/** Нэмэгдлийн орц + бодогдсон дүн → DB-д бичих талбарууд. */
function additionsDerived(
  input: LineAdditionsInput,
  resolved: ResolvedAdditions
) {
  return {
    overtimeHours: String(input.overtimeHours),
    restDayHours: String(input.restDayHours),
    holidayHours: String(input.holidayHours),
    nightHours: String(input.nightHours),
    vacationDays: String(input.vacationDays),
    sickDays: String(input.sickDays),
    vacationPay: String(resolved.vacationPay),
    overtimePay: String(resolved.overtimePay),
    sickBenefit: String(resolved.sickBenefit),
    vacationPayManual: input.vacationPayManual,
    overtimePayManual: input.overtimePayManual,
    sickBenefitManual: input.sickBenefitManual,
    averageMonthlyEarnings: String(resolved.averageMonthly),
    averageMonthsUsed: resolved.averageMonthsUsed,
  };
}

function computeFor(
  input: {
    otherDeductions: number;
    employerSiPercent: number;
    advanceHours: number;
    /** Мөрийн ажиллавал зохих цаг; 0 бол тохиргооны стандарт цаг. */
    standardHours: number;
    workedHours: number;
    otherAdditions: number;
    baseSalary: number;
  } & LineAdditionsInput,
  periodMonth: string,
  settings: PayrollComputeSettings
): PayrollResult & { baseEarnings: number; additions: ResolvedAdditions } {
  const { endDate } = periodRange(periodMonth);
  const standardHours =
    input.standardHours || settings.standardMonthlyHours;
  const additions = resolveAdditions(
    { ...input, hourlyRate: input.baseSalary / standardHours },
    settings
  );
  // Нийт олголт нь ЦАГААС бодогдоно: үндсэн олголт + ээлжийн амралт +
  // илүү цагийн нэмэгдэл + бусад нэмэгдэл. НДШ, ХАОАТ энэ дүн дээр
  // тооцоологдоно (ХЧТА тэтгэмж нь ОРОХГҮЙ — татвар, шимтгэлгүй).
  const earned = computeEarnings({
    baseSalary: input.baseSalary,
    standardHours,
    workedHours: input.workedHours,
    vacationPay: additions.vacationPay,
    overtimePay: additions.overtimePay,
    otherAdditions: input.otherAdditions,
  });
  const result = computeEmployeePayroll({
    earnings: earned.earnings,
    otherDeductions: input.otherDeductions,
    sickBenefit: additions.sickBenefit,
    employerSiPercent: input.employerSiPercent,
    date: endDate,
    minimumWage: settings.minimumWage,
    siCapMultiplier: settings.siCapMultiplier,
    monthlyTaxFree: settings.monthlyTaxFree,
    advanceHours: input.advanceHours,
    standardMonthlyHours: standardHours,
    // Урьдчилгаа нь ҮНДСЭН цалингаас цагаар бодогдоно — ээлжийн амралт,
    // бусад нэмэгдлийг урьдчилгаанд оруулахгүй (сүүл цалинд бүтнээр орно).
    advanceBaseSalary: input.baseSalary,
  });
  return { ...result, baseEarnings: earned.baseEarnings, additions };
}

/**
 * Сарын бодолт: run үүсгэж/шинэчилж идэвхтэй ажилтан бүрд мөр бэлдэнэ.
 * Байгаа мөрийн earnings/otherDeductions-ийг ХАДГАЛЖ (хэрэглэгчийн засвар),
 * зөвхөн тооцооллын багануудыг дахин бодно; шинэ ажилтанд baseSalary-аар
 * мөр нэмнэ. GL журнал үүссэн run-д дахин бодолт хийхгүй.
 */
export async function calculatePayrollRun(periodMonth: string) {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");
  const { endDate } = periodRange(periodMonth);
  await assertPeriodOpen(orgId, endDate);

  const [settingsRow, staff] = await Promise.all([
    loadPayrollSettings(orgId, userId),
    db.query.employees.findMany({
      where: and(eq(employees.organizationId, orgId), eq(employees.isActive, true)),
      orderBy: [asc(employees.name)],
    }),
  ]);
  if (staff.length === 0)
    throw new Error("Идэвхтэй ажилтан алга — эхлээд Ажилтнууд хэсэгт бүртгэнэ үү");
  const settings = computeSettingsOf(settingsRow);
  // Ээлжийн амралт, ХЧТА-ийн суурь — өмнөх N сарын БОДИТ олголт (ХЗ-ийн
  // «дундаж цалин хөлс»). Түүхгүй ажилтанд үндсэн цалин суурь болно
  // (averageMonthlyEarnings нь basis-ыг ИЛ буцаана).
  const history = await loadEarningsHistory(
    orgId,
    periodMonth,
    settings.averageEarningsMonths
  );

  await db.transaction(async (tx) => {
    let run = await tx.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.periodMonth, periodMonth)
      ),
      with: { lines: true },
    });
    if (run?.voucherId)
      throw new Error(
        "GL журнал аль хэдийн үүссэн — эхлээд журналыг устгаж байж дахин бодно"
      );
    if (!run) {
      const [created] = await tx
        .insert(payrollRuns)
        .values({ userId, organizationId: orgId, periodMonth })
        .returning();
      run = { ...created, lines: [] };
    }

    const byEmployee = new Map(run.lines.map((line) => [line.employeeId, line]));
    let sortOrder = 0;
    for (const person of staff) {
      const existing = byEmployee.get(person.id);
      const otherDeductions = existing ? Number(existing.otherDeductions) : 0;
      // Хэрэглэгчийн оруулсан цаг, олголтууд дахин бодолтод ХАДГАЛАГДАНА;
      // бөглөгдөөгүй бол ажиллавал зохих цагийг тохиргооны стандартаар,
      // ажилласан цагийг түүгээр нь бөглөнө (бүтэн сар ажилласан = үндсэн
      // цалин яг таарна) — «Бодолт хийх» дарахад бүх багана шууд бодогдоно.
      const advanceHours = existing ? Number(existing.advanceHours) : 0;
      const standardHours =
        (existing ? Number(existing.standardHours) : 0) ||
        settings.standardMonthlyHours;
      const workedHours =
        (existing ? Number(existing.workedHours) : 0) || standardHours;
      const additionsInput = lineAdditionsOf(
        existing,
        person,
        periodMonth,
        history.get(person.id) ?? [],
        settings
      );
      const result = computeFor(
        {
          otherDeductions,
          employerSiPercent: Number(person.employerSiPercent),
          advanceHours,
          standardHours,
          workedHours,
          otherAdditions: existing ? Number(existing.otherAdditions) : 0,
          baseSalary: Number(person.baseSalary),
          ...additionsInput,
        },
        periodMonth,
        settings
      );
      const derived = {
        earnings: String(result.earnings),
        otherDeductions: String(result.otherDeductions),
        standardHours: String(standardHours),
        workedHours: String(workedHours),
        otherAdditions: String(existing ? Number(existing.otherAdditions) : 0),
        advanceHours: String(result.advanceHours),
        advanceAmount: String(result.advanceAmount),
        employeeSi: String(result.employeeSi),
        employerSi: String(result.employerSi),
        pit: String(result.pit),
        netSalary: String(result.netSalary),
        sortOrder: sortOrder++,
        ...additionsDerived(additionsInput, result.additions),
      };
      if (existing)
        await tx
          .update(payrollRunLines)
          .set(derived)
          .where(eq(payrollRunLines.id, existing.id));
      else
        await tx.insert(payrollRunLines).values({
          runId: run.id,
          employeeId: person.id,
          ...derived,
        });
    }
    await tx
      .update(payrollRuns)
      .set({ updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id));
  });

  revalidatePayroll();
}

/** Мөрийн олголт/суутгал/урьдчилгааны цагийг засаад тооцооллыг дахин бодно. */
export async function updatePayrollLine(data: {
  lineId: string;
  otherDeductions: number;
  advanceHours?: number;
  standardHours?: number;
  workedHours?: number;
  otherAdditions?: number;
  // Нэмэгдлийн ОРЦ — өөрчлөгдвөл харгалзах дүн ДАХИН автомат бодогдоно
  // (гар тэмдэг арилна).
  overtimeHours?: number;
  restDayHours?: number;
  holidayHours?: number;
  nightHours?: number;
  vacationDays?: number;
  sickDays?: number;
  /** Дүнг ГАРААР дарж бичих — «гар» тэмдэг асна (дахин бодолт дарахгүй). */
  vacationPay?: number;
  overtimePay?: number;
  sickBenefit?: number;
  /** Тэмдгийг арилгаж дахин АВТОМАТ болгох (дүн дахин бодогдоно). */
  clearVacationPayManual?: boolean;
  clearOvertimePayManual?: boolean;
  clearSickBenefitManual?: boolean;
}) {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  const line = await db.query.payrollRunLines.findFirst({
    where: eq(payrollRunLines.id, data.lineId),
    with: { run: true, employee: true },
  });
  if (!line || line.run.organizationId !== orgId) throw new Error("Мөр олдсонгүй");
  if (line.run.voucherId)
    throw new Error("GL журнал үүссэн тул мөр засварлахгүй");

  const settingsRow = await loadPayrollSettings(orgId, userId);
  const standardHours =
    Number(data.standardHours ?? line.standardHours) ||
    Number(settingsRow.standardMonthlyHours);
  const workedHours = Number(data.workedHours ?? line.workedHours) || standardHours;
  const otherAdditions = Number(data.otherAdditions ?? line.otherAdditions);
  const settings = computeSettingsOf(settingsRow);
  const history = await loadEarningsHistory(
    orgId,
    line.run.periodMonth,
    settings.averageEarningsMonths
  );
  const stored = lineAdditionsOf(
    line,
    line.employee,
    line.run.periodMonth,
    history.get(line.employeeId) ?? [],
    settings
  );
  // Цаг/хоногийн ОРЦ өөрчлөгдвөл харгалзах дүн дахин АВТОМАТ болно — эс тэгвээс
  // нэг удаа гараар дарж бичсэн дүн шинэ цагийг үл тоон үүрд гацна.
  const overtimeInputChanged =
    data.overtimeHours !== undefined ||
    data.restDayHours !== undefined ||
    data.holidayHours !== undefined ||
    data.nightHours !== undefined;
  const clearOvertimeManual =
    data.clearOvertimePayManual || (overtimeInputChanged && data.overtimePay === undefined);
  const clearVacationManual =
    data.clearVacationPayManual ||
    (data.vacationDays !== undefined && data.vacationPay === undefined);
  const clearSickManual =
    data.clearSickBenefitManual ||
    (data.sickDays !== undefined && data.sickBenefit === undefined);
  // Дүнг гараар өгвөл «гар» тэмдэг асна; тэмдгийг ил арилгавал дахин автомат.
  const additionsInput: LineAdditionsInput = {
    ...stored,
    overtimeHours: data.overtimeHours ?? stored.overtimeHours,
    restDayHours: data.restDayHours ?? stored.restDayHours,
    holidayHours: data.holidayHours ?? stored.holidayHours,
    nightHours: data.nightHours ?? stored.nightHours,
    vacationDays: data.vacationDays ?? stored.vacationDays,
    sickDays: data.sickDays ?? stored.sickDays,
    vacationPay: data.vacationPay ?? stored.vacationPay,
    overtimePay: data.overtimePay ?? stored.overtimePay,
    sickBenefit: data.sickBenefit ?? stored.sickBenefit,
    vacationPayManual: clearVacationManual
      ? false
      : data.vacationPay !== undefined || stored.vacationPayManual,
    overtimePayManual: clearOvertimeManual
      ? false
      : data.overtimePay !== undefined || stored.overtimePayManual,
    sickBenefitManual: clearSickManual
      ? false
      : data.sickBenefit !== undefined || stored.sickBenefitManual,
  };
  const result = computeFor(
    {
      otherDeductions: Number(data.otherDeductions),
      employerSiPercent: Number(line.employee.employerSiPercent),
      advanceHours: Number(data.advanceHours ?? line.advanceHours),
      standardHours,
      workedHours,
      otherAdditions,
      baseSalary: Number(line.employee.baseSalary),
      ...additionsInput,
    },
    line.run.periodMonth,
    settings
  );
  await db
    .update(payrollRunLines)
    .set({
      earnings: String(result.earnings),
      otherDeductions: String(result.otherDeductions),
      standardHours: String(standardHours),
      workedHours: String(workedHours),
      otherAdditions: String(otherAdditions),
      advanceHours: String(result.advanceHours),
      advanceAmount: String(result.advanceAmount),
      employeeSi: String(result.employeeSi),
      employerSi: String(result.employerSi),
      pit: String(result.pit),
      netSalary: String(result.netSalary),
      ...additionsDerived(additionsInput, result.additions),
    })
    .where(eq(payrollRunLines.id, data.lineId));
  revalidatePayroll();
}

// ── GL ноорог журнал ────────────────────────────────────────────────────────

/** Идэвхтэй сегментүүдээр бүтэн posting код угсрагч (S9 default "GL"). */
async function payrollPostingCodeBuilder(orgId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
    }),
  ]);
  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (definition) =>
      definition.id === 3 || configMap.get(definition.id)?.isEnabled === true
  ).map((definition) => definition.id);
  const defaults: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    if (!canAutoDefaultSegment(segmentId)) continue;
    const options = values.filter((value) => value.segmentId === segmentId);
    if (options.length === 1) defaults[segmentId] = options[0].code;
  }
  return (mainAccount: string) =>
    buildSegCode({ ...defaults, 3: mainAccount }, activeSegIds, defaults);
}

/**
 * Цалингийн GL НООРОГ журнал (CLAUDE.md §7-ийн схем) — сарын эцсийн
 * огноогоор, externalRef `payroll:YYYY-MM`-ээр сард нэг л удаа.
 */
export async function createPayrollVoucher(
  periodMonth: string
): Promise<{ id: string; dedup?: boolean }> {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");

  const existing = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.organizationId, orgId),
      eq(journalVouchers.externalRef, voucherRefOf(periodMonth))
    ),
    columns: { id: true },
  });
  if (existing) return { id: existing.id, dedup: true };

  const run = await db.query.payrollRuns.findFirst({
    where: and(
      eq(payrollRuns.organizationId, orgId),
      eq(payrollRuns.periodMonth, periodMonth)
    ),
    with: { lines: true },
  });
  if (!run || run.lines.length === 0)
    throw new Error("Эхлээд сарын бодолт хийнэ үү (мөр алга)");

  const totals = run.lines.reduce(
    (sum, line) => ({
      earnings: sum.earnings + Number(line.earnings),
      employeeSi: sum.employeeSi + Number(line.employeeSi),
      employerSi: sum.employerSi + Number(line.employerSi),
      pit: sum.pit + Number(line.pit),
      otherDeductions: sum.otherDeductions + Number(line.otherDeductions),
      sickBenefit: sum.sickBenefit + Number(line.sickBenefit),
      netSalary: sum.netSalary + Number(line.netSalary),
    }),
    {
      earnings: 0,
      employeeSi: 0,
      employerSi: 0,
      pit: 0,
      otherDeductions: 0,
      sickBenefit: 0,
      netSalary: 0,
    }
  );
  if (!(totals.earnings > 0)) throw new Error("Нийт олголт 0 байна");

  const settings = await loadPayrollSettings(orgId, userId);
  const accounts = {
    salaryExpense: settings.salaryExpenseAccountNumber,
    employerSiExpense: settings.employerSiExpenseAccountNumber,
    siPayable: settings.siPayableAccountNumber,
    pitPayable: settings.pitPayableAccountNumber,
    salaryPayable: settings.salaryPayableAccountNumber,
    deduction: settings.deductionAccountNumber,
    // ХЧТА тэтгэмжийн зардал — тохируулаагүй бол цалингийн зардлын данс
    // (тохиргооны ил сонголт; нягтлан дараа нь ангилж болно).
    sickBenefitExpense:
      settings.sickBenefitAccountNumber || settings.salaryExpenseAccountNumber,
  };
  // Тохиргооны данс идэвхтэй эсэхийг эрт, ойлгомжтой шалгана (createVoucher
  // мөн ДАХИН шалгана).
  for (const main of Object.values(accounts)) {
    const account = await db.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.number, main),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { id: true },
    });
    if (!account)
      throw new Error(
        `${main} данс идэвхтэй жагсаалтад алга — Тохиргоо → Ерөнхий журналын тохиргоо хэсгээс нэмнэ үү`
      );
  }

  const code = await payrollPostingCodeBuilder(orgId);
  const lines = buildPayrollJournalLines(totals, accounts, periodMonth).map(
    (line) => ({
      account: code(line.account),
      debit: line.debit,
      credit: line.credit,
      description: line.description,
    })
  );

  const { endDate } = periodRange(periodMonth);
  const { id } = unwrapAction(await createVoucher({
    date: endDate,
    description: `Цалингийн бичилт ${periodMonth} (${run.lines.length} ажилтан)`,
    lines,
    status: "draft",
    externalRef: voucherRefOf(periodMonth),
    module: "payroll",
  }));

  await db
    .update(payrollRuns)
    .set({ voucherId: id, status: "voucher_created", updatedAt: new Date() })
    .where(eq(payrollRuns.id, run.id));

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "create_voucher",
    entityType: "payroll",
    entityId: id,
    summary: `Цалингийн журнал үүсэв — ${periodMonth}, ${run.lines.length} ажилтан, нийт олголт ${totals.earnings.toLocaleString("en-US")}₮`,
  });

  revalidatePayroll();
  return { id };
}

// ── Цалингийн нэхэмжлэх (урьдчилгаа / сүүл) → АР/АП өглөг ──────────────────
//
// КЛИРИНГИЙН ЗАГВАР (PO-гийн түр дансны хэв маягтай ижил):
//   §7-ийн нэгдсэн журнал:   … Cr Цалингийн өглөг (сарын НИЙТ гарт олгох)
//   Нэхэмжлэх батлагдахад:   Dr Цалингийн өглөг / Cr Ажилтны өглөг (АП хяналт)
//   Кассаас төлөхөд:         Dr Ажилтны өглөг / Cr Банк
// Ингэснээр зардал НЭГ л удаа бичигдэж, Цалингийн өглөг тэгширч, ажилтанд
// өгөх өглөг нь АР/АП-ийн дэд дэвтэрт хөтлөгдөнө (кассаас хаагдана).
//
// Нэхэмжлэх нь НООРОГ болж үүснэ (§9 human-in-the-loop) — нягтланч АР/АП
// модулиас батална, тэр үед л GL журнал бичигдэнэ.

/** Нэгтгэсэн "Ажилчид" харилцагчийг олж, байхгүй бол үүсгэнэ. */
async function ensureEmployeeCounterparty(
  orgId: string,
  userId: string,
  settingsId: string,
  currentId: string | null
): Promise<string> {
  if (currentId) {
    const existing = await db.query.counterparties.findFirst({
      where: and(
        eq(counterparties.id, currentId),
        eq(counterparties.organizationId, orgId),
        eq(counterparties.isActive, true)
      ),
      columns: { id: true },
    });
    if (existing) return existing.id;
  }

  const NAME = "Ажилчид";
  const byName = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.organizationId, orgId),
      eq(counterparties.name, NAME)
    ),
    columns: { id: true, isActive: true },
  });
  let id = byName?.id ?? null;
  if (byName && !byName.isActive)
    await db
      .update(counterparties)
      .set({ isActive: true })
      .where(eq(counterparties.id, byName.id));
  if (!id) {
    const [created] = await db
      .insert(counterparties)
      .values({
        userId,
        organizationId: orgId,
        name: NAME,
        counterpartyType: "supplier",
      })
      .returning({ id: counterparties.id });
    id = created.id;
  }
  await db
    .update(payrollSettings)
    .set({ employeeCounterpartyId: id, updatedAt: new Date() })
    .where(eq(payrollSettings.id, settingsId));
  return id;
}

/**
 * Урьдчилгаа / сүүл цалингийн НЭГТГЭСЭН өглөгийн нэхэмжлэх (ноорог).
 * Сард төрөл тус бүрд нэг л удаа — давтан дуудахад байгааг нь буцаана.
 */
export async function createPayrollSalaryBill(
  periodMonth: string,
  kind: SalaryBillKind,
  /** Урьдчилгаанд ЗААВАЛ (сар дундуур олгоно); сүүлд өгөөгүй бол сарын эцэс. */
  date?: string
): Promise<{ id: string; documentNo: string; dedup?: boolean }> {
  const { orgId, userId } = await requireModuleAction("payroll", "write");
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");
  if (kind !== "advance" && kind !== "final")
    throw new Error("Цалингийн нэхэмжлэхийн төрөл буруу байна");

  const { endDate, startDate } = periodRange(periodMonth);
  const billDate = (date ?? (kind === "final" ? endDate : "")).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate))
    throw new Error("Олгох огноо (YYYY-MM-DD) оруулна уу");
  if (billDate < startDate || billDate > endDate)
    throw new Error(`Олгох огноо ${periodMonth} сард багтах ёстой`);

  const externalRef = salaryBillRefOf(kind, periodMonth);
  const existing = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.organizationId, orgId),
      eq(arApDocuments.externalRef, externalRef)
    ),
    columns: { id: true, documentNo: true },
  });
  if (existing) return { ...existing, dedup: true };

  const run = await db.query.payrollRuns.findFirst({
    where: and(
      eq(payrollRuns.organizationId, orgId),
      eq(payrollRuns.periodMonth, periodMonth)
    ),
    with: { lines: true },
  });
  if (!run || run.lines.length === 0)
    throw new Error("Эхлээд сарын бодолт хийнэ үү (мөр алга)");

  // Урьдчилгаа = Σ урьдчилгааны дүн; сүүл = Σ (гарт олгох − урьдчилгаа).
  const total = run.lines.reduce((sum, line) => {
    const advance = Number(line.advanceAmount);
    return (
      sum +
      (kind === "advance" ? advance : Number(line.netSalary) - advance)
    );
  }, 0);
  const amount = Math.round(total * 100) / 100;
  if (!(amount > 0))
    throw new Error(
      kind === "advance"
        ? "Урьдчилгааны дүн 0 байна — эхлээд ажилласан цагийг оруулна уу"
        : "Сүүл цалингийн дүн 0 байна"
    );

  const settings = await loadPayrollSettings(orgId, userId);
  // Клирингийн хоёр данс ЗӨРӨХ ёстой — эс бөгөөс бичилт өөрийгөө тэгшитгэнэ.
  if (
    settings.salaryPayableAccountNumber ===
    settings.employeePayableAccountNumber
  )
    throw new Error(
      "Цалингийн өглөг ба Ажилтны өглөгийн данс ижил байна — тохиргоог засна уу"
    );
  for (const main of [
    settings.salaryPayableAccountNumber,
    settings.employeePayableAccountNumber,
  ]) {
    const account = await db.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.number, main),
        eq(chartOfAccounts.isEnabled, true)
      ),
      columns: { id: true },
    });
    if (!account)
      throw new Error(
        `${main} данс идэвхтэй жагсаалтад алга — Тохиргоо → Ерөнхий журналын тохиргоо хэсгээс нэмнэ үү`
      );
  }

  const counterpartyId = await ensureEmployeeCounterparty(
    orgId,
    userId,
    settings.id,
    settings.employeeCounterpartyId
  );

  const label = SALARY_BILL_LABEL[kind];
  const created = unwrapAction(
    await createArApDocument({
      documentType: "ap_bill",
      counterpartyId,
      date: billDate,
      dueDate: billDate,
      controlAccountNumber: settings.employeePayableAccountNumber,
      description: `${label} ${periodMonth} (${run.lines.length} ажилтан)`,
      lines: [
        {
          account: settings.salaryPayableAccountNumber,
          description: `${label} ${periodMonth}`,
          amount,
        },
      ],
      externalRef,
    })
  );

  await db
    .update(payrollRuns)
    .set({
      ...(kind === "advance"
        ? { advanceDocumentId: created.id, advanceDate: billDate }
        : { finalDocumentId: created.id }),
      updatedAt: new Date(),
    })
    .where(eq(payrollRuns.id, run.id));

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "create",
    entityType: "payroll",
    entityId: created.id,
    summary: `${label} нэхэмжлэх үүсэв — ${periodMonth}, ${run.lines.length} ажилтан, ${amount.toLocaleString("en-US")}₮`,
  });

  revalidatePayroll();
  return created;
}

// ── Цалин олгох тайлан (банкны жагсаалт) ───────────────────────────────────

export type SalaryPaymentRow = {
  employeeId: string;
  employeeName: string;
  registerNo: string;
  position: string;
  bankName: string;
  bankAccountNo: string;
  iban: string;
  /** Сонгосон төрлөөр олгох дүн (урьдчилгаа эсвэл сүүл цалин). */
  amount: number;
};

export type SalaryPaymentReport = {
  periodMonth: string;
  kind: SalaryBillKind;
  /** Урьдчилгаа бол хэрэглэгчийн сонгосон олгох огноо. */
  payDate: string | null;
  bill: SalaryBillView | null;
  rows: SalaryPaymentRow[];
  total: number;
  /** Банкны мэдээлэл дутуу ажилтны тоо — шилжүүлэг хийхэд саад болно. */
  missingBankCount: number;
};

/**
 * Сонгосон сар + төрлөөр ажилтан тус бүрийн ОЛГОХ дүнг банкны мэдээлэлтэй
 * хамт гаргана — банкны багц шилжүүлгийн жагсаалт. Дүн нь мөрөнд
 * хадгалагдсан тооцооноос (advanceAmount / netSalary − advanceAmount) гарна
 * тул нэхэмжлэхийн нийт дүнтэй үргэлж тэнцэнэ.
 */
export async function getSalaryPaymentReport(
  periodMonth: string,
  kind: SalaryBillKind
): Promise<SalaryPaymentReport> {
  const { orgId } = await getActiveOrg();
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");

  const run = await db.query.payrollRuns.findFirst({
    where: and(
      eq(payrollRuns.organizationId, orgId),
      eq(payrollRuns.periodMonth, periodMonth)
    ),
    with: {
      advanceDocument: { columns: BILL_COLUMNS },
      finalDocument: { columns: BILL_COLUMNS },
      lines: {
        orderBy: [asc(payrollRunLines.sortOrder)],
        with: { employee: true },
      },
    },
  });

  const rows: SalaryPaymentRow[] = [];
  let missingBankCount = 0;
  for (const line of run?.lines ?? []) {
    const advance = Number(line.advanceAmount);
    const amount =
      kind === "advance" ? advance : Number(line.netSalary) - advance;
    if (Math.abs(amount) <= 0.005) continue;
    const bankAccountNo = line.employee.bankAccountNo ?? "";
    const iban = line.employee.iban ?? "";
    if (!bankAccountNo && !iban) missingBankCount += 1;
    rows.push({
      employeeId: line.employeeId,
      employeeName: [line.employee.lastName, line.employee.name]
        .filter(Boolean)
        .join(" "),
      registerNo: line.employee.registerNo ?? "",
      position: line.employee.position,
      bankName: line.employee.bankName ?? "",
      bankAccountNo,
      iban,
      amount: Math.round(amount * 100) / 100,
    });
  }

  return {
    periodMonth,
    kind,
    payDate:
      kind === "advance"
        ? (run?.advanceDate ?? null)
        : (run?.finalDocument?.date ?? periodRange(periodMonth).endDate),
    bill: toSalaryBillView(
      (kind === "advance" ? run?.advanceDocument : run?.finalDocument) ?? null
    ),
    rows,
    total: Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100,
    missingBankCount,
  };
}
