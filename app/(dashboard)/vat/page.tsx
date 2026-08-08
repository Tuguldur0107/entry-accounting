import { getVatReturnData } from "@/lib/actions/vat";
import { getPeriodSelection } from "@/lib/periods/selection";
import { isPeriodCode } from "@/lib/periods/period";
import { VatReturnView } from "@/components/vat/vat-return-view";

// URL-ийн ил `period` параметр topbar-ийн сонголтыг ДАРНА (deep link) —
// системийн периодын шүүлтүүрийн стандарт хэв маяг.
type SearchParams = Promise<{ period?: string }>;

export default async function VatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  const selection = await getPeriodSelection();
  const periodCode =
    period && isPeriodCode(period) ? period : selection.periodCode;

  const data = await getVatReturnData(periodCode);

  return <VatReturnView periodCode={periodCode} data={data} />;
}
