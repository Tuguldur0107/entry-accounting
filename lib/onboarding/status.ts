// Анхны нэвтрүүлэлтийн ТӨЛӨВ — DB давхарга ("use server" БИШ; tools.ts дуудна).
// Цэвэр логик (шат, форматлалт) lib/onboarding/guide.ts-д.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, count, desc, eq, like, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  arApDocuments,
  cashAccounts,
  chartOfAccounts,
  counterparties,
  employees,
  fixedAssets,
  inventoryItems,
  journalLines,
  journalVouchers,
  organizations,
  warehouses,
} from "@/lib/db/schema";
import {
  OPENING_DIFFERENCE_ACCOUNT,
  OPENING_REF,
  type OnboardingStatus,
} from "@/lib/onboarding/guide";

/** Баримтын зам — Next server нь repo-ийн үндсээс ажилладаг (Railway railpack `/app`). */
const ONBOARDING_DOC_PATH = path.join(
  process.cwd(),
  "docs",
  "deployment",
  "onboarding.md"
);

/**
 * docs/deployment/onboarding.md-г уншина — tool нь §2/§3/§4-ийг ЭНДЭЭС үгчлэн
 * өгдөг (нэг эх сурвалж). Файл олдохгүй бол null (дуудагч богино fallback өгнө).
 */
export async function readOnboardingDoc(): Promise<string | null> {
  try {
    return await readFile(ONBOARDING_DOC_PATH, "utf8");
  } catch {
    return null;
  }
}

async function countWhere(
  table:
    | typeof counterparties
    | typeof inventoryItems
    | typeof warehouses
    | typeof cashAccounts
    | typeof employees
    | typeof fixedAssets,
  orgId: string
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(table)
    .where(eq(table.organizationId, orgId));
  return Number(row?.value ?? 0);
}

export async function loadOnboardingStatus(orgId: string): Promise<OnboardingStatus> {
  const [
    organization,
    enabledAccounts,
    counterpartyCount,
    itemCount,
    warehouseCount,
    cashCount,
    employeeCount,
    assetCount,
    postedVouchers,
    openingVoucher,
    summaryDocs,
    diffDrafts,
    adjustments,
    differenceAccount,
    closedPeriods,
  ] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true },
    }),
    db
      .select({ value: count() })
      .from(chartOfAccounts)
      .where(
        and(eq(chartOfAccounts.organizationId, orgId), eq(chartOfAccounts.isEnabled, true))
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    countWhere(counterparties, orgId),
    countWhere(inventoryItems, orgId),
    countWhere(warehouses, orgId),
    countWhere(cashAccounts, orgId),
    countWhere(employees, orgId),
    countWhere(fixedAssets, orgId),
    db
      .select({ value: count() })
      .from(journalVouchers)
      .where(
        and(eq(journalVouchers.organizationId, orgId), eq(journalVouchers.status, "posted"))
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db.query.journalVouchers.findFirst({
      where: and(
        eq(journalVouchers.organizationId, orgId),
        like(journalVouchers.externalRef, `${OPENING_REF.balance}%`)
      ),
      columns: { date: true, status: true, documentNo: true },
      orderBy: [desc(journalVouchers.createdAt)],
    }),
    db
      .select({ value: count() })
      .from(arApDocuments)
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          like(arApDocuments.externalRef, `${OPENING_REF.summary}%`),
          sql`${arApDocuments.status} <> 'reversed'`
        )
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db
      .select({ value: count() })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          like(journalVouchers.externalRef, `${OPENING_REF.diff}%`),
          eq(journalVouchers.status, "draft")
        )
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    db
      .select({ value: count() })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          like(journalVouchers.externalRef, `${OPENING_REF.adjustment}%`)
        )
      )
      .then((rows) => Number(rows[0]?.value ?? 0)),
    // Зөрүүний данс: НЭРЭЭР (байгууллага дугаарыг өөрчилсөн байж болно),
    // дараа нь стандарт дугаараар. Идэвхтэй данс л тоологдоно.
    db.query.chartOfAccounts.findFirst({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true),
        sql`(${chartOfAccounts.name} = ${OPENING_DIFFERENCE_ACCOUNT.name} or ${chartOfAccounts.number} = ${OPENING_DIFFERENCE_ACCOUNT.number})`
      ),
      columns: { number: true, name: true },
      orderBy: [sql`case when ${chartOfAccounts.name} = ${OPENING_DIFFERENCE_ACCOUNT.name} then 0 else 1 end`],
    }),
    db.query.accountingPeriods.findMany({
      where: and(
        eq(accountingPeriods.organizationId, orgId),
        eq(accountingPeriods.status, "closed")
      ),
      columns: { code: true },
      orderBy: [desc(accountingPeriods.code)],
    }),
  ]);

  const cutoffCode = openingVoucher?.date.slice(0, 7) ?? null;
  // Зөрүүний дансны батлагдсан GL үлдэгдэл (ENT-019) — SQL нийлбэр.
  let differenceBalance = 0;
  if (differenceAccount) {
    const mainExpr = sql`case when position('.' in ${journalLines.accountNumber}) > 0 then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;
    const [row] = await db
      .select({ net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalVouchers, eq(journalLines.voucherId, journalVouchers.id))
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          sql`${journalVouchers.status} in ('posted', 'reversed')`,
          sql`${mainExpr} = ${differenceAccount.number}`
        )
      );
    differenceBalance = Number(row?.net ?? 0);
  }
  return {
    organizationName: organization?.name ?? "—",
    counts: {
      enabledAccounts,
      counterparties: counterpartyCount,
      inventoryItems: itemCount,
      warehouses: warehouseCount,
      cashAccounts: cashCount,
      employees: employeeCount,
      fixedAssets: assetCount,
      postedVouchers,
    },
    openingVoucher: openingVoucher
      ? {
          date: openingVoucher.date,
          status: openingVoucher.status,
          documentNo: openingVoucher.documentNo ?? null,
        }
      : null,
    openingSummaryDocs: summaryDocs,
    openingDiffDrafts: diffDrafts,
    openingAdjustments: adjustments,
    differenceAccount: differenceAccount
      ? { number: differenceAccount.number, name: differenceAccount.name }
      : null,
    differenceBalance,
    cutoffPeriodClosed:
      cutoffCode != null && closedPeriods.some((period) => period.code === cutoffCode),
    latestClosedPeriod: closedPeriods[0]?.code ?? null,
  };
}
