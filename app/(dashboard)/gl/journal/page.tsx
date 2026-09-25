import { db } from "@/lib/db";
import {
  chartOfAccounts,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { periodRange } from "@/lib/periods/period";

const maxDate = (a: string, b: string) => (a > b ? a : b);
import { eq, and } from "drizzle-orm";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { JournalList } from "@/components/gl/journal-list";
import { loadJournalListRows } from "@/lib/gl/journal-list-data";

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
    // Ваучер + мөр + эх баримтын харилцагч/валют/ханш + үүсгэсэн хэрэглэгч.
    loadJournalListRows(orgId),
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
    <>
      {/* Хуудасны гарчиг topbar-т харагддаг — дэлгэц уншигчид h1 (axe). */}
      <h1 className="sr-only">Журналын жагсаалт</h1>
      <JournalList
        vouchers={vouchers}
        accounts={accounts}
        activeSegIds={activeSegIds}
        defaultSegments={defaultSegments}
        initialStart={start ?? period.from}
        // SIM2-040: журналын ЖАГСААЛТ сонгосон сарыг БҮТНЭЭР (өнөөдрөөр
        // таслахгүй) — сарын эцсийн огноотой ноорог (цалин г.м.) харагдана.
        initialEnd={end ?? maxDate(period.to, periodRange(period.periodCode).endDate)}
      />
    </>
  );
}
