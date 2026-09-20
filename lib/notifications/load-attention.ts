// Scheduler-ийн оролт — байгууллага бүрд AttentionInput-ыг SQL нэгтгэлээр
// ачаална (П28: ваучер/баримт JS-д ачаалахгүй — count/min л). Нүүрний самбар
// өөрийн ачаалсан датанаасаа ижил бүтэц үүсгэдэг (app/(dashboard)/page.tsx);
// дүрмүүд нь attention.ts-д НЭГ.

import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, min, or, sql } from "drizzle-orm";

import { loadStoredRate } from "@/lib/cash/rate-store";
import { db } from "@/lib/db";
import {
  accountingPeriods,
  apiTokens,
  arApDocuments,
  bankStatementLines,
  bankStatements,
  cashAccounts,
  cashDocuments,
  cashFxRevaluations,
  fixedAssets,
  inventoryItems,
  inventoryMovements,
  journalVouchers,
  warehouses,
} from "@/lib/db/schema";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";
import { deploymentLicenseStatus } from "@/lib/licensing/license";
import { getEntitlements } from "@/lib/billing/load";
import { periodCodeOf, periodRange, previousPeriodCode, shiftDays } from "@/lib/periods/period";
import { computeTaxDeadlines } from "@/lib/tax/calendar";

import { TOKEN_ALERT_DAYS, type AttentionInput, type DraftSummary } from "./attention";

type DatedDraftTable =
  | typeof journalVouchers
  | typeof arApDocuments
  | typeof cashDocuments
  | typeof inventoryMovements;

async function draftSummary(
  orgId: string,
  table: DatedDraftTable,
  module: DraftSummary["module"]
): Promise<DraftSummary> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int`, oldest: min(table.date) })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.status, "draft")));
  return { module, count: row?.n ?? 0, oldestDate: row?.oldest ?? null };
}

/** Тулгагдаагүй мөртэй хуулгууд (импортын огноо УБ-аар). */
async function loadBankUnmatched(orgId: string): Promise<AttentionInput["bankUnmatched"]> {
  const rows = await db
    .select({
      statementId: bankStatements.id,
      fileName: bankStatements.fileName,
      createdAt: bankStatements.createdAt,
      n: sql<number>`count(*)::int`,
    })
    .from(bankStatementLines)
    .innerJoin(bankStatements, eq(bankStatementLines.statementId, bankStatements.id))
    .where(and(eq(bankStatements.organizationId, orgId), isNull(bankStatementLines.cashDocumentId)))
    .groupBy(bankStatements.id, bankStatements.fileName, bankStatements.createdAt);
  return rows.map((row) => ({
    statementId: row.statementId,
    fileName: row.fileName,
    count: row.n,
    importedAt: row.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Ulaanbaatar" }),
  }));
}

/** Валют: идэвхтэй валютын данс, сарын эцсийн тэгшитгэл, өнөөдрийн ханш. */
async function loadFx(orgId: string, today: string): Promise<AttentionInput["fx"]> {
  const foreign = await db.query.cashAccounts.findMany({
    where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
    columns: { id: true, currency: true },
  });
  const accounts = foreign.filter((a) => a.currency !== "MNT");
  if (accounts.length === 0)
    return { foreignAccounts: 0, revaluedThisMonth: true, missingRateCurrencies: [] };
  const { endDate } = periodRange(periodCodeOf(today));
  const [reval] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(cashFxRevaluations)
    .where(
      and(
        eq(cashFxRevaluations.organizationId, orgId),
        eq(cashFxRevaluations.valuationDate, endDate),
        isNotNull(cashFxRevaluations.voucherId)
      )
    );
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const missing: string[] = [];
  for (const currency of currencies) {
    try {
      const stored = await loadStoredRate({ currency, date: today, source: "mongolbank" });
      if (!stored || stored.rateDate !== today) missing.push(currency);
    } catch {
      missing.push(currency);
    }
  }
  return {
    foreignAccounts: accounts.length,
    revaluedThisMonth: (reval?.n ?? 0) > 0,
    missingRateCurrencies: missing,
  };
}

/** Хасах үлдэгдэлтэй бараа × агуулах (snapshot replay — lib/inventory/period-balances). */
async function loadNegativeStock(orgId: string): Promise<AttentionInput["negativeStock"]> {
  const balances = await loadQtyBalancesFast(orgId);
  const negative = [...balances.entries()].filter(([, qty]) => qty < -0.00005);
  if (negative.length === 0) return [];
  const itemIds = [...new Set(negative.map(([key]) => key.split("|")[0]))];
  const warehouseIds = [...new Set(negative.map(([key]) => key.split("|")[1]))];
  const [items, whs] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: inArray(inventoryItems.id, itemIds),
      columns: { id: true, name: true },
    }),
    db.query.warehouses.findMany({
      where: inArray(warehouses.id, warehouseIds),
      columns: { id: true, name: true },
    }),
  ]);
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  const whName = new Map(whs.map((w) => [w.id, w.name]));
  return negative.map(([key, qty]) => {
    const [itemId, warehouseId] = key.split("|");
    return {
      itemId,
      itemName: itemName.get(itemId) ?? itemId,
      warehouseId,
      warehouseName: whName.get(warehouseId) ?? warehouseId,
      qty: Math.round(qty * 10000) / 10000,
    };
  });
}

export async function loadAttentionInput(
  orgId: string,
  today: string
): Promise<AttentionInput> {
  const periodCode = periodCodeOf(today);
  const prevCode = previousPeriodCode(periodCode);
  const prevRange = periodRange(prevCode);
  const tokenHorizon = new Date(`${shiftDays(today, TOKEN_ALERT_DAYS)}T23:59:59Z`);

  const [
    journal,
    arap,
    cash,
    inventory,
    [faRow],
    overdueRows,
    markerRows,
    periodRows,
    [prevActivityRow],
    tokenRows,
    bankUnmatched,
    fx,
    negativeStock,
  ] = await Promise.all([
    draftSummary(orgId, journalVouchers, "journal"),
    draftSummary(orgId, arApDocuments, "arap"),
    draftSummary(orgId, cashDocuments, "cash"),
    draftSummary(orgId, inventoryMovements, "inventory"),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(fixedAssets)
      .where(and(eq(fixedAssets.organizationId, orgId), eq(fixedAssets.status, "draft"))),
    // Хугацаа хэтэрсэн нээлттэй АР/АП — самбартай ИЖИЛ дүрэм:
    // posted|partially_paid, dueDate < өнөөдөр, үлдэгдэл > 0.01.
    db
      .select({
        documentType: arApDocuments.documentType,
        n: sql<number>`count(*)::int`,
      })
      .from(arApDocuments)
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          inArray(arApDocuments.status, ["posted", "partially_paid"]),
          lt(arApDocuments.dueDate, today),
          sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} > 0.01`
        )
      )
      .groupBy(arApDocuments.documentType),
    db
      .select({ externalRef: journalVouchers.externalRef })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          or(
            sql`${journalVouchers.externalRef} like 'vat-settlement:%'`,
            sql`${journalVouchers.externalRef} like 'payroll:%'`
          )
        )
      ),
    db.query.accountingPeriods.findMany({
      where: and(
        eq(accountingPeriods.organizationId, orgId),
        inArray(accountingPeriods.code, [periodCode, prevCode])
      ),
      columns: { code: true, status: true },
    }),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(journalVouchers)
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          eq(journalVouchers.status, "posted"),
          gte(journalVouchers.date, prevRange.startDate),
          lte(journalVouchers.date, prevRange.endDate)
        )
      ),
    db.query.apiTokens.findMany({
      where: and(
        eq(apiTokens.organizationId, orgId),
        isNotNull(apiTokens.expiresAt),
        lte(apiTokens.expiresAt, tokenHorizon)
      ),
      columns: { id: true, name: true, userId: true, expiresAt: true },
    }),
    loadBankUnmatched(orgId),
    loadFx(orgId, today),
    loadNegativeStock(orgId),
  ]);

  let arOverdue = 0;
  let apOverdue = 0;
  for (const row of overdueRows) {
    if (row.documentType.startsWith("ar_")) arOverdue += row.n;
    else apOverdue += row.n;
  }

  const statusOf = (code: string): "open" | "closed" | "missing" => {
    const row = periodRows.find((p) => p.code === code);
    return row ? (row.status as "open" | "closed") : "missing";
  };

  const license = deploymentLicenseStatus();
  const entitlements = await getEntitlements(orgId);
  const endsAt = entitlements.trialEndsAt ?? entitlements.graceEndsAt;

  return {
    today,
    periodCode,
    periodStatus: statusOf(periodCode),
    drafts: [
      journal,
      arap,
      cash,
      inventory,
      { module: "fa", count: faRow?.n ?? 0, oldestDate: null },
    ],
    arOverdue,
    apOverdue,
    taxDeadlines: computeTaxDeadlines(today),
    preparedMarkers: markerRows
      .map((row) => row.externalRef)
      .filter((ref): ref is string => !!ref),
    previousPeriod: {
      code: prevCode,
      status: statusOf(prevCode),
      hasActivity: (prevActivityRow?.n ?? 0) > 0,
    },
    licenseExpiresAt: license.expiresAt ?? null,
    subscription:
      entitlements.mode === "saas"
        ? {
            planId: entitlements.planId,
            status: entitlements.status,
            endsAt: endsAt
              ? endsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Ulaanbaatar" })
              : null,
            readOnlyReason: entitlements.readOnlyReason,
          }
        : undefined,
    bankUnmatched,
    fx,
    negativeStock,
    tokens: tokenRows
      .filter((token) => token.expiresAt)
      .map((token) => ({
        id: token.id,
        name: token.name,
        userId: token.userId,
        expiresAt: token.expiresAt!.toLocaleDateString("en-CA", {
          timeZone: "Asia/Ulaanbaatar",
        }),
      })),
  };
}
