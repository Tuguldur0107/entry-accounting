import { TransactionDetailReport } from "@/components/costing/transaction-detail-report";
import { auth } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
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
  const session = await auth();
  const userId = session!.user!.id!;
  const { from, to } = await searchParams;

  // Анхдагч: topbar-ийн периодын сонголт (PTD/QTD/YTD).
  const period = await getPeriodSelection();
  const range = {
    from: from && DATE_RE.test(from) ? from : period.from,
    to: to && DATE_RE.test(to) ? to : period.to,
  };

  const [rows, reconciliation] = await Promise.all([
    loadTransactionDetail(userId, range),
    loadInventoryGlReconciliation(userId, range),
  ]);

  return (
    <TransactionDetailReport
      from={range.from}
      to={range.to}
      rows={rows}
      reconciliation={reconciliation.rows}
      pendingCount={reconciliation.pendingCount}
      pendingAmount={reconciliation.pendingAmount}
    />
  );
}
