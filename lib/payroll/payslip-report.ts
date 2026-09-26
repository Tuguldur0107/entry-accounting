// Цалингийн хуудсын ачаалагч — DB давхарга ("use server" БИШ): тайлангийн
// хуудас (getPayslipReport) ба и-мэйл илгээх action хоёулаа ЭНЭ НЭГ loader-оор
// уншина (дэлгэцэд харсан хуудас = ажилтанд очсон PDF).
//
// Мөр бүрийн задаргаа нь ХАДГАЛАГДСАН дүнгээс гарна (`buildPayslip` дахин
// бодохгүй, зөвхөн бүтэцчилнэ). Нэг мөр тэнцэхгүй бол тэр АЖИЛТНЫГ алгасаад
// шалтгааныг буцаана — бусад ажилтны хуудас зогсохгүй.

import { and, asc, desc, eq, like } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  auditEvents,
  organizationProfile,
  payrollRunLines,
  payrollRuns,
} from "@/lib/db/schema";
import { buildPayslip, type Payslip, type PayslipReport } from "@/lib/payroll/payslip";
import {
  PAYSLIP_EMAIL_AUDIT_ACTION,
  PAYSLIP_EMAIL_AUDIT_ENTITY,
  employeeIdOfAuditEntity,
  payslipEmailBlocker,
} from "@/lib/payroll/payslip-email";
import { loadPayrollSettings } from "@/lib/payroll/settings";

export async function loadPayslipReport(
  orgId: string,
  userId: string,
  periodMonth: string
): Promise<PayslipReport> {
  const [run, settings, company, sends] = await Promise.all([
    db.query.payrollRuns.findFirst({
      where: and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.periodMonth, periodMonth)
      ),
      with: {
        voucher: { columns: { status: true, documentNo: true } },
        lines: {
          orderBy: [asc(payrollRunLines.sortOrder)],
          with: { employee: true },
        },
      },
    }),
    loadPayrollSettings(orgId, userId),
    db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
    }),
    db
      .select({ entityId: auditEvents.entityId, createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, orgId),
          eq(auditEvents.entityType, PAYSLIP_EMAIL_AUDIT_ENTITY),
          eq(auditEvents.action, PAYSLIP_EMAIL_AUDIT_ACTION),
          like(auditEvents.entityId, `${periodMonth}:%`)
        )
      )
      .orderBy(desc(auditEvents.createdAt)),
  ]);

  const coefficients = {
    overtime: Number(settings.overtimeMultiplier),
    restDay: Number(settings.restDayMultiplier),
    holiday: Number(settings.holidayMultiplier),
    nightBonus: Number(settings.nightBonusRate),
  };
  const monthlyWorkDays = Number(settings.monthlyWorkDays);

  const lastSent = new Map<string, string>();
  for (const send of sends) {
    const employeeId = employeeIdOfAuditEntity(periodMonth, send.entityId);
    if (employeeId && !lastSent.has(employeeId))
      lastSent.set(employeeId, send.createdAt.toISOString());
  }

  const payslips: Payslip[] = [];
  const errors: PayslipReport["errors"] = [];
  const delivery: PayslipReport["email"]["delivery"] = {};

  for (const line of run?.lines ?? []) {
    const employeeName = [line.employee.lastName, line.employee.name]
      .filter(Boolean)
      .join(" ");
    const netSalary = Number(line.netSalary);
    const advanceAmount = Number(line.advanceAmount);
    delivery[line.employeeId] = {
      email: line.employee.email?.trim() || null,
      lastSentAt: lastSent.get(line.employeeId) ?? null,
    };
    try {
      payslips.push(
        buildPayslip({
          periodMonth,
          coefficients,
          monthlyWorkDays,
          line: {
            employeeId: line.employeeId,
            employeeName,
            registerNo: line.employee.registerNo ?? "",
            position: line.employee.position,
            department: line.employee.department,
            baseSalary: Number(line.employee.baseSalary),
            standardHours: Number(line.standardHours),
            workedHours: Number(line.workedHours),
            baseEarnings:
              Number(line.earnings) -
              Number(line.vacationPay) -
              Number(line.overtimePay) -
              Number(line.otherAdditions),
            overtimeHours: Number(line.overtimeHours),
            restDayHours: Number(line.restDayHours),
            holidayHours: Number(line.holidayHours),
            nightHours: Number(line.nightHours),
            overtimePay: Number(line.overtimePay),
            overtimePayManual: line.overtimePayManual,
            vacationDays: Number(line.vacationDays),
            vacationPay: Number(line.vacationPay),
            vacationPayManual: line.vacationPayManual,
            otherAdditions: Number(line.otherAdditions),
            earnings: Number(line.earnings),
            employeeSi: Number(line.employeeSi),
            pit: Number(line.pit),
            otherDeductions: Number(line.otherDeductions),
            sickDays: Number(line.sickDays),
            sickBenefit: Number(line.sickBenefit),
            sickBenefitManual: line.sickBenefitManual,
            netSalary,
            advanceAmount,
            finalNet: Math.round((netSalary - advanceAmount) * 100) / 100,
            employerSi: Number(line.employerSi),
            averageMonthlyEarnings: Number(line.averageMonthlyEarnings),
            averageMonthsUsed: line.averageMonthsUsed,
          },
        })
      );
    } catch (error) {
      errors.push({
        employeeName,
        message: error instanceof Error ? error.message : "Хуудас бүтээж чадсангүй",
      });
    }
  }

  return {
    periodMonth,
    company: {
      name: company?.name ?? "",
      registerNo: company?.registerNo ?? "",
      address: company?.address ?? "",
      phone: company?.phone ?? "",
    },
    payslips,
    errors,
    email: {
      blocker: payslipEmailBlocker(run?.voucher ?? null),
      configured: !!process.env.RESEND_API_KEY,
      delivery,
    },
  };
}
