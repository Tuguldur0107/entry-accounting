import { eq } from "drizzle-orm";

import { ComponentAnalysisReport } from "@/components/costing/component-analysis-report";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { loadComponentAnalysis } from "@/lib/costing/component-analysis";
import { db } from "@/lib/db";
import { costEntries } from "@/lib/db/schema";

type SearchParams = Promise<{ period?: string }>;

export default async function ComponentAnalysisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { period } = await searchParams;

  // Сонгох боломжтой сарууд — орлогын өртгийн бичилт байгаа сарууд.
  const entries = await db.query.costEntries.findMany({
    where: eq(costEntries.organizationId, orgId),
    columns: { periodCode: true, date: true },
  });
  const periodOptions = [
    ...new Set(
      entries.map((entry) => entry.periodCode ?? entry.date.slice(0, 7))
    ),
  ].sort((a, b) => (a < b ? 1 : -1));

  const selection = await getPeriodSelection();
  const periodCode =
    period && periodOptions.includes(period)
      ? period
      : periodOptions.includes(selection.periodCode)
        ? selection.periodCode
        : (periodOptions[0] ?? selection.periodCode);

  const rows = await loadComponentAnalysis(orgId, periodCode);

  return (
    <ComponentAnalysisReport
      periodCode={periodCode}
      periodOptions={periodOptions}
      rows={rows}
    />
  );
}
