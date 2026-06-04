import { db } from "@/lib/db";
import { bankTransactions, bankAccounts, chartOfAccounts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { desc } from "drizzle-orm";
import { TransactionsList } from "@/components/cash/transactions-list";

export default async function CashTransactionsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [txns, banks, coa] = await Promise.all([
    db.query.bankTransactions.findMany({
      where: eq(bankTransactions.userId, userId),
      with: { bankAccount: true },
      orderBy: [desc(bankTransactions.date), desc(bankTransactions.createdAt)],
    }),
    db.query.bankAccounts.findMany({
      where: and(eq(bankAccounts.userId, userId), eq(bankAccounts.isActive, true)),
      orderBy: (a, { asc }) => [asc(a.name)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(eq(chartOfAccounts.userId, userId), eq(chartOfAccounts.isEnabled, true)),
      orderBy: (a, { asc }) => [asc(a.number)],
    }),
  ]);

  return (
    <TransactionsList
      txns={txns}
      banks={banks}
      coa={coa.map((a) => ({ number: a.number, name: a.name }))}
    />
  );
}
