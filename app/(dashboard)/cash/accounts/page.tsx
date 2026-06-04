import { db } from "@/lib/db";
import { bankAccounts, chartOfAccounts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { BankAccounts } from "@/components/cash/bank-accounts";
import { CASH_ACCOUNT_PREFIXES } from "@/lib/constants/cash";

export default async function CashAccountsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [accounts, coa] = await Promise.all([
    db.query.bankAccounts.findMany({
      where: eq(bankAccounts.userId, userId),
      orderBy: (a, { asc }) => [asc(a.name)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
  ]);

  // Зөвхөн кассын/банкны бүлгийн данс (10xx, 11xx)
  const cashCoa = coa
    .filter((a) => CASH_ACCOUNT_PREFIXES.some((p) => a.number.startsWith(p)))
    .map((a) => ({ number: a.number, name: a.name }));

  return <BankAccounts accounts={accounts} cashCoa={cashCoa} />;
}
