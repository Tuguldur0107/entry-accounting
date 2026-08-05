import { CompanySettingsForm } from "@/components/settings/company-settings-form";
import { getCompanySettings } from "@/lib/actions/company";

export const metadata = { title: "Компанийн мэдээлэл — Entry Accounting" };

export default async function CompanyPage() {
  const settings = await getCompanySettings();
  return <CompanySettingsForm initial={settings} />;
}
