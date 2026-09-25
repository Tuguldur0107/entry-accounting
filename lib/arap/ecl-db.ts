// ECL / найдваргүй авлагын DB давхарга (ENT-065) — "use server" БИШ: action,
// AI tool, тест шууд дуудна. Эрхийн шалгалт БАЙХГҮЙ — дуудагч шалгана.

import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  arApSettlements,
  arapEclSettings,
  journalLines,
  journalVouchers,
} from "@/lib/db/schema";
import {
  DEFAULT_ECL_ACCOUNTS,
  DEFAULT_ECL_MATRIX,
  type EclBucket,
  type EclOpenItem,
  type EclSettingsView,
} from "@/lib/arap/ecl";

export type { ArapWriteOffView, EclOverviewResult, EclSettingsView } from "@/lib/arap/ecl";

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];


function parseMatrix(value: unknown): EclBucket[] {
  if (!Array.isArray(value)) return DEFAULT_ECL_MATRIX;
  return value.map((row) => ({
    maxDays: row?.maxDays == null ? null : Number(row.maxDays),
    ratePct: Number(row?.ratePct ?? 0),
  }));
}

/** Тохиргоо (ratified-seed: мөргүй бол default-аар нэг удаа үүснэ). */
export async function loadEclSettings(orgId: string): Promise<EclSettingsView> {
  let row = await db.query.arapEclSettings.findFirst({
    where: eq(arapEclSettings.organizationId, orgId),
  });
  if (!row) {
    await db
      .insert(arapEclSettings)
      .values({ organizationId: orgId, matrix: DEFAULT_ECL_MATRIX })
      .onConflictDoNothing();
    row = await db.query.arapEclSettings.findFirst({
      where: eq(arapEclSettings.organizationId, orgId),
    });
  }
  return {
    allowanceAccountNumber: row?.allowanceAccountNumber ?? DEFAULT_ECL_ACCOUNTS.allowance,
    expenseAccountNumber: row?.expenseAccountNumber ?? DEFAULT_ECL_ACCOUNTS.expense,
    deferredTaxAssetAccountNumber:
      row?.deferredTaxAssetAccountNumber ?? DEFAULT_ECL_ACCOUNTS.deferredTaxAsset,
    deferredTaxExpenseAccountNumber:
      row?.deferredTaxExpenseAccountNumber ?? DEFAULT_ECL_ACCOUNTS.deferredTaxExpense,
    matrix: parseMatrix(row?.matrix),
    taxRatePct: row?.taxRatePct == null ? null : Number(row.taxRatePct),
  };
}

const mainAccountExpr = sql<string>`case when position('.' in ${journalLines.accountNumber}) > 0 then split_part(${journalLines.accountNumber}, '.', 3) else ${journalLines.accountNumber} end`;

/**
 * Үндсэн дансны GL үлдэгдэл asOf-ийн байдлаар, Кт тэмдгээр (Σ Кт − Σ Дт).
 * posted + reversed (буцаалт нь эсрэг мөрөөр тусдаа журнал). `businessObjectType`
 * өгвөл зөвхөн тэр тэмдэгтэй мөрүүд (DTA данс бусад зөрүүтэй хуваалцана).
 */
export async function creditBalanceOf(
  executor: DbExecutor,
  orgId: string,
  mainAccount: string,
  asOf: string,
  businessObjectType?: string
): Promise<number> {
  const conditions = [
    eq(journalVouchers.organizationId, orgId),
    inArray(journalVouchers.status, ["posted", "reversed"]),
    lte(journalVouchers.date, asOf),
    eq(mainAccountExpr, mainAccount),
  ];
  if (businessObjectType) conditions.push(eq(journalLines.businessObjectType, businessObjectType));
  const [row] = await executor
    .select({
      balance: sql<string>`coalesce(sum(${journalLines.credit} - ${journalLines.debit}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalLines.voucherId))
    .where(and(...conditions));
  return Math.round(Number(row?.balance ?? 0) * 100) / 100;
}

export type EclOpenInvoice = EclOpenItem & {
  id: string;
  documentNo: string;
  counterpartyId: string;
};

/**
 * asOf-ийн байдлаарх нээлттэй АВЛАГЫН нэхэмжлэх (ar_invoice): огноо ≤ asOf,
 * буцаагдаагүй; үлдэгдэл = MNT нийт − asOf хүртэлх тооцоо (төлбөр, кредит,
 * суутгал, хасалт). Кредит нэхэмжлэл (харилцагчийн кредит) ороогүй.
 */
export async function loadEclOpenInvoices(orgId: string, asOf: string): Promise<EclOpenInvoice[]> {
  const settled = db
    .select({
      documentId: arApSettlements.documentId,
      base: sql<string>`sum(${arApSettlements.baseAmount})`.as("base"),
    })
    .from(arApSettlements)
    .where(and(eq(arApSettlements.organizationId, orgId), lte(arApSettlements.settlementDate, asOf)))
    .groupBy(arApSettlements.documentId)
    .as("settled");
  const rows = await db
    .select({
      id: arApDocuments.id,
      documentNo: arApDocuments.documentNo,
      counterpartyId: arApDocuments.counterpartyId,
      dueDate: arApDocuments.dueDate,
      baseTotal: arApDocuments.baseTotalAmount,
      settledBase: sql<string>`coalesce(${settled.base}, 0)`,
    })
    .from(arApDocuments)
    .leftJoin(settled, eq(settled.documentId, arApDocuments.id))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentType, "ar_invoice"),
        inArray(arApDocuments.status, ["posted", "partially_paid", "paid"]),
        lte(arApDocuments.date, asOf)
      )
    );
  return rows
    .map((row) => ({
      id: row.id,
      documentNo: row.documentNo,
      counterpartyId: row.counterpartyId,
      dueDate: row.dueDate,
      baseBalance: Math.round((Number(row.baseTotal) - Number(row.settledBase)) * 100) / 100,
    }))
    .filter((row) => row.baseBalance > 0.005);
}
