import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function PayablesPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="dashboard" mode="payable" {...data} />;
}
