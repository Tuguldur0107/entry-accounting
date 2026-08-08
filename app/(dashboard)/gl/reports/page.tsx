import { db } from "@/lib/db";
import {
  journalVouchers,
  chartOfAccounts,
  segmentConfigs,
  reportLineMappings,
} from "@/lib/db/schema";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { eq, and, inArray } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { ReportsView } from "@/components/gl/reports-view";

type SearchParams = Promise<{ start?: string; end?: string; report?: string }>;

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { start, end, report } = await searchParams;
  const period = await getPeriodSelection();

  const [vouchers, accounts, rawSegConfigs, balanceSheetMappings] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"])
      ),
      with: { lines: true },
    }),
    db.query.chartOfAccounts.findMany({
      where: eq(chartOfAccounts.organizationId, orgId),
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.reportLineMappings.findMany({
      where: and(
        eq(reportLineMappings.organizationId, orgId),
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
      initialStart={start ?? period.from}
      initialEnd={end ?? period.to}
      initialReport={report}
      balanceSheetMappings={balanceSheetMappings}
    />
  );
}
