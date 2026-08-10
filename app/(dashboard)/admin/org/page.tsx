import { getOrgSettingsData } from "@/lib/actions/org";
import { OrgSettingsView } from "@/components/settings/org-settings-view";

export default async function OrgSettingsPage() {
  const data = await getOrgSettingsData();
  return <OrgSettingsView data={data} />;
}
