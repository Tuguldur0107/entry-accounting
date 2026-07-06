import { and, desc, eq, gte, lte } from "drizzle-orm";

import { CashDocumentsView } from "@/components/cash/cash-documents-view";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import type {
  CashAccountView,
  CashDocumentView,
} from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  segmentValues,
} from "@/lib/db/schema";

type SearchParams = Promise<{ start?: string; end?: string; type?: string }>;

export default async function CashTransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end, type } = await searchParams;

  // Date range filters the document list at the DB level. `type` (receipt /
  // payment / transfer) is applied client-side so switching tabs doesn't
  // require a round-trip, and the summary totals still see the full set.
  const dateFilters = [
    start ? gte(cashDocuments.date, start) : undefined,
    end ? lte(cashDocuments.date, end) : undefined,
  ].filter(Boolean);

  const [accounts, documents, glAccounts, cashFlowOptions] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.cashDocuments.findMany({
      where: and(eq(cashDocuments.userId, userId), ...dateFilters),
      with: { fromAccount: true, toAccount: true },
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
        eq(segmentValues.segmentId, 8),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.code)],
    }),
  ]);

  const balanceMap = calculateCashBalances(accounts, documents);
  const accountViews: CashAccountView[] = accounts.map((account) => ({
    ...account,
    openingBalance: Number(account.openingBalance),
    balance: balanceMap.get(account.id) ?? 0,
  }));
  const documentViews: CashDocumentView[] = documents.map((document) => ({
    id: document.id,
    documentNo: document.documentNo,
    documentType: document.documentType,
    date: document.date,
    fromCashAccountId: document.fromCashAccountId,
    fromAccountName: document.fromAccount?.name ?? null,
    toCashAccountId: document.toCashAccountId,
    toAccountName: document.toAccount?.name ?? null,
    counterAccountNumber: document.counterAccountNumber,
    cashFlowCode: document.cashFlowCode,
    counterparty: document.counterparty,
    description: document.description,
    amount: Number(document.amount),
    status: document.status,
    voucherId: document.voucherId,
  }));

  return (
    <CashDocumentsView
      documents={documentViews}
      accounts={accountViews}
      glAccounts={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
      cashFlowOptions={cashFlowOptions.map((option) => ({
        code: option.code,
        name: option.name,
      }))}
      initialType={type}
      showToolbar
    />
  );
}

