// Scheduler-ийн оролт — байгууллага бүрд AttentionInput-ыг SQL нэгтгэлээр
// ачаална (П28: ваучер/баримт JS-д ачаалахгүй — count/min л). Нүүрний самбар
// өөрийн ачаалсан датанаасаа ижил бүтэц үүсгэдэг (app/(dashboard)/page.tsx);
// дүрмүүд нь attention.ts-д НЭГ.

import { and, eq, gte, inArray, isNotNull, lt, lte, min, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountingPeriods,
  apiTokens,
  arApDocuments,
  cashDocuments,
  fixedAssets,
  inventoryMovements,
  journalVouchers,
} from "@/lib/db/schema";
import { deploymentLicenseStatus } from "@/lib/licensing/license";
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
