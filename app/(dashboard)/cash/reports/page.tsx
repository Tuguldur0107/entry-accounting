import { db } from "@/lib/db";
import { bankTransactions, bankAccounts } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { eq, and } from "drizzle-orm";
import { CashReports } from "@/components/cash/cash-reports";

export default async function CashReportsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [txns, banks] = await Promise.all([
    db.query.bankTransactions.findMany({
      where: and(
        eq(bankTransactions.userId, userId),
        eq(bankTransactions.status, "posted")
      ),
    }),
    db.query.bankAccounts.findMany({
      where: eq(bankAccounts.userId, userId),
      orderBy: (a, { asc }) => [asc(a.name)],
    }),
  ]);

  return <CashReports txns={txns} banks={banks} />;
}
