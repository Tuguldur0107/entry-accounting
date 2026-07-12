import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function ReceivablesCounterpartiesPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="counterparties" mode="receivable" {...data} />;
}
