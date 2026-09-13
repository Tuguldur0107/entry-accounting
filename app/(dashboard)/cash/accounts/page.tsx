import { and, eq } from "drizzle-orm";

import { CashAccountsView } from "@/components/cash/cash-accounts-view";
import { getActiveOrg } from "@/lib/auth";
import { loadCashBalancesFast } from "@/lib/cash/period-balances";
import type { CashAccountView } from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  cashAccounts,
  chartOfAccounts,
} from "@/lib/db/schema";

export default async function CashAccountsPage() {
  const { orgId } = await getActiveOrg();

  const [accounts, glAccounts] = await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.organizationId, orgId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
  ]);

  // Snapshot + delta — баримтыг JS-д ачаалахгүй (lib/cash/period-balances.ts).
  const balanceMap = await loadCashBalancesFast(orgId, accounts);
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

