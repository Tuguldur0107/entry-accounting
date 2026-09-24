import { ComponentAnalysisReport } from "@/components/costing/component-analysis-report";
import { getActiveOrg } from "@/lib/auth";
import { isPeriodCode } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { loadComponentAnalysis } from "@/lib/costing/component-analysis";

type SearchParams = Promise<{ period?: string }>;

export default async function ComponentAnalysisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { period } = await searchParams;

  // Сар: URL-ийн `period` (deep link) → topbar-ийн сонголт (тайлангийн стандарт).
  const selection = await getPeriodSelection();
  const periodCode = period && isPeriodCode(period) ? period : selection.periodCode;

  const rows = await loadComponentAnalysis(orgId, periodCode);

  return (
    <ComponentAnalysisReport
      periodCode={periodCode}
      rows={rows}
    />
  );
}
