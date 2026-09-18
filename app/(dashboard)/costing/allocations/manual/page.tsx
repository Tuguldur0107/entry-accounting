import { CostAllocationView } from "@/components/costing/cost-allocation-view";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import {
  loadAllocationSources,
  loadAllocationTargets,
  loadAllocations,
} from "@/lib/actions/cost-allocation";
import { loadCostComponents } from "@/lib/costing/master-data";

type SearchParams = Promise<{ from?: string; to?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CostAllocationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { from, to } = await searchParams;

  const period = await getPeriodSelection();
  const range = {
    from: from && DATE_RE.test(from) ? from : period.from,
    to: to && DATE_RE.test(to) ? to : period.to,
  };

  const [rows, targets, sources, components] = await Promise.all([
    loadAllocations(),
    loadAllocationTargets(range),
    loadAllocationSources(range),
    loadCostComponents(orgId, { activeOnly: true }),
  ]);

  return (
    <CostAllocationView
      rows={rows}
      targets={targets}
      sources={sources}
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
