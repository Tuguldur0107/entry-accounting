import { and, desc, eq, gte, lte } from "drizzle-orm";

import { CashDocumentsView } from "@/components/cash/cash-documents-view";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import {
  CASH_DOCUMENT_LIST_WITH,
  loadCashTransactionOptions,
  toCashDocumentView,
} from "@/lib/cash/load-options";
import { db } from "@/lib/db";
import { cashDocuments } from "@/lib/db/schema";
import { backfillCashDraftsForUser } from "@/lib/cash/sync-voucher";
import { ensureCashFlowSegmentValues } from "@/lib/gl/segment-sync";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  type?: string;
  status?: string;
  arap?: string;
}>;

export default async function CashTransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId, userId } = await getActiveOrg();
  const { start, end, type, status, arap } = await searchParams;
  // Topbar-ийн периодын сонголт — URL-д ил огноо байхгүй үед хэрэглэнэ.
  const period = await getPeriodSelection();
  const rangeStart = start ?? period.from;
  const rangeEnd = end ?? period.to;

  // Surface any posted GL journals that touch a cash account but don't yet
  // have a cash document — including historical ones. Idempotent + best
  // effort; runs before the document query so new drafts show immediately.
  await backfillCashDraftsForUser(orgId);
  // SIM2-014: S8 ангилалгүй хуучин байгууллагад стандарт жагсаалт (идемпотент).
  await ensureCashFlowSegmentValues(orgId, userId).catch(() => 0);

  // Date range filters the document list at the DB level. `type` (receipt /
  // payment / transfer) is applied client-side so switching tabs doesn't
  // require a round-trip, and the summary totals still see the full set.
  const dateFilters = [
    gte(cashDocuments.date, rangeStart),
    lte(cashDocuments.date, rangeEnd),
  ];

  // Сонголтын өгөгдөл (данс, GL данс, урсгал, нээлттэй АР/АП, сегмент) —
  // cash-new панелийн server action-тай НЭГ ачаалагч (lib/cash/load-options).
  const [options, documents] = await Promise.all([
    loadCashTransactionOptions(orgId),
    db.query.cashDocuments.findMany({
      where: and(eq(cashDocuments.organizationId, orgId), ...dateFilters),
      with: CASH_DOCUMENT_LIST_WITH,
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
    }),
  ]);
  // МГ нэр багана — S8 утгын нэр кодоор.
  const cashFlowNames = new Map(
    options.cashFlowOptions.map((option) => [option.code, option.name])
  );

  return (
    <CashDocumentsView
      documents={documents.map((document) =>
        toCashDocumentView(document, cashFlowNames)
      )}
      accounts={options.accounts}
      glAccounts={options.glAccounts}
      initialType={type}
      initialStatus={status}
      showToolbar
      // `?arap=` deep link (AR/AP module's "Төлөх" button): the view opens
      // the cash-new panel with this settlement preselected. A settled or
      // closed document simply isn't in the open list — no panel then.
      initialArApDocumentId={
        options.arApOpenDocuments.some((doc) => doc.id === arap)
          ? arap
          : null
      }
    />
  );
}
