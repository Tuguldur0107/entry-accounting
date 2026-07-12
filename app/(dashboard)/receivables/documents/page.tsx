import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function ReceivablesDocumentsPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="documents" mode="receivable" {...data} />;
}
