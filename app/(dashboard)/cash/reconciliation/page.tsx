import { and, desc, eq, inArray, lte } from "drizzle-orm";

import {
  CashReconciliationWorkspace,
  type CashFxHistoryRow,
  type CashReconciliationRow,
} from "@/components/cash/cash-reconciliation-workspace";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import { reconciliationStatus } from "@/lib/cash/reconciliation";
import { db } from "@/lib/db";
import {
  bankStatements,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  chartOfAccounts,
  journalVouchers,
} from "@/lib/db/schema";

type SearchParams = Promise<{ asOf?: string }>;

function todayInUlaanbaatar() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export default async function CashReconciliationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const params = await searchParams;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? "")
    ? params.asOf!
    : todayInUlaanbaatar();

  const [
    accounts,
    documents,
    vouchers,
    statements,
    fxRevaluations,
    glAccounts,
  ] =
    await Promise.all([
      db.query.cashAccounts.findMany({
        where: eq(cashAccounts.userId, userId),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      db.query.cashDocuments.findMany({
        where: and(
          eq(cashDocuments.userId, userId),
          lte(cashDocuments.date, asOf)
        ),
      }),
      db.query.journalVouchers.findMany({
        where: and(
          eq(journalVouchers.userId, userId),
          lte(journalVouchers.date, asOf),
          inArray(journalVouchers.status, ["posted", "reversed"])
        ),
        with: { lines: true },
      }),
      db.query.bankStatements.findMany({
        where: eq(bankStatements.userId, userId),
        with: { lines: true },
      }),
      db.query.cashFxRevaluations.findMany({
        where: and(
          eq(cashFxRevaluations.userId, userId),
          lte(cashFxRevaluations.valuationDate, asOf)
        ),
        with: { cashAccount: true },
        orderBy: [
          desc(cashFxRevaluations.valuationDate),
          desc(cashFxRevaluations.createdAt),
        ],
      }),
      db.query.chartOfAccounts.findMany({
        where: and(
          eq(chartOfAccounts.userId, userId),
          eq(chartOfAccounts.isEnabled, true)
        ),
        orderBy: (account, { asc }) => [asc(account.number)],
      }),
    ]);

  const cashBalanceMap = calculateCashBalances(accounts, documents);
  const glBalanceMap = new Map<string, number>();
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      if (!line.cashAccountId) continue;
      glBalanceMap.set(
        line.cashAccountId,
        (glBalanceMap.get(line.cashAccountId) ?? 0) +
          Number(line.debit) -
          Number(line.credit)
      );
    }
  }

  const latestBankBalance = new Map<
    string,
    { date: string; evidenceDate: string; rowNumber: number; balance: number }
  >();
  for (const statement of statements) {
    for (const line of statement.lines) {
      if (line.transactionDate > asOf || line.balance == null) continue;
      const current = latestBankBalance.get(statement.cashAccountId);
      if (
        !current ||
        line.transactionDate > current.date ||
        (line.transactionDate === current.date &&
          line.rowNumber > current.rowNumber)
      ) {
        latestBankBalance.set(statement.cashAccountId, {
          date: line.transactionDate,
          evidenceDate:
            statement.periodEnd && statement.periodEnd <= asOf
              ? statement.periodEnd
              : line.transactionDate,
          rowNumber: line.rowNumber,
          balance: Number(line.balance),
        });
      }
    }
  }

  const latestFxRate = new Map<string, (typeof fxRevaluations)[number]>();
  for (const revaluation of fxRevaluations) {
    if (revaluation.status !== "posted") continue;
    if (!latestFxRate.has(revaluation.cashAccountId))
      latestFxRate.set(revaluation.cashAccountId, revaluation);
  }

  const rows: CashReconciliationRow[] = accounts.map((account) => {
    const cashBalance = cashBalanceMap.get(account.id) ?? 0;
    const glBalance = glBalanceMap.get(account.id) ?? 0;
    const statementBalance = latestBankBalance.get(account.id);
    const rateRow = latestFxRate.get(account.id);
    const closingRate =
      account.currency === "MNT"
        ? 1
        : rateRow
          ? Number(rateRow.closingRate)
          : null;
    const cashBalanceMnt =
      closingRate == null
        ? null
        : Math.round(cashBalance * closingRate * 100) / 100;
    const cashToGlDifference =
      cashBalanceMnt == null
        ? null
        : Math.round((cashBalanceMnt - glBalance) * 100) / 100;
    const bankToCashDifference =
      statementBalance == null
        ? null
        : Math.round((statementBalance.balance - cashBalance) * 100) / 100;

    return {
      id: account.id,
      isActive: account.isActive,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      glAccountNumber: account.glAccountNumber,
      cashBalance,
      bankBalance: statementBalance?.balance ?? null,
      bankBalanceDate: statementBalance?.evidenceDate ?? null,
      closingRate,
      rateSource: rateRow?.rateSource ?? null,
      rateBasis: rateRow?.rateBasis ?? null,
      sourceDate: rateRow?.sourceDate ?? null,
      sourceUrl: rateRow?.sourceUrl ?? null,
      fetchedAt: rateRow?.fetchedAt?.toISOString() ?? null,
      cashBalanceMnt,
      glBalance,
      bankToCashDifference,
      cashToGlDifference,
      status: reconciliationStatus(
        cashToGlDifference,
        bankToCashDifference,
        account.currency === "MNT" || closingRate != null,
        statementBalance == null || statementBalance.evidenceDate === asOf
      ),
    };
  });

  const history: CashFxHistoryRow[] = fxRevaluations.map((item) => ({
    id: item.id,
    cashAccountId: item.cashAccountId,
    revision: item.revision,
    valuationDate: item.valuationDate,
    accountName: item.cashAccount.name,
    currency: item.currency,
    closingRate: Number(item.closingRate),
    rateSource: item.rateSource,
    rateBasis: item.rateBasis,
    sourceDate: item.sourceDate,
    foreignBalance: Number(item.foreignBalance),
    carryingAmount: Number(item.carryingAmount),
    revaluedAmount: Number(item.revaluedAmount),
    adjustmentAmount: Number(item.adjustmentAmount),
    gainLossAccountNumber: item.gainLossAccountNumber,
    voucherId: item.voucherId,
    status: item.status,
  }));

  return (
    <CashReconciliationWorkspace
      key={`${asOf}:${history[0]?.id ?? "none"}`}
      asOf={asOf}
      rows={rows}
      history={history}
      fxAccountOptions={glAccounts.map((account) => ({
        number: account.number,
        name: account.name,
      }))}
    />
  );
}
