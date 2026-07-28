import { CostAllocationView } from "@/components/costing/cost-allocation-view";
import { auth } from "@/lib/auth";
import {
  loadAllocationTargets,
  loadAllocations,
} from "@/lib/actions/cost-allocation";
import { loadCostComponents } from "@/lib/costing/master-data";
import { periodRange } from "@/lib/periods/period";

type SearchParams = Promise<{ from?: string; to?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CostAllocationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { from, to } = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = periodRange(today.slice(0, 7));
  const range = {
    from: from && DATE_RE.test(from) ? from : thisMonth.startDate,
    to: to && DATE_RE.test(to) ? to : thisMonth.endDate,
  };

  const [rows, targets, components] = await Promise.all([
    loadAllocations(),
    loadAllocationTargets(range),
    loadCostComponents(userId, { activeOnly: true }),
  ]);

  return (
    <CostAllocationView
      rows={rows}
      targets={targets}
      components={components.map((component) => ({
        id: component.id,
        code: component.code,
        name: component.name,
      }))}
      from={range.from}
      to={range.to}
    />
  );
}
