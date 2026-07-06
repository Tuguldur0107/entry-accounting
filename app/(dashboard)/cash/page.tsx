import { desc, eq } from "drizzle-orm";

import { CashDashboard } from "@/components/cash/cash-dashboard";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import type { CashAccountView, CashDocumentView } from "@/lib/cash/types";
import { db } from "@/lib/db";
import { cashAccounts, cashDocuments } from "@/lib/db/schema";

export default async function CashDashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [accounts, documents] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.cashDocuments.findMany({
      where: eq(cashDocuments.userId, userId),
      with: { fromAccount: true, toAccount: true },
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
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
    sourceVoucherId: document.sourceVoucherId,
  }));

  const today = new Date().toISOString().slice(0, 10);
  const mntAccountIds = new Set(
    accounts.filter((account) => account.currency === "MNT").map((account) => account.id)
  );
  const postedToday = documents.filter(
    (document) => document.status === "posted" && document.date === today
  );

  const todayReceipts = postedToday
    .filter(
      (document) =>
        document.documentType === "receipt" &&
        !!document.toCashAccountId &&
        mntAccountIds.has(document.toCashAccountId)
    )
    .reduce((sum, document) => sum + Number(document.amount), 0);
  const todayPayments = postedToday
    .filter(
      (document) =>
        document.documentType === "payment" &&
        !!document.fromCashAccountId &&
        mntAccountIds.has(document.fromCashAccountId)
    )
    .reduce((sum, document) => sum + Number(document.amount), 0);

  return (
    <CashDashboard
      accounts={accountViews}
      recentDocuments={documentViews.slice(0, 12)}
      summary={{
        totalMnt: accountViews
          .filter((account) => account.currency === "MNT" && account.isActive)
          .reduce((sum, account) => sum + account.balance, 0),
        todayReceipts,
        todayPayments,
        draftCount: documents.filter((document) => document.status === "draft")
          .length,
      }}
    />
  );
}

