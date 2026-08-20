import { and, eq } from "drizzle-orm";

import { CashReportView } from "@/components/cash/cash-report-view";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import {
  calculateCashDetailRows,
  calculateCashFlowCodeSummary,
  calculateCashMovement,
} from "@/lib/cash/balances";
import { db } from "@/lib/db";
import { cashAccounts, cashDocuments, segmentValues } from "@/lib/db/schema";

type SearchParams = Promise<{ start?: string; end?: string }>;

export default async function CashReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { start, end } = await searchParams;
  const period = await getPeriodSelection();
  const periodStart = start ?? period.from;
  const periodEnd = end ?? period.to;

  // The movement calc needs documents before + within the period (opening
  // balance is carried from prior postings), so we load all posted-or-any
  // documents and let the helper bucket them by date.
  const [accounts, documents, s8Values] = await Promise.all([
    db.query.cashAccounts.findMany({ where: eq(cashAccounts.organizationId, orgId) }),
    db.query.cashDocuments.findMany({ where: eq(cashDocuments.organizationId, orgId) }),
    // S8 мөнгөн урсгалын кодын нэрс — нэгтгэлийн бүлгийн шошго.
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.segmentId, 8)
      ),
      columns: { code: true, name: true },
    }),
  ]);

  const rows = calculateCashMovement(accounts, documents, periodStart, periodEnd);
  const detailRows = calculateCashDetailRows(
    accounts,
    documents,
    periodStart,
    periodEnd
  );
  const codeNames = new Map(s8Values.map((value) => [value.code, value.name]));
  const flowRows = calculateCashFlowCodeSummary(
    documents,
    periodStart,
    periodEnd,
    codeNames
  );

  return (
    <CashReportView
      rows={rows}
      detailRows={detailRows}
      flowRows={flowRows}
      cashFlowNames={Object.fromEntries(codeNames)}
      periodStart={periodStart}
      periodEnd={periodEnd}
    />
  );
}
