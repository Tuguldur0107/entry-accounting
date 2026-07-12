import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function PayablesCounterpartiesPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="counterparties" mode="payable" {...data} />;
}
