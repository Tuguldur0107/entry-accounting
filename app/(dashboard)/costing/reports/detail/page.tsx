import { TransactionDetailReport } from "@/components/costing/transaction-detail-report";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { loadClearingReconciliation } from "@/lib/costing/clearing-reconciliation";
import {
  loadInventoryGlReconciliation,
  loadTransactionDetail,
} from "@/lib/costing/transaction-detail";

type SearchParams = Promise<{ from?: string; to?: string }>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function CostingDetailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { from, to } = await searchParams;

  // Анхдагч: topbar-ийн периодын сонголт (PTD/QTD/YTD).
  const period = await getPeriodSelection();
  const range = {
    from: from && DATE_RE.test(from) ? from : period.from,
    to: to && DATE_RE.test(to) ? to : period.to,
  };

  const [rows, reconciliation, clearing] = await Promise.all([
    loadTransactionDetail(orgId, range),
    loadInventoryGlReconciliation(orgId, range),
    loadClearingReconciliation(orgId, range),
  ]);

  return (
    <TransactionDetailReport
      from={range.from}
      to={range.to}
      rows={rows}
      reconciliation={reconciliation.rows}
      pendingCount={reconciliation.pendingCount}
      pendingAmount={reconciliation.pendingAmount}
      clearing={clearing}
    />
  );
}
