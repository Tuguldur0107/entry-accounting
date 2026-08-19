import { getMonthEndChecklist } from "@/lib/actions/month-end";
import { getActiveOrg } from "@/lib/auth";
import { runLedgerIntegrityCheck } from "@/lib/gl/integrity";
import { getPeriodSelection } from "@/lib/periods/selection";
import { isPeriodCode } from "@/lib/periods/period";
import { CloseWizard } from "@/components/periods/close-wizard";

// URL-ийн ил `period` параметр topbar-ийн сонголтыг дарна (deep link стандарт).
type SearchParams = Promise<{ period?: string }>;

export default async function MonthEndClosePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { period } = await searchParams;
  const selection = await getPeriodSelection();
  const periodCode =
    period && isPeriodCode(period) ? period : selection.periodCode;

  const { orgId } = await getActiveOrg();
  const [checklist, integrity] = await Promise.all([
    getMonthEndChecklist(periodCode),
    runLedgerIntegrityCheck(orgId),
  ]);

  return (
    <CloseWizard
      periodCode={periodCode}
      checklist={checklist}
      integrity={integrity}
    />
  );
}
