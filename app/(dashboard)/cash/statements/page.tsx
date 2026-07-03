import { and, desc, eq } from "drizzle-orm";

import {
  BankStatementImport,
  type BankStatementSummary,
} from "@/components/cash/bank-statement-import";
import { auth } from "@/lib/auth";
import { calculateCashBalances } from "@/lib/cash/balances";
import type { CashAccountView } from "@/lib/cash/types";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  bankStatements,
  cashAccounts,
  cashDocuments,
  chartOfAccounts,
  segmentConfigs,
  segmentValues,
} from "@/lib/db/schema";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

export default async function BankStatementsPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [
    accounts,
    cashDocumentRows,
    glAccounts,
    configs,
    values,
    statements,
  ] = await Promise.all([
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
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
    }),
    db.query.bankStatements.findMany({
      where: eq(bankStatements.userId, userId),
      with: { cashAccount: true },
      orderBy: [desc(bankStatements.createdAt)],
    }),
  ]);

  const balanceMap = calculateCashBalances(accounts, cashDocumentRows);
  const accountViews: CashAccountView[] = accounts.map((account) => ({
    ...account,
    openingBalance: Number(account.openingBalance),
    balance: balanceMap.get(account.id) ?? 0,
  }));

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  // modules="" (хоосон) бол тухайн сегментийн defaultModules-ийг ашиглана —
  // settings toggle нь modules заалгүй insert хийдэг байсан үеийн өгөгдөлтэй нийцнэ.
  const activeSegIds = SEGMENT_DEFS.filter((definition) => {
    const config = configMap.get(definition.id);
    const enabled = config?.isEnabled ?? true;
    const modules = config?.modules
      ? config.modules.split(",")
      : definition.defaultModules;
    return enabled && modules.includes("cash");
  }).map((definition) => definition.id);

  const cashGlAccounts = glAccounts.filter(
    (account) => !account.modules || account.modules.split(",").includes("cash")
  );
  const segmentOptions: Record<number, SegOption[]> = {};
  for (const segmentId of activeSegIds) {
    segmentOptions[segmentId] =
      segmentId === 3
        ? cashGlAccounts.map((account) => ({
            code: account.number,
            name: account.name,
          }))
        : values
            .filter(
              (value) =>
                value.segmentId === segmentId &&
                (!value.modules || value.modules.split(",").includes("cash"))
            )
            .map((value) => ({ code: value.code, name: value.name }));
  }

  const defaultSegments: Record<number, string> = {};
  for (const segmentId of activeSegIds) {
    const options = segmentOptions[segmentId] ?? [];
    if (options.length === 1) defaultSegments[segmentId] = options[0].code;
  }
  if (
    activeSegIds.includes(9) &&
    segmentOptions[9]?.some((option) => option.code === "CA")
  )
    defaultSegments[9] = "CA";

  const statementViews: BankStatementSummary[] = statements.map(
    (statement) => ({
      id: statement.id,
      fileName: statement.fileName,
      bankName: statement.bankName ?? statement.cashAccount.bankName ?? "",
      cashAccountName: statement.cashAccount.name,
      periodStart: statement.periodStart ?? "",
      periodEnd: statement.periodEnd ?? "",
      rowCount: statement.rowCount,
      totalIncome: Number(statement.totalIncome),
      totalExpense: Number(statement.totalExpense),
      createdAt: statement.createdAt.toLocaleString("mn-MN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    })
  );

  return (
    <BankStatementImport
      accounts={accountViews}
      activeSegIds={activeSegIds}
      segmentOptions={segmentOptions}
      defaultSegments={defaultSegments}
      statements={statementViews}
    />
  );
}

