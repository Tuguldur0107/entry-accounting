import { eq } from "drizzle-orm";

import { CashReportView } from "@/components/cash/cash-report-view";
import { auth } from "@/lib/auth";
import { calculateCashMovement } from "@/lib/cash/balances";
import { db } from "@/lib/db";
import { cashAccounts, cashDocuments } from "@/lib/db/schema";

type SearchParams = Promise<{ start?: string; end?: string }>;

function defaultMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

export default async function CashReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end } = await searchParams;
  const defaults = defaultMonthRange();
  const periodStart = start ?? defaults.start;
  const periodEnd = end ?? defaults.end;

  // The movement calc needs documents before + within the period (opening
  // balance is carried from prior postings), so we load all posted-or-any
  // documents and let the helper bucket them by date.
  const [accounts, documents] = await Promise.all([
    db.query.cashAccounts.findMany({ where: eq(cashAccounts.userId, userId) }),
    db.query.cashDocuments.findMany({ where: eq(cashDocuments.userId, userId) }),
  ]);

  const rows = calculateCashMovement(accounts, documents, periodStart, periodEnd);

  return (
    <CashReportView rows={rows} periodStart={periodStart} periodEnd={periodEnd} />
  );
}
