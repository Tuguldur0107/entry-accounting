import { StatementReportView } from "@/components/arap/statement-report-view";
import { getCounterpartyStatement, listStatementCounterparties } from "@/lib/actions/ar-statement";
import { getPeriodSelection } from "@/lib/periods/selection";

type SearchParams = Promise<{ counterparty?: string }>;

// Тооцоо нийлсэн акт (docs/dev/arap.md §5i) — огноо нь топбарын период,
// харилцагч нь URL `?counterparty=`. Авлага, Өглөг хоёр модульд ижил акт.
export default async function StatementReportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const period = await getPeriodSelection();
  const list = await listStatementCounterparties();
  const counterpartyId = /^[0-9a-f-]{36}$/.test(params.counterparty ?? "") ? params.counterparty! : null;
  const loaded = counterpartyId ? await getCounterpartyStatement(counterpartyId, period.from, period.to) : null;
  return (
    <StatementReportView
      counterparties={list.counterparties ?? []}
      counterpartyId={counterpartyId}
      from={period.from}
      to={period.to}
      statement={loaded?.statement ?? null}
      error={list.error ?? loaded?.error ?? null}
    />
  );
}
