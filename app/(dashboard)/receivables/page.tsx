import { ArApWorkspace } from "@/components/arap/arap-workspace";
import { getCollectionsOverview } from "@/lib/actions/ar-collections";
import { loadArApWorkspaceData } from "@/lib/arap/load-data";

export default async function ReceivablesPage() {
  const [data, collections] = await Promise.all([loadArApWorkspaceData(), getCollectionsOverview()]);
  return (
    <ArApWorkspace
      focus="dashboard"
      mode="receivable"
      collections={collections.error === undefined ? collections.overview : null}
      {...data}
    />
  );
}
