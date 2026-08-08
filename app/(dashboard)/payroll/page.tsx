import { getPayrollRunData } from "@/lib/actions/payroll";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { PayrollRunView } from "@/components/payroll/payroll-run-view";

// URL-ийн ил `period` параметр topbar-ийн сонголтыг ДАРНА (deep link) —
// системийн периодын шүүлтүүрийн стандарт хэв маяг.
type SearchParams = Promise<{ period?: string }>;

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  const selection = await getPeriodSelection();
  const periodMonth =
    period && isPeriodCode(period) ? period : selection.periodCode;

  const data = await getPayrollRunData(periodMonth);

  return <PayrollRunView data={data} />;
}
