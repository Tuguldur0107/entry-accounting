import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";
import { getPeriodSelection } from "@/lib/periods/selection";

type SearchParams = Promise<{ asOf?: string }>;

export default async function ReceivablesReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const data = await loadArApWorkspaceData();
  const params = await searchParams;
  // Насжилт "аль өдрийн байдлаар" — периодын сонголтын төгсгөл.
  const period = await getPeriodSelection();
  const reportAsOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "")
    ? params.asOf!
    : period.to;
  return (
    <ArApWorkspace
      focus="reports"
      mode="receivable"
      reportAsOf={reportAsOf}
      {...data}
    />
  );
}
