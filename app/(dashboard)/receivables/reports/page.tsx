import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

type SearchParams = Promise<{ asOf?: string }>;

function todayInUlaanbaatar() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function ReceivablesReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const data = await loadArApWorkspaceData();
  const params = await searchParams;
  const reportAsOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "")
    ? params.asOf!
    : todayInUlaanbaatar();
  return (
    <ArApWorkspace
      focus="reports"
      mode="receivable"
      reportAsOf={reportAsOf}
      {...data}
    />
  );
}
