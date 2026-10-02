// eTax маягтуудын ЭХ ӨГӨГДӨЛ (SERVER, DB) — ХАОАТ (цалингийн бодолт) ба ААНОАТ (орлогын тайлан
// жилийн эхнээс + ҮХ-ийн элэгдэл). docs/dev/etax.md §8. Дүн ЗОХИОХГҮЙ: цалингийн мөрийн
// хадгалсан дүн (earnings, employeeSi, pit, netSalary) + calc.ts-ийн ижил томьёогоор татвар
// ногдох орлого/хөнгөлөлт; орлогын тайлан = GL 5/6/7/8 бүлгийн эргэлт (`loadBalanceRowsFast`,
// snapshot + delta); элэгдэл = fa_depreciation_entries (reversed орохгүй).

import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { chartOfAccounts, faDepreciationEntries, journalVouchers, payrollRunLines, payrollRuns } from "@/lib/db/schema";
import { pitCreditOf } from "@/lib/payroll/calc";
import { loadPayrollSettings } from "@/lib/payroll/settings";
import { loadBalanceRowsFast } from "@/lib/reports/period-balances";

import { etaxPeriodOf, periodRangeOf, type CitTotals, type PitTotals } from "./submission";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** ХАОАТ — тайлант сарын цалингийн бодолт (нэг байгууллагад сард нэг run). */
export async function loadPitTotals(orgId: string, periodCode: string): Promise<PitTotals> {
  const { kind } = etaxPeriodOf(periodCode);
  if (kind !== "month") throw new Error("ХАОАТ суутгагчийн тайлан сарын тайлант үетэй");
  const [settings, run] = await Promise.all([
    loadPayrollSettings(orgId),
    db.query.payrollRuns.findFirst({
      where: and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.periodMonth, periodCode)),
      with: { lines: { columns: { earnings: true, employeeSi: true, pit: true, netSalary: true } } },
    }),
  ]);
  const monthlyTaxFree = Math.max(0, Number(settings.monthlyTaxFree ?? 0));
  let voucherStatus: string | null = null;
  if (run?.voucherId) {
    const voucher = await db.query.journalVouchers.findFirst({ where: eq(journalVouchers.id, run.voucherId), columns: { status: true } });
    voucherStatus = voucher?.status ?? null;
  }
  const totals: PitTotals = {
    periodCode,
    employeeCount: run?.lines.length ?? 0,
    earnings: 0,
    employeeSi: 0,
    taxableIncome: 0,
    pitCredit: 0,
    pit: 0,
    netSalary: 0,
    runStatus: run?.status ?? null,
    voucherStatus,
    monthlyTaxFree,
  };
  for (const line of run?.lines ?? []) {
    const earnings = Number(line.earnings);
    const employeeSi = Number(line.employeeSi);
    // calc.ts computeEmployeePayroll-тэй ИЖИЛ: max(0, олголт − НДШ − сарын татваргүй босго)
    const taxable = Math.max(0, earnings - employeeSi - monthlyTaxFree);
    totals.earnings += earnings;
    totals.employeeSi += employeeSi;
    totals.taxableIncome += taxable;
    totals.pitCredit += pitCreditOf(taxable);
    totals.pit += Number(line.pit);
    totals.netSalary += Number(line.netSalary);
  }
  for (const key of ["earnings", "employeeSi", "taxableIncome", "pitCredit", "pit", "netSalary"] as const) totals[key] = round2(totals[key]);
  return totals;
}

/** ААНОАТ — жилийн эхнээс улирлын эцэс хүртэлх орлогын тайлан + элэгдэл. */
export async function loadCitTotals(orgId: string, periodCode: string): Promise<CitTotals> {
  const { from, to } = periodRangeOf("cit", periodCode);
  const [accounts, depreciation] = await Promise.all([
    db.query.chartOfAccounts.findMany({ where: eq(chartOfAccounts.organizationId, orgId) }),
    db
      .select({ amount: faDepreciationEntries.amount, taxAmount: faDepreciationEntries.taxAmount, status: faDepreciationEntries.status })
      .from(faDepreciationEntries)
      .where(
        and(
          eq(faDepreciationEntries.organizationId, orgId),
          gte(faDepreciationEntries.periodMonth, from.slice(0, 7)),
          lte(faDepreciationEntries.periodMonth, to.slice(0, 7)),
          ne(faDepreciationEntries.status, "reversed")
        )
      ),
  ]);
  const rows = await loadBalanceRowsFast(orgId, from, to, accounts, [3]);
  const totals: CitTotals = {
    periodCode,
    revenue: 0,
    cogs: 0,
    operatingExpenses: 0,
    financeExpenses: 0,
    bookDepreciation: 0,
    taxDepreciation: 0,
    accountCount: 0,
  };
  for (const row of rows) {
    const main = row.mainAccount;
    const net = row.totals.periodDebit - row.totals.periodCredit;
    if (main.startsWith("5")) totals.revenue += -net;
    else if (main.startsWith("6")) totals.cogs += net;
    else if (main.startsWith("7")) totals.operatingExpenses += net;
    else if (main.startsWith("8")) totals.financeExpenses += net;
    else continue;
    if (net !== 0) totals.accountCount += 1;
  }
  for (const entry of depreciation) {
    // Дансны элэгдэл зөвхөн батлагдсан (GL-д орсон); татварын мэмо ноорог/батлагдсан хоёуланд
    if (entry.status === "posted") totals.bookDepreciation += Number(entry.amount);
    totals.taxDepreciation += Number(entry.taxAmount ?? 0);
  }
  for (const key of ["revenue", "cogs", "operatingExpenses", "financeExpenses", "bookDepreciation", "taxDepreciation"] as const) totals[key] = round2(totals[key]);
  return totals;
}

/** Хэрэглээгүй импорт хамгаалалт — payrollRunLines/inArray schema-д хэрэгтэй үед. */
export const _etaxFormSourceTables = { payrollRunLines, inArray };
