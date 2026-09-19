import { getOrganizationProfile } from "@/lib/actions/organization-profile";
import { getOrgSettingsData } from "@/lib/actions/org";
import { OrgSettingsView } from "@/components/settings/org-settings-view";

export const metadata = { title: "Байгууллага — Entry Accounting" };

export default async function OrgSettingsPage() {
  const [data, organizationProfile] = await Promise.all([
    getOrgSettingsData(),
    getOrganizationProfile(),
  ]);
  return <OrgSettingsView data={data} organizationProfile={organizationProfile} />;
}
