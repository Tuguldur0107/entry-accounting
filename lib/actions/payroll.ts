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

import { auth } from "@/lib/auth";
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

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  return session.user.id;
}

function revalidatePayroll() {
  revalidatePath("/payroll");
  revalidatePath("/payroll/employees");
  revalidatePath("/gl/journal");
}

const voucherRefOf = (periodMonth: string) => `payroll:${periodMonth}`;

// ── Ажилтан ─────────────────────────────────────────────────────────────────

export async function upsertEmployee(data: {
  id?: string;
  name: string;
  position?: string;
  baseSalary: number;
  accidentRatePercent: number;
  isActive?: boolean;
}) {
  const userId = await requireUser();
  const name = data.name.trim();
  if (!name) throw new Error("Ажилтны нэр оруулна уу");
  const baseSalary = Number(data.baseSalary);
  if (!(baseSalary >= 0) || !Number.isFinite(baseSalary))
    throw new Error("Үндсэн цалин 0-ээс багагүй байна");
  const accidentRatePercent = Number(data.accidentRatePercent);
  if (!(accidentRatePercent >= 0) || accidentRatePercent > 5)
    throw new Error("ҮОМШӨ хувь 0–5%-ийн хооронд байна");

  const values = {
    name,
    position: data.position?.trim() ?? "",
    baseSalary: String(baseSalary),
    accidentRatePercent: String(accidentRatePercent),
    isActive: data.isActive ?? true,
  };

  if (data.id) {
    const [updated] = await db
      .update(employees)
      .set(values)
      .where(and(eq(employees.id, data.id), eq(employees.userId, userId)))
      .returning({ id: employees.id });
    if (!updated) throw new Error("Ажилтан олдсонгүй");
  } else {
    const duplicate = await db.query.employees.findFirst({
      where: and(eq(employees.userId, userId), eq(employees.name, name)),
      columns: { id: true },
    });
    if (duplicate) throw new Error(`"${name}" нэртэй ажилтан бүртгэлтэй байна`);
    await db.insert(employees).values({ userId, ...values });
  }
  revalidatePayroll();
}

export async function toggleEmployee(id: string, isActive: boolean) {
  const userId = await requireUser();
  await db
    .update(employees)
    .set({ isActive })
    .where(and(eq(employees.id, id), eq(employees.userId, userId)));
  revalidatePayroll();
}

// ── Сарын бодолт ────────────────────────────────────────────────────────────

export type PayrollLineView = {
  id: string;
  employeeId: string;
  employeeName: string;
  position: string;
  accidentRatePercent: number;
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
  const userId = await requireUser();
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");

  const [settings, run, activeEmployees] = await Promise.all([
    loadPayrollSettings(userId),
    db.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.userId, userId),
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
      .where(and(eq(employees.userId, userId), eq(employees.isActive, true))),
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
      accidentRatePercent: Number(line.employee.accidentRatePercent),
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
  accidentRatePercent: number,
  periodMonth: string,
  settings: { minimumWage: number; siCapMultiplier: number; monthlyTaxFree: number }
): PayrollResult {
  const { endDate } = periodRange(periodMonth);
  return computeEmployeePayroll({
    earnings,
    otherDeductions,
    accidentRatePercent,
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
  const userId = await requireUser();
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");
  const { endDate } = periodRange(periodMonth);
  await assertPeriodOpen(userId, endDate);

  const [settingsRow, staff] = await Promise.all([
    loadPayrollSettings(userId),
    db.query.employees.findMany({
      where: and(eq(employees.userId, userId), eq(employees.isActive, true)),
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
        eq(payrollRuns.userId, userId),
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
        .values({ userId, periodMonth })
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
        Number(person.accidentRatePercent),
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
  const userId = await requireUser();
  const line = await db.query.payrollRunLines.findFirst({
    where: eq(payrollRunLines.id, data.lineId),
    with: { run: true, employee: true },
  });
  if (!line || line.run.userId !== userId) throw new Error("Мөр олдсонгүй");
  if (line.run.voucherId)
    throw new Error("GL журнал үүссэн тул мөр засварлахгүй");

  const settingsRow = await loadPayrollSettings(userId);
  const result = computeFor(
    Number(data.earnings),
    Number(data.otherDeductions),
    Number(line.employee.accidentRatePercent),
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
async function payrollPostingCodeBuilder(userId: string) {
  const [configs, values] = await Promise.all([
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
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
  const userId = await requireUser();
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");

  const existing = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.userId, userId),
      eq(journalVouchers.externalRef, voucherRefOf(periodMonth))
    ),
    columns: { id: true },
  });
  if (existing) return { id: existing.id, dedup: true };

  const run = await db.query.payrollRuns.findFirst({
    where: and(
      eq(payrollRuns.userId, userId),
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

  const settings = await loadPayrollSettings(userId);
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
        eq(chartOfAccounts.userId, userId),
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

  const code = await payrollPostingCodeBuilder(userId);
  const lines = buildPayrollJournalLines(totals, accounts, periodMonth).map(
    (line) => ({
      account: code(line.account),
      debit: line.debit,
      credit: line.credit,
      description: line.description,
    })
  );

  const { endDate } = periodRange(periodMonth);
  const { id } = await createVoucher({
    date: endDate,
    description: `Цалингийн бичилт ${periodMonth} (${run.lines.length} ажилтан)`,
    lines,
    status: "draft",
    externalRef: voucherRefOf(periodMonth),
  });

  await db
    .update(payrollRuns)
    .set({ voucherId: id, status: "voucher_created", updatedAt: new Date() })
    .where(eq(payrollRuns.id, run.id));

  await logAuditEvent({
    userId,
    action: "create_voucher",
    entityType: "payroll",
    entityId: id,
    summary: `Цалингийн журнал үүсэв — ${periodMonth}, ${run.lines.length} ажилтан, нийт олголт ${totals.earnings.toLocaleString("en-US")}₮`,
  });

  revalidatePayroll();
  return { id };
}
