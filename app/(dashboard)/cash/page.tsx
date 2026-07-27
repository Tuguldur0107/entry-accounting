import { and, desc, eq, inArray, lte } from "drizzle-orm";

import { CashDashboard } from "@/components/cash/cash-dashboard";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import { reconciliationStatus } from "@/lib/cash/reconciliation";
import type {
  CashAccountView,
  CashDocumentView,
  CashHealthRow,
  CashHealthStatus,
} from "@/lib/cash/types";
import { db } from "@/lib/db";
import {
  bankStatements,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  journalVouchers,
} from "@/lib/db/schema";

function todayInUlaanbaatar() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function classifyHealthStatus(
  cashBalance: number,
  cashToGlDifference: number | null,
  bankToCashDifference: number | null,
  hasRate: boolean,
  isStatementCurrent: boolean
): CashHealthStatus {
  if (cashBalance < -0.01) return "negative";
  const status = reconciliationStatus(
    cashToGlDifference,
    bankToCashDifference,
    hasRate,
    isStatementCurrent
  );
  if (status === "exception") {
    if (cashToGlDifference != null && Math.abs(cashToGlDifference) > 0.01)
      return "cash-gl-diff";
    return "bank-cash-diff";
  }
  return status;
}

function healthAction(status: CashHealthStatus) {
  switch (status) {
    case "negative":
      return {
        actionLabel: "Хасах болгосон гүйлгээг шалгах",
        actionHref: "/cash/transactions",
        explanation:
          "Дотоод cash бүртгэлийн зарлага орлогоос давсан байна. Эхний үлдэгдэл, дутуу орлого эсвэл буруу зарлагыг шалгана.",
      };
    case "cash-gl-diff":
      return {
        actionLabel: "Тулгалт дээр GL зөрүү шалгах",
        actionHref: "/cash/reconciliation",
        explanation:
          "Cash бүртгэл ба GL cash дансны үлдэгдэл зөрсөн байна. CashAccountId-тэй GL бичилт, буцаалт, гар аргаар хийсэн журнал шалгана.",
      };
    case "bank-cash-diff":
      return {
        actionLabel: "Хуулга ба бүртгэлийг тулгах",
        actionHref: "/cash/reconciliation",
        explanation:
          "Банкны хуулгын үлдэгдэл cash бүртгэлээс зөрсөн байна. Банкны шимтгэл, хүү, дутуу импорт, замд яваа гүйлгээг ангилна.",
      };
    case "no-statement":
      return {
        actionLabel: "Дансны хуулга импортлох",
        actionHref: "/cash/statements",
        explanation:
          "Энэ дансанд банкны хуулгын үлдэгдэл байхгүй тул bank-to-cash тулгалт бүрэн хийгдэхгүй.",
      };
    case "missing-rate":
      return {
        actionLabel: "Ханш татаж тэгшитгэх",
        actionHref: "/cash/reconciliation",
        explanation:
          "Валютын дансанд хаалтын ханш байхгүй тул MNT дүн болон GL-тэй тулгах боломжгүй.",
      };
    case "stale-statement":
      return {
        actionLabel: "Сүүлийн хуулга шинэчлэх",
        actionHref: "/cash/statements",
        explanation:
          "Хуулгын нотлох огноо өнөөдрийн байдлаас хуучин байна. Шинэ хуулга импортолж тулгалтаа шинэчилнэ.",
      };
    default:
      return {
        actionLabel: "Тэнцсэн",
        actionHref: "/cash/reconciliation",
        explanation:
          "Cash, GL болон банкны боломжит нотолгоо зөвшөөрөгдөх хязгаарт тэнцсэн байна.",
      };
  }
}

export default async function CashDashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const asOf = todayInUlaanbaatar();

  const [accounts, documents, vouchers, statements, fxRevaluations] =
    await Promise.all([
    db.query.cashAccounts.findMany({
      where: eq(cashAccounts.userId, userId),
      orderBy: (account, { asc }) => [asc(account.name)],
    }),
    db.query.cashDocuments.findMany({
      where: eq(cashDocuments.userId, userId),
      with: { fromAccount: true, toAccount: true },
      orderBy: [desc(cashDocuments.date), desc(cashDocuments.createdAt)],
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
      orderBy: [
        desc(cashFxRevaluations.valuationDate),
        desc(cashFxRevaluations.createdAt),
      ],
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
    currency: document.currency,
    exchangeRate: Number(document.exchangeRate ?? 1),
    baseAmount: Number(document.baseAmount ?? document.amount),
    status: document.status,
    voucherId: document.voucherId,
    sourceVoucherId: document.sourceVoucherId,
  }));

  const mntAccountIds = new Set(
    accounts.filter((account) => account.currency === "MNT").map((account) => account.id)
  );
  const postedToday = documents.filter(
    (document) => document.status === "posted" && document.date === asOf
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

  const chronologicalDocuments = [...documents]
    .filter((document) => document.status === "posted" && document.date <= asOf)
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.documentNo.localeCompare(b.documentNo);
    });

  const healthRows: CashHealthRow[] = accounts.map((account) => {
    let running = Number(account.openingBalance);
    let receipts = 0;
    let payments = 0;
    let negativeTrigger: CashHealthRow["negativeTrigger"] = null;

    for (const document of chronologicalDocuments) {
      let effect = 0;
      const amount = Number(document.amount);
      if (document.toCashAccountId === account.id) {
        effect += amount;
        receipts += amount;
      }
      if (document.fromCashAccountId === account.id) {
        effect -= amount;
        payments += amount;
      }
      if (effect === 0) continue;
      running = Math.round((running + effect) * 100) / 100;
      if (!negativeTrigger && running < -0.01) {
        negativeTrigger = {
          date: document.date,
          documentNo: document.documentNo,
          description: document.description,
          amount: Math.abs(effect),
          balanceAfter: running,
        };
      }
    }

    const cashBalance = balanceMap.get(account.id) ?? 0;
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
    const status = classifyHealthStatus(
      cashBalance,
      cashToGlDifference,
      bankToCashDifference,
      account.currency === "MNT" || closingRate != null,
      statementBalance == null || statementBalance.evidenceDate === asOf
    );
    const action = healthAction(status);

    return {
      id: account.id,
      accountName: account.name,
      accountType: account.accountType,
      currency: account.currency,
      isActive: account.isActive,
      openingBalance: Number(account.openingBalance),
      receipts,
      payments,
      cashBalance,
      cashBalanceMnt,
      glBalance,
      bankBalance: statementBalance?.balance ?? null,
      bankBalanceDate: statementBalance?.evidenceDate ?? null,
      cashToGlDifference,
      bankToCashDifference,
      status,
      actionLabel: action.actionLabel,
      actionHref: action.actionHref,
      explanation: action.explanation,
      negativeTrigger,
    };
  });

  const activeHealthRows = healthRows.filter((row) => row.isActive);
  const issueCount = activeHealthRows.filter((row) => row.status !== "balanced").length;
  const negativeCount = activeHealthRows.filter((row) => row.status === "negative").length;

  return (
    <CashDashboard
      healthRows={healthRows}
      recentDocuments={documentViews.slice(0, 6)}
      summary={{
        totalMnt: accountViews
          .filter((account) => account.currency === "MNT" && account.isActive)
          .reduce((sum, account) => sum + account.balance, 0),
        todayReceipts,
        todayPayments,
        draftCount: documents.filter((document) => document.status === "draft")
          .length,
        issueCount,
        negativeCount,
      }}
    />
  );
}
