// Хангамжийн хяналтын самбар (Server Component) — өгөгдөл нь
// lib/procurement/load-data.ts-ийн НЭГ л loader-аас (гэрээ §4).

import { ProcurementDashboard } from "@/components/procurement/procurement-dashboard";
import { getActiveOrg } from "@/lib/auth";
import { loadProcurementDashboard } from "@/lib/procurement/load-data";

export default async function ProcurementDashboardPage() {
  const { orgId } = await getActiveOrg();
  const data = await loadProcurementDashboard(orgId);

  return <ProcurementDashboard {...data} />;
}
