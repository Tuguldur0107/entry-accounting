import { and, desc, eq, gte, lte } from "drizzle-orm";

import { CashDocumentsView } from "@/components/cash/cash-documents-view";
import { auth } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import {
  loadCashTransactionOptions,
  toCashDocumentView,
} from "@/lib/cash/load-options";
import { db } from "@/lib/db";
import { cashDocuments } from "@/lib/db/schema";
import { backfillCashDraftsForUser } from "@/lib/cash/sync-voucher";

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
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end, type, status, arap } = await searchParams;
  // Topbar-ийн периодын сонголт — URL-д ил огноо байхгүй үед хэрэглэнэ.
  const period = await getPeriodSelection();
  const rangeStart = start ?? period.from;
  const rangeEnd = end ?? period.to;

  // Surface any posted GL journals that touch a cash account but don't yet
  // have a cash document — including historical ones. Idempotent + best
  // effort; runs before the document query so new drafts show immediately.
  await backfillCashDraftsForUser(userId);

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
    loadCashTransactionOptions(userId),
    db.query.cashDocuments.findMany({
      where: and(eq(cashDocuments.userId, userId), ...dateFilters),
      with: { fromAccount: true, toAccount: true },
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
    }),
  ]);

  return (
    <CashDocumentsView
      documents={documents.map(toCashDocumentView)}
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
