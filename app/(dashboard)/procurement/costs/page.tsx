// "Хуваарилагдаагүй зардал" worklist (Server Component).
//
// Огнооны муж: URL-ийн ил `from`/`to` параметр топбарын периодын сонголтыг
// ДАРНА (CLAUDE.md §4 дүрэм) — байхгүй бол `getPeriodSelection()`-ээс.

import { UnallocatedCostsView } from "@/components/procurement/unallocated-costs-view";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { loadUnallocatedCostLines } from "@/lib/procurement/load-data";

type SearchParams = Promise<{ from?: string; to?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function UnallocatedCostsPage({
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

  const rows = await loadUnallocatedCostLines(orgId, range);

  return <UnallocatedCostsView rows={rows} from={range.from} to={range.to} />;
}
