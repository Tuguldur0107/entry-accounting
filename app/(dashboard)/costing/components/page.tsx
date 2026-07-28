import { eq } from "drizzle-orm";

import { ComponentAnalysisReport } from "@/components/costing/component-analysis-report";
import { auth } from "@/lib/auth";
import { loadComponentAnalysis } from "@/lib/costing/component-analysis";
import { db } from "@/lib/db";
import { costEntries } from "@/lib/db/schema";
import { periodCodeOf } from "@/lib/periods/period";

type SearchParams = Promise<{ period?: string }>;

export default async function ComponentAnalysisPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { period } = await searchParams;

  // Сонгох боломжтой сарууд — орлогын өртгийн бичилт байгаа сарууд.
  const entries = await db.query.costEntries.findMany({
    where: eq(costEntries.userId, userId),
    columns: { periodCode: true, date: true },
  });
  const periodOptions = [
    ...new Set(
      entries.map((entry) => entry.periodCode ?? entry.date.slice(0, 7))
    ),
  ].sort((a, b) => (a < b ? 1 : -1));

  const periodCode =
    period && periodOptions.includes(period)
      ? period
      : (periodOptions[0] ??
        periodCodeOf(new Date().toISOString().slice(0, 10)));

  const rows = await loadComponentAnalysis(userId, periodCode);

  return (
    <ComponentAnalysisReport
      periodCode={periodCode}
      periodOptions={periodOptions}
      rows={rows}
    />
  );
}
