import { and, eq } from "drizzle-orm";

import { CashAccountsView } from "@/components/cash/cash-accounts-view";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import type { CashAccountView } from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
} from "@/lib/db/schema";

export default async function CashAccountsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [accounts, documents, glAccounts] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.cashDocuments.findMany({
      where: eq(cashDocuments.userId, userId),
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
  ]);

  const balanceMap = calculateCashBalances(accounts, documents);
  const accountViews: CashAccountView[] = accounts.map((account) => ({
    ...account,
    openingBalance: Number(account.openingBalance),
    balance: balanceMap.get(account.id) ?? 0,
  }));

  return (
    <CashAccountsView
      accounts={accountViews}
      glAccounts={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
    />
  );
}

