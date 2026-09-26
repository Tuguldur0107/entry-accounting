"use server";

// Цалингийн хуудсыг ажилтан бүрд И-МЭЙЛЭЭР илгээх (PDF хавсралт).
//
// Дүрэм (lib/payroll/payslip-email.ts — ЦЭВЭР, тесттэй):
//   • эрх `payroll:post`; зөвхөн сарын цалингийн GL журнал БАТЛАГДСАН үед
//   • хуудас нь тайлангийн дэлгэцтэй НЭГ loader-оос (loadPayslipReport)
//   • мэйлийн гарчиг, биед ДҮН БАЙХГҮЙ — зөвхөн PDF-д
//   • илгээлт бүр (дахин илгээлт ч) аудитад: хэн, хэзээ, хэнд
//   • нэг ажилтны алдаа бусдыг зогсоохгүй — үр дүнд ИЛ жагсаана

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend } from "resend";

import { actionError, type ActionResult } from "@/lib/action-result";
import { logAuditEvent } from "@/lib/audit";
import { requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationProfile } from "@/lib/db/schema";
import { resolveInvoiceSender, translateResendError } from "@/lib/email/sender";
import { renderPayslipPdf } from "@/lib/pdf/payslip-pdf";
import {
  PAYSLIP_EMAIL_AUDIT_ACTION,
  PAYSLIP_EMAIL_AUDIT_ENTITY,
  PAYSLIP_EMAIL_SPACING_MS,
  buildPayslipEmailPayload,
  payslipAuditEntityId,
  planPayslipRecipients,
  type PayslipSkip,
} from "@/lib/payroll/payslip-email";
import { loadPayslipReport } from "@/lib/payroll/payslip-report";
import { isPeriodCode } from "@/lib/periods/period";

export type PayslipEmailResult = {
  sent: { employeeId: string; employeeName: string; email: string }[];
  /** И-мэйлгүй, буруу хаягтай, хуудасгүй ажилтан. */
  skipped: PayslipSkip[];
  /** Илгээх үед алдаа гарсан (Resend, PDF). */
  failed: PayslipSkip[];
};

/**
 * `employeeIds` өгвөл зөвхөн тэдэнд, үгүй бол тухайн сарын бүх ажилтанд.
 */
export async function sendPayslipEmails(
  periodMonth: string,
  employeeIds?: string[]
): Promise<ActionResult<PayslipEmailResult>> {
  try {
    return await sendPayslipEmailsCore(periodMonth, employeeIds);
  } catch (caught) {
    return actionError("sendPayslipEmails", caught, "Цалингийн хуудас илгээгдсэнгүй");
  }
}

async function sendPayslipEmailsCore(
  periodMonth: string,
  employeeIds?: string[]
): Promise<PayslipEmailResult> {
  const { orgId, userId } = await requireModuleAction("payroll", "post");
  if (!isPeriodCode(periodMonth)) throw new Error("Сар (YYYY-MM) буруу байна");
  if (employeeIds && employeeIds.length === 0)
    throw new Error("Илгээх ажилтан сонгоогүй байна");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey)
    throw new Error(
      "И-мэйл илгээх тохиргоо хийгдээгүй (RESEND_API_KEY) — системийн админд хандана уу"
    );

  const report = await loadPayslipReport(orgId, userId, periodMonth);
  if (report.email.blocker) throw new Error(report.email.blocker);
  if (!report.company.name)
    throw new Error(
      "Компанийн нэр тохируулаагүй — Тохиргоо → Компанийн мэдээлэл хэсгийг бөглөнө үү"
    );

  const plan = planPayslipRecipients({
    payslips: report.payslips,
    emails: Object.fromEntries(
      Object.entries(report.email.delivery).map(([id, row]) => [id, row.email])
    ),
    only: employeeIds,
  });
  // Тэнцээгүй мөр (хуудас гараагүй) — ил алгасна.
  for (const error of report.errors)
    plan.skipped.push({
      employeeId: "",
      employeeName: error.employeeName,
      reason: error.message,
    });
  if (plan.send.length === 0)
    return { sent: [], skipped: plan.skipped, failed: [] };

  // Илгээгч — нэхэмжлэхтэй ИЖИЛ эрэмбэ (tenant → env → ил алдаа).
  const settings = await db.query.organizationProfile.findFirst({
    where: eq(organizationProfile.organizationId, orgId),
    columns: {
      invoiceFromEmail: true,
      invoiceReplyTo: true,
      emailDomainVerified: true,
      name: true,
    },
  });
  const sender = resolveInvoiceSender(
    settings
      ? {
          invoiceFromEmail: settings.invoiceFromEmail,
          invoiceReplyTo: settings.invoiceReplyTo,
          emailDomainVerified: settings.emailDomainVerified,
          companyName: settings.name,
        }
      : null,
    process.env
  );

  const resend = new Resend(apiKey);
  const slips = new Map(report.payslips.map((slip) => [slip.employeeId, slip]));
  const result: PayslipEmailResult = { sent: [], skipped: plan.skipped, failed: [] };

  for (const [index, recipient] of plan.send.entries()) {
    if (index > 0)
      await new Promise((resolve) => setTimeout(resolve, PAYSLIP_EMAIL_SPACING_MS));
    const slip = slips.get(recipient.employeeId)!;
    try {
      const pdf = await renderPayslipPdf(slip, report.company);
      const { error } = await resend.emails.send(
        buildPayslipEmailPayload({
          companyName: report.company.name,
          periodMonth,
          employeeName: recipient.employeeName,
          to: recipient.email,
          from: sender.from,
          replyTo: sender.replyTo,
          pdf,
        })
      );
      if (error) throw new Error(translateResendError(error.message));
    } catch (caught) {
      result.failed.push({
        employeeId: recipient.employeeId,
        employeeName: recipient.employeeName,
        reason: caught instanceof Error ? caught.message : "Илгээгдсэнгүй",
      });
      continue;
    }
    result.sent.push(recipient);
    // Аудитын тайлбарт ДҮН бичихгүй — хэн, хэнд, аль сар л.
    await logAuditEvent({
      userId,
      organizationId: orgId,
      action: PAYSLIP_EMAIL_AUDIT_ACTION,
      entityType: PAYSLIP_EMAIL_AUDIT_ENTITY,
      entityId: payslipAuditEntityId(periodMonth, recipient.employeeId),
      summary: `${periodMonth} цалингийн хуудас → ${recipient.employeeName} <${recipient.email}>${
        report.email.delivery[recipient.employeeId]?.lastSentAt ? " (дахин илгээв)" : ""
      }`,
    });
  }

  revalidatePath("/payroll/reports");
  return result;
}
