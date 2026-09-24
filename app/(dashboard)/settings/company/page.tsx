import { OrganizationProfileForm } from "@/components/settings/organization-profile-form";
import { getOrganizationProfile } from "@/lib/actions/organization-profile";

export const metadata = { title: "Компанийн мэдээлэл — Entry Accounting" };

export default async function CompanyPage() {
  const settings = await getOrganizationProfile();
  return (
    <>
      <h1 className="sr-only">Компанийн мэдээлэл</h1>
      <OrganizationProfileForm initial={settings} />
    </>
  );
}
