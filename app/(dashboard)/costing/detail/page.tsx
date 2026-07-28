import { TransactionDetailReport } from "@/components/costing/transaction-detail-report";
import { auth } from "@/lib/auth";
import {
  loadInventoryGlReconciliation,
  loadTransactionDetail,
} from "@/lib/costing/transaction-detail";
import { periodRange } from "@/lib/periods/period";

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

  // Анхдагч: энэ сар (нягтлан бодох период).
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = periodRange(today.slice(0, 7));
  const range = {
    from: from && DATE_RE.test(from) ? from : thisMonth.startDate,
    to: to && DATE_RE.test(to) ? to : thisMonth.endDate,
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
