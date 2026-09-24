import { and, eq, gte, lte } from "drizzle-orm";

import { CashReportView } from "@/components/cash/cash-report-view";
import { getActiveOrg } from "@/lib/auth";
import { shiftDays } from "@/lib/periods/period";
import { getPeriodSelection } from "@/lib/periods/selection";
import { loadCashBalancesFast } from "@/lib/cash/period-balances";
import {
  calculateCashDetailRows,
  calculateCashFlowCodeSummary,
  calculateCashMovement,
} from "@/lib/cash/balances";
import { db } from "@/lib/db";
import { cashAccounts, cashDocuments, segmentValues } from "@/lib/db/schema";

// `view` = нэг тайлангийн зүсэлт (accounts | flow | detail) — URL-д, refresh
// болон линкээр хадгалагдана (борлуулалт/цалингийн тайлантай ижил).
type SearchParams = Promise<{ start?: string; end?: string; view?: string }>;

export default async function CashReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { start, end, view } = await searchParams;
  const period = await getPeriodSelection();
  const periodStart = start ?? period.from;
  const periodEnd = end ?? period.to;

  // Нээлтийн үлдэгдэл = periodStart-ын өмнөх өдрийн snapshot + delta
  // (баримтыг бүхэлд нь ачаалахгүй); мужийн баримтыг л татна.
  const accounts = await db.query.cashAccounts.findMany({
    where: eq(cashAccounts.organizationId, orgId),
  });
  const [openingBalances, documents, s8Values] = await Promise.all([
    loadCashBalancesFast(orgId, accounts, shiftDays(periodStart, -1)),
    db.query.cashDocuments.findMany({
      where: and(
        eq(cashDocuments.organizationId, orgId),
        gte(cashDocuments.date, periodStart),
        lte(cashDocuments.date, periodEnd)
      ),
    }),
    // S8 мөнгөн урсгалын кодын нэрс — нэгтгэлийн бүлгийн шошго.
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.segmentId, 8)
      ),
      columns: { code: true, name: true },
    }),
  ]);

  const rows = calculateCashMovement(
    accounts,
    documents,
    periodStart,
    periodEnd,
    openingBalances
  );
  const detailRows = calculateCashDetailRows(
    accounts,
    documents,
    periodStart,
    periodEnd,
    openingBalances
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
      view={view === "flow" || view === "detail" ? view : "accounts"}
    />
  );
}
