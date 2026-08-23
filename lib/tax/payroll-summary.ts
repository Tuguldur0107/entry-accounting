// Цалингийн бодолтоос татварын нэгтгэл — ХХОАТ, НДШ хуудсуудын НЭГ эх
// сурвалж. Тоо ЭНД дахин бодогдохгүй: payroll_run_lines-д calc.ts-ээр
// бодогдож хадгалагдсан суутгалуудыг зөвхөн саруулж нэгтгэнэ.

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { payrollRuns } from "@/lib/db/schema";
import { roundMoney as round2 } from "@/lib/arap/accounting";

export interface PayrollTaxMonth {
  /** YYYY-MM */
  periodMonth: string;
  employees: number;
  /** Нийт олголт (татвар ногдох суурь). */
  earnings: number;
  /** ХХОАТ (цалингийн суутгал). */
  pit: number;
  /** НДШ — ажилтны 11.5%. */
  employeeSi: number;
  /** НДШ — ажил олгогчийн 12.5–14.5%. */
  employerSi: number;
  /** GL ноорог журнал үүссэн эсэх (payroll:YYYY-MM). */
  voucherCreated: boolean;
}


export async function loadPayrollTaxMonths(
  orgId: string
): Promise<PayrollTaxMonth[]> {
  const runs = await db.query.payrollRuns.findMany({
    where: eq(payrollRuns.organizationId, orgId),
    with: { lines: { columns: {
      earnings: true,
      pit: true,
      employeeSi: true,
      employerSi: true,
    } } },
    orderBy: [desc(payrollRuns.periodMonth)],
  });

  return runs.map((run) => {
    let earnings = 0;
    let pit = 0;
    let employeeSi = 0;
    let employerSi = 0;
    for (const line of run.lines) {
      earnings += Number(line.earnings);
      pit += Number(line.pit);
      employeeSi += Number(line.employeeSi);
      employerSi += Number(line.employerSi);
    }
    return {
      periodMonth: run.periodMonth,
      employees: run.lines.length,
      earnings: round2(earnings),
      pit: round2(pit),
      employeeSi: round2(employeeSi),
      employerSi: round2(employerSi),
      voucherCreated: run.status === "voucher_created",
    };
  });
}
