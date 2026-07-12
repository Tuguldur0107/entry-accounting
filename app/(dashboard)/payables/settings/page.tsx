import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function PayablesSettingsPage() {
  const data = await loadArApWorkspaceData();
  return <ArApWorkspace focus="settings" mode="payable" {...data} />;
}
