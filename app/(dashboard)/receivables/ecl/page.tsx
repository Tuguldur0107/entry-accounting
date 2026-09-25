import { EclView } from "@/components/arap/ecl-view";
import { getEclOverview } from "@/lib/actions/arap-ecl";
import { getPeriodSelection } from "@/lib/periods/selection";

type SearchParams = Promise<{ asOf?: string }>;

// Авлагын ECL нөөц (IFRS 9, ENT-065) — огноо нь топбарын периодын төгсгөл
// (URL-ийн `asOf` deep link-ээр дарна).
export default async function ReceivablesEclPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const period = await getPeriodSelection();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "") ? params.asOf! : period.to;
  const overview = await getEclOverview(asOf);
  if (overview.error !== undefined) return <EclView asOf={asOf} overview={null} error={overview.error} />;
  return <EclView asOf={asOf} overview={overview} error={null} />;
}
