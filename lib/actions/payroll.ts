"use server";

// Цалингийн модулийн server actions.
//
// Урсгал (human-in-the-loop §9):
//   Ажилтан бүртгэх → Сарын бодолт (calculatePayrollRun) → мөр засварлах
//   → GL НООРОГ журнал үүсгэх (createPayrollVoucher) → нягтланч GL-ээс батална.
// Payroll post нь ЗААВАЛ нягтланчийн баталгаажуулалт шаарддаг тул энэ модуль
// хэзээ ч шууд posted журнал бичихгүй.

import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";

import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  chartOfAccounts,
  employees,
  journalVouchers,
  payrollRunLines,
  payrollRuns,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { createVoucher } from "@/lib/actions/gl";
import { unwrapAction } from "@/lib/action-result";
import { assertPeriodOpen } from "@/lib/periods/guard";
import { isPeriodCode, periodRange } from "@/lib/periods/period";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import {
  buildPayrollJournalLines,
  computeEmployeePayroll,
  type PayrollResult,
} from "@/lib/payroll/calc";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { buildSegCode } from "@/lib/grid/segments";
import { logAuditEvent } from "@/lib/audit";

function revalidatePayroll() {
  revalidatePath("/payroll");
  revalidatePath("/payroll/employees");
  revalidatePath("/gl/journal");
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
  earnings: number;
  otherDeductions: number;
  employeeSi: number;
  employerSi: number;
  pit: number;
  netSalary: number;
};

export type PayrollRunView = {
  periodMonth: string;
  runId: string | null;
  status: string;
  voucher: { id: string; status: string } | null;
  lines: PayrollLineView[];
  settings: {
    minimumWage: number;
    siCapMultiplier: number;
    monthlyTaxFree: number;
    accounts: Record<string, string>;
  };
  activeEmployeeCount: number;
};

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
    lines: (run?.lines ?? []).map((line) => ({
      id: line.id,
      employeeId: line.employeeId,
      employeeName: line.employee.name,
      position: line.employee.position,
      employerSiPercent: Number(line.employee.employerSiPercent),
      earnings: Number(line.earnings),
      otherDeductions: Number(line.otherDeductions),
      employeeSi: Number(line.employeeSi),
      employerSi: Number(line.employerSi),
      pit: Number(line.pit),
      netSalary: Number(line.netSalary),
    })),
    settings: {
      minimumWage: Number(settings.minimumWage),
      siCapMultiplier: settings.siCapMultiplier,
      monthlyTaxFree: Number(settings.monthlyTaxFree),
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

function computeFor(
  earnings: number,
  otherDeductions: number,
  employerSiPercent: number,
  periodMonth: string,
  settings: { minimumWage: number; siCapMultiplier: number; monthlyTaxFree: number }
): PayrollResult {
  const { endDate } = periodRange(periodMonth);
  return computeEmployeePayroll({
    earnings,
    otherDeductions,
    employerSiPercent,
    date: endDate,
    minimumWage: settings.minimumWage,
    siCapMultiplier: settings.siCapMultiplier,
    monthlyTaxFree: settings.monthlyTaxFree,
  });
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
  const settings = {
    minimumWage: Number(settingsRow.minimumWage),
    siCapMultiplier: settingsRow.siCapMultiplier,
    monthlyTaxFree: Number(settingsRow.monthlyTaxFree),
  };

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
      const earnings = existing ? Number(existing.earnings) : Number(person.baseSalary);
      const otherDeductions = existing ? Number(existing.otherDeductions) : 0;
      const result = computeFor(
        earnings,
        otherDeductions,
        Number(person.employerSiPercent),
        periodMonth,
        settings
      );
      const derived = {
        earnings: String(result.earnings),
        otherDeductions: String(result.otherDeductions),
        employeeSi: String(result.employeeSi),
        employerSi: String(result.employerSi),
        pit: String(result.pit),
        netSalary: String(result.netSalary),
        sortOrder: sortOrder++,
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

/** Мөрийн олголт/суутгалыг засаад тооцооллыг дахин бодно. */
export async function updatePayrollLine(data: {
  lineId: string;
  earnings: number;
  otherDeductions: number;
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
  const result = computeFor(
    Number(data.earnings),
    Number(data.otherDeductions),
    Number(line.employee.employerSiPercent),
    line.run.periodMonth,
    {
      minimumWage: Number(settingsRow.minimumWage),
      siCapMultiplier: settingsRow.siCapMultiplier,
      monthlyTaxFree: Number(settingsRow.monthlyTaxFree),
    }
  );
  await db
    .update(payrollRunLines)
    .set({
      earnings: String(result.earnings),
      otherDeductions: String(result.otherDeductions),
      employeeSi: String(result.employeeSi),
      employerSi: String(result.employerSi),
      pit: String(result.pit),
      netSalary: String(result.netSalary),
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
      netSalary: sum.netSalary + Number(line.netSalary),
    }),
    { earnings: 0, employeeSi: 0, employerSi: 0, pit: 0, otherDeductions: 0, netSalary: 0 }
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
