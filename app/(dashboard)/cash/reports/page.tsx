import { eq } from "drizzle-orm";

import { CashReportView } from "@/components/cash/cash-report-view";
import { auth } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import {
  calculateCashDetailRows,
  calculateCashMovement,
} from "@/lib/cash/balances";
import { db } from "@/lib/db";
import { cashAccounts, cashDocuments } from "@/lib/db/schema";

type SearchParams = Promise<{ start?: string; end?: string }>;

export default async function CashReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end } = await searchParams;
  const period = await getPeriodSelection();
  const periodStart = start ?? period.from;
  const periodEnd = end ?? period.to;

  // The movement calc needs documents before + within the period (opening
  // balance is carried from prior postings), so we load all posted-or-any
  // documents and let the helper bucket them by date.
  const [accounts, documents] = await Promise.all([
    db.query.cashAccounts.findMany({ where: eq(cashAccounts.userId, userId) }),
    db.query.cashDocuments.findMany({ where: eq(cashDocuments.userId, userId) }),
  ]);

  const rows = calculateCashMovement(accounts, documents, periodStart, periodEnd);
  const detailRows = calculateCashDetailRows(
    accounts,
    documents,
    periodStart,
    periodEnd
  );

  return (
    <CashReportView
      rows={rows}
      detailRows={detailRows}
      periodStart={periodStart}
      periodEnd={periodEnd}
    />
  );
}
