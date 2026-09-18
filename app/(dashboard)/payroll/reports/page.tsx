import { getSalaryPaymentReport } from "@/lib/actions/payroll";
import type { SalaryBillKind } from "@/lib/payroll/bills";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { SalaryPaymentReportView } from "@/components/payroll/salary-payment-report-view";

// Цалин олгох тайлан — банкны багц шилжүүлгийн жагсаалт.
// URL-ийн ил `period` / `kind` параметр topbar-ийн сонголтыг ДАРНА (deep link).
type SearchParams = Promise<{ period?: string; kind?: string }>;

export default async function PayrollReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period, kind } = await searchParams;
  const selection = await getPeriodSelection();
  const periodMonth =
    period && isPeriodCode(period) ? period : selection.periodCode;
  const billKind: SalaryBillKind = kind === "final" ? "final" : "advance";

  const data = await getSalaryPaymentReport(periodMonth, billKind);

  return <SalaryPaymentReportView data={data} />;
}
