import { and, eq } from "drizzle-orm";

import { CashAccountsView } from "@/components/cash/cash-accounts-view";
import { getActiveOrg } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import type { CashAccountView } from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
} from "@/lib/db/schema";

export default async function CashAccountsPage() {
  const { orgId } = await getActiveOrg();

  const [accounts, documents, glAccounts] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.organizationId, orgId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.cashDocuments.findMany({
      where: eq(cashDocuments.organizationId, orgId),
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
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

