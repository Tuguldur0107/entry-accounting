import { PeriodsView } from "@/components/periods/periods-view";
import { listPeriods } from "@/lib/actions/periods";

export default async function PeriodsPage() {
  const periods = await listPeriods();
  return <PeriodsView periods={periods} />;
}
