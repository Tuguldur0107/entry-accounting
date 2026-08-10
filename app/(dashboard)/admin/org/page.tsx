import { getCompanySettings } from "@/lib/actions/company";
import { getOrgSettingsData } from "@/lib/actions/org";
import { OrgSettingsView } from "@/components/settings/org-settings-view";

export const metadata = { title: "Байгууллага, гишүүд — Entry Accounting" };

export default async function OrgSettingsPage() {
  const [data, companySettings] = await Promise.all([
    getOrgSettingsData(),
    getCompanySettings(),
  ]);
  return <OrgSettingsView data={data} companySettings={companySettings} />;
}
