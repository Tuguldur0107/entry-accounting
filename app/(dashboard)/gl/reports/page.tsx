import { db } from "@/lib/db";
import { journalVouchers, chartOfAccounts, segmentConfigs } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and, inArray } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { ReportsView } from "@/components/gl/reports-view";

export default async function ReportsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [vouchers, accounts, rawSegConfigs] = await Promise.all([
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
  ]);

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS
    .filter((def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true)
    .map((def) => def.id);

  return <ReportsView vouchers={vouchers} accounts={accounts} activeSegIds={activeSegIds} />;
}
