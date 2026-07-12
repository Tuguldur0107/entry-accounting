import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function ReceivablesPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="dashboard" mode="receivable" {...data} />;
}
