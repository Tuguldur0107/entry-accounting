import { and, desc, eq } from "drizzle-orm";

import {
  BankStatementImport,
  type BankStatementSummary,
} from "@/components/cash/bank-statement-import";
import { getActiveOrg } from "@/lib/auth";
import { buildCashAccountCodeRules } from "@/lib/cash/account-code-validation";
import { calculateCashBalances } from "@/lib/cash/balances";
import type { CashAccountView } from "@/lib/cash/types";
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
  const { orgId } = await getActiveOrg();

  const [
    accounts,
    cashDocumentRows,
    glAccounts,
    configs,
    values,
    statements,
  ] = await Promise.all([
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
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
    }),
    db.query.bankStatements.findMany({
      where: eq(bankStatements.organizationId, orgId),
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

  // Хадгалах үеийн validator-тай ЯГ НЭГ дүрэм (single source of truth):
  //   сегментийн түвшин — settings-д асаасан бүх сегмент (S3 үргэлж),
  //   утга/дансны түвшин — тухайн утгын Cash модулийн toggle.
  // Ингэснээр dropdown-д харагдсан бүх утга validation-ийг давна.
  const rules = buildCashAccountCodeRules(configs, values, glAccounts);
  const activeSegIds = rules.activeSegIds;

  const segmentOptions: Record<number, SegOption[]> = {};
  for (const segmentId of activeSegIds) {
    const allowed = rules.allowedValues.get(segmentId) ?? new Set<string>();
    segmentOptions[segmentId] =
      segmentId === 3
        ? glAccounts
            .filter((account) => allowed.has(account.number))
            .map((account) => ({ code: account.number, name: account.name }))
        : values
            .filter(
              (value) => value.segmentId === segmentId && allowed.has(value.code)
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

