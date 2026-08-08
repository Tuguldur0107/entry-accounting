import { db } from "@/lib/db";
import {
  journalVouchers,
  chartOfAccounts,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { eq, and } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { JournalList } from "@/components/gl/journal-list";

type SearchParams = Promise<{ start?: string; end?: string }>;

export default async function JournalPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { start, end } = await searchParams;
  // Topbar-ийн периодын сонголт (PTD/QTD/YTD) — URL параметр дарна.
  const period = await getPeriodSelection();

  const [vouchers, accounts, rawSegConfigs, rawSegValues] = await Promise.all([
    db.query.journalVouchers.findMany({
      where: eq(journalVouchers.organizationId, orgId),
      with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
      orderBy: [desc(journalVouchers.date), desc(journalVouchers.createdAt)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isEnabled, true)),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.organizationId, orgId) }),
    db.query.segmentValues.findMany({ where: eq(segmentValues.organizationId, orgId) }),
  ]);

  const segConfigMap = new Map(rawSegConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS
    .filter((def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true)
    .map((def) => def.id);

  // Excel импортын normalize-д — журналын редактортой ИЖИЛ дүрэм: компанийн
  // сегмент (S1) ганц утгатай бол автоматаар бөглөнө.
  const defaultSegments: Record<number, string> = {};
  if (activeSegIds.includes(1)) {
    const s1Values = rawSegValues.filter((value) => value.segmentId === 1);
    if (s1Values.length === 1) defaultSegments[1] = s1Values[0].code;
  }

  return (
    <JournalList
      vouchers={vouchers}
      accounts={accounts}
      activeSegIds={activeSegIds}
      defaultSegments={defaultSegments}
      initialStart={start ?? period.from}
      initialEnd={end ?? period.to}
    />
  );
}
