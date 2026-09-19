import { getPayslipReport, getSalaryPaymentReport } from "@/lib/actions/payroll";
import type { SalaryBillKind } from "@/lib/payroll/bills";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { SalaryPaymentReportView } from "@/components/payroll/salary-payment-report-view";
import { PayslipReportView } from "@/components/payroll/payslip-report-view";

// Цалингийн тайлан — хоёр харагдац (`view`): банкны багц шилжүүлэг ба
// ажилтны цалингийн хуудас. Таб солигдоход ЗӨВХӨН тухайн харагдацын өгөгдөл
// уншигдана. URL-ийн ил `period` / `kind` параметр topbar-ийн сонголтыг ДАРНА.
type SearchParams = Promise<{ period?: string; kind?: string; view?: string }>;

export default async function PayrollReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period, kind, view } = await searchParams;
  const selection = await getPeriodSelection();
  const periodMonth =
    period && isPeriodCode(period) ? period : selection.periodCode;
  if (view === "payslip")
    return <PayslipReportView data={await getPayslipReport(periodMonth)} />;

  const billKind: SalaryBillKind = kind === "final" ? "final" : "advance";
  const data = await getSalaryPaymentReport(periodMonth, billKind);

  return <SalaryPaymentReportView data={data} />;
}
