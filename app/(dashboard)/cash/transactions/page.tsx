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
  arApDocuments,
  chartOfAccounts,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { backfillCashDraftsForUser } from "@/lib/cash/sync-voucher";

type SearchParams = Promise<{
  start?: string;
  end?: string;
  type?: string;
  status?: string;
  arap?: string;
}>;

function mainAccountOf(accountNumber: string) {
  const parts = accountNumber.split(".");
  return parts.length === 10 ? parts[2] : accountNumber;
}

export default async function CashTransactionsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { start, end, type, status, arap } = await searchParams;

  // Surface any posted GL journals that touch a cash account but don't yet
  // have a cash document — including historical ones. Idempotent + best
  // effort; runs before the document query so new drafts show immediately.
  await backfillCashDraftsForUser(userId);

  // Date range filters the document list at the DB level. `type` (receipt /
  // payment / transfer) is applied client-side so switching tabs doesn't
  // require a round-trip, and the summary totals still see the full set.
  const dateFilters = [
    start ? gte(cashDocuments.date, start) : undefined,
    end ? lte(cashDocuments.date, end) : undefined,
  ].filter(Boolean);

  const [accounts, documents, glAccounts, cashFlowOptions, segConfigs, arApTarget] =
    await Promise.all([
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
    db.query.segmentConfigs.findMany({ where: eq(segmentConfigs.userId, userId) }),
    arap
      ? db.query.arApDocuments.findFirst({
          where: and(eq(arApDocuments.id, arap), eq(arApDocuments.userId, userId)),
          with: { counterparty: true },
        })
      : Promise.resolve(null),
  ]);

  const segConfigMap = new Map(segConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

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
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate ?? 1),
    baseAmount: Number(document.baseAmount ?? document.amount),
    status: document.status,
    voucherId: document.voucherId,
    sourceVoucherId: document.sourceVoucherId,
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
      initialStatus={status}
      showToolbar
      activeSegIds={activeSegIds}
      initialArApSettlement={
        arApTarget
          ? {
              id: arApTarget.id,
              documentNo: arApTarget.documentNo,
              documentType: arApTarget.documentType as "ar_invoice" | "ap_bill",
              counterpartyName: arApTarget.counterparty.name,
              date: arApTarget.date,
              currency: arApTarget.currency,
              controlAccountNumber: mainAccountOf(arApTarget.controlAccountNumber),
              balance:
                Math.round(
                  (Number(arApTarget.totalAmount) - Number(arApTarget.paidAmount)) *
                    100
                ) / 100,
              description: arApTarget.description,
            }
          : null
      }
    />
  );
}
