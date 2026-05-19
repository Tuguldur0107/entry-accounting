import { db } from "@/lib/db";
import {
  journalVouchers,
  chartOfAccounts,
  segmentConfigs,
  reportLineMappings,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and, inArray } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { ReportsView } from "@/components/gl/reports-view";

type SearchParams = Promise<{ start?: string; end?: string; report?: string }>;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end, report } = await searchParams;

  const [vouchers, accounts, rawSegConfigs, balanceSheetMappings] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.userId, userId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.userId, userId),
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.userId, userId),
        eq(reportLineMappings.reportType, "balance-sheet")
      ),
    }),
  ]);

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS
    .filter((def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true)
    .map((def) => def.id);

  return (
    <ReportsView
      vouchers={vouchers}
      accounts={accounts}
      activeSegIds={activeSegIds}
      initialStart={start}
      initialEnd={end}
      initialReport={report}
      balanceSheetMappings={balanceSheetMappings}
    />
  );
}
