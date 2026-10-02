// ХУДАЛДАН АВАЛТЫН eBarimt татах (TPI getSaleListERP) + өглөгтэй тулгах — DB
// давхарга (SERVER; "use server" БИШ). docs/dev/ebarimt-tax-reconcile.md §7.
// ЦЭВЭР логик: purchase-reconcile.ts, lib/itc/tpi.ts (saleListErpBody / parseSaleListErp).
//
// Дүрэм:
//  - ЗӨВХӨН унших — ТЕГ-д юу ч бичихгүй; тулгалт дүн зохиохгүй, өглөгт ДДТД-г
//    автоматаар холбохгүй (санал л — холбох нь хэрэглэгчийн action).
//  - Борлуулалтын тулгалтаас ТУСДАА явц/алдаа: тэр сервис «толгой татвар төлөгч»-д
//    зориулсан тул эрх өөр байж болно — алдаа нь борлуулалтыг зогсоохгүй.
//  - Хуваарьт татлага ХЭЗЭЭ Ч шидэхгүй (`lastPurchaseSyncError`).

import { and, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  counterparties,
  ebarimtTaxPurchases,
  ebarimtTpiConnections,
  organizationProfile,
} from "@/lib/db/schema";
import { mainAccountOfCode } from "@/lib/arap/credit-note";
import { tpiSaleListErp } from "@/lib/itc/client";
import { ItcError } from "@/lib/itc/auth";
import { ITC_ERRORS } from "@/lib/itc/constants";
import type { TpiPurchaseRow } from "@/lib/itc/tpi";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { loadVatSettings } from "@/lib/vat/settings";

import {
  purchaseSyncRanges,
  purchasesBackfillNeeded,
  purchasesSyncStart,
  reconcilePurchases,
  summarizePurchaseChecks,
  type ApInvoiceInput,
  type EbarimtPurchaseCheckRow,
} from "./purchase-reconcile";
import { isTaxSyncDue, ulaanbaatarHour } from "./tax-reconcile";
import { loadTpiConnectionRow, sessionOf } from "./tax-sync";

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

async function upsertPurchases(orgId: string, rows: TpiPurchaseRow[], fallbackDate: string): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await db
      .insert(ebarimtTaxPurchases)
      .values(
        chunk.map((row) => ({
          organizationId: orgId,
          ddtd: row.ddtd.replace(/\s/g, ""),
          taxDate: row.date,
          receiptDate: DATE_PREFIX_RE.exec(row.date)?.[1] ?? fallbackDate,
          sellerRegNo: row.sellerRegNo,
          sellerName: row.sellerName,
          buyerRegNo: row.buyerRegNo,
          total: String(row.total),
          vat: String(row.vat),
          cityTax: String(row.cityTax),
          net: String(row.net),
          fromType: row.fromType,
          receiptType: row.receiptType,
        }))
      )
      .onConflictDoUpdate({
        target: [ebarimtTaxPurchases.organizationId, ebarimtTaxPurchases.ddtd],
        set: {
          taxDate: sql`excluded.tax_date`,
          receiptDate: sql`excluded.receipt_date`,
          sellerRegNo: sql`excluded.seller_reg_no`,
          sellerName: sql`excluded.seller_name`,
          buyerRegNo: sql`excluded.buyer_reg_no`,
          total: sql`excluded.total`,
          vat: sql`excluded.vat`,
          cityTax: sql`excluded.city_tax`,
          net: sql`excluded.net`,
          fromType: sql`excluded.from_type`,
          receiptType: sql`excluded.receipt_type`,
          syncedAt: sql`now()`,
        },
      });
  }
}

export interface PurchaseSyncResult {
  ranges: { startDate: string; endDate: string }[];
  receipts: number;
  skipped: number;
  caughtUp: boolean;
  summary: { checked: number; problems: number; danger: number };
}

/**
 * Нэг байгууллагын худалдан авалтын татлага. `pin` = байгууллагын регистр
 * (Компанийн мэдээлэл), `subPin` хоосон → өөрийн худалдан авалт (албан хуудас).
 * Муж бүрийн дараа явц урагшилна. Алдаа → `lastPurchaseSyncError` бичээд ШИДНЭ.
 */
export async function syncEbarimtTaxPurchases(orgId: string, options: { maxChunks?: number } = {}): Promise<PurchaseSyncResult> {
  const row = await loadTpiConnectionRow(orgId);
  if (!row) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт тохируулаагүй");
  if (!row.isEnabled) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт идэвхгүй");
  const todayUb = ulaanbaatarToday();
  let syncedThrough = row.purchasesSyncedThrough;
  let receipts = 0;
  let skipped = 0;
  try {
    const profile = await db.query.organizationProfile.findFirst({
      where: eq(organizationProfile.organizationId, orgId),
      columns: { registerNo: true },
    });
    const pin = profile?.registerNo?.trim();
    if (!pin)
      throw new ItcError(ITC_ERRORS.config, "Байгууллагын регистрийн дугаар (Тохиргоо → Компанийн мэдээлэл) хоосон — худалдан авалтыг регистрээр татна");
    const session = sessionOf(row);
    // БҮХ худалдан авалт (2026-10-02): эхлэл = хамгийн эртний өглөг (≤ 400 хоног) эсвэл 2 сар;
    // хуучин холболтын эхлэл хойно байвал ухрааж явцыг тэглэнэ (ДДТД-ээр upsert — давхардахгүй).
    const desiredFrom = purchasesSyncStart({ todayUb, earliestApBill: await earliestApBillDate(orgId) });
    let syncFrom = row.purchasesSyncFrom ?? desiredFrom;
    if (!row.purchasesSyncFrom)
      await db.update(ebarimtTpiConnections).set({ purchasesSyncFrom: syncFrom }).where(eq(ebarimtTpiConnections.id, row.id));
    else if (purchasesBackfillNeeded(row.purchasesSyncFrom, desiredFrom)) {
      syncFrom = desiredFrom;
      syncedThrough = null;
      await db
        .update(ebarimtTpiConnections)
        .set({ purchasesSyncFrom: desiredFrom, purchasesSyncedThrough: null })
        .where(eq(ebarimtTpiConnections.id, row.id));
    }
    const ranges = purchaseSyncRanges({ syncFrom, syncedThrough, todayUb, maxChunks: options.maxChunks });
    for (const range of ranges) {
      const result = await tpiSaleListErp(
        session.env,
        { token: await session.token(), apiKey: session.apiKey },
        { pin, startDate: range.startDate, endDate: range.endDate }
      );
      await upsertPurchases(orgId, result.rows, range.startDate);
      receipts += result.rows.length;
      skipped += result.skipped;
      if (!syncedThrough || range.endDate > syncedThrough) {
        syncedThrough = range.endDate;
        await db
          .update(ebarimtTpiConnections)
          .set({ purchasesSyncedThrough: range.endDate })
          .where(eq(ebarimtTpiConnections.id, row.id));
      }
    }
    const { summary } = await loadEbarimtPurchaseChecks(orgId);
    const now = new Date();
    await db
      .update(ebarimtTpiConnections)
      .set({ lastPurchaseSyncAt: now, lastPurchaseSyncOkAt: now, lastPurchaseSyncError: null, lastPurchaseSummary: summary })
      .where(eq(ebarimtTpiConnections.id, row.id));
    return { ranges, receipts, skipped, caughtUp: syncedThrough === todayUb, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ebarimtTpiConnections)
      .set({ lastPurchaseSyncAt: new Date(), lastPurchaseSyncError: message.slice(0, 1000) })
      .where(eq(ebarimtTpiConnections.id, row.id));
    throw error;
  }
}

/** Хамгийн эртний батлагдсан өглөгийн нэхэмжлэхийн огноо (татах эхлэлд). */
export async function earliestApBillDate(orgId: string): Promise<string | null> {
  const [row] = await db
    .select({ earliest: sql<string | null>`min(${arApDocuments.date})` })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentType, "ap_bill"),
        notInArray(arApDocuments.status, ["draft", "reversed"])
      )
    );
  return row?.earliest ?? null;
}

/**
 * Өглөгийн нэхэмжлэх (ap_bill, батлагдсан, буцаагдаагүй) — НӨАТ = оролтын НӨАТ-ын
 * дансны мөрүүд (vat_settings.inputVatAccountNumber, `mainAccountOfCode`) MNT-ээр.
 */
async function loadApInvoices(orgId: string, from: string, to: string, documentId?: string): Promise<ApInvoiceInput[]> {
  const docs = await db
    .select({
      id: arApDocuments.id,
      documentNo: arApDocuments.documentNo,
      date: arApDocuments.date,
      total: arApDocuments.baseTotalAmount,
      exchangeRate: arApDocuments.exchangeRate,
      supplierEbarimtId: arApDocuments.supplierEbarimtId,
      counterpartyName: counterparties.name,
    })
    .from(arApDocuments)
    .leftJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentType, "ap_bill"),
        notInArray(arApDocuments.status, ["draft", "reversed"]),
        documentId ? eq(arApDocuments.id, documentId) : and(gte(arApDocuments.date, from), lte(arApDocuments.date, to))
      )
    );
  if (docs.length === 0) return [];
  const settings = await loadVatSettings(orgId);
  const vatMain = settings.inputVatAccountNumber;
  const vatByDoc = new Map<string, number>();
  for (let index = 0; index < docs.length; index += 1000) {
    const ids = docs.slice(index, index + 1000).map((doc) => doc.id);
    const lines = await db
      .select({ documentId: arApDocumentLines.documentId, accountNumber: arApDocumentLines.accountNumber, amount: arApDocumentLines.amount })
      .from(arApDocumentLines)
      .where(inArray(arApDocumentLines.documentId, ids));
    for (const line of lines)
      if (vatMain && mainAccountOfCode(line.accountNumber) === vatMain)
        vatByDoc.set(line.documentId, (vatByDoc.get(line.documentId) ?? 0) + Number(line.amount));
  }
  return docs.map((doc) => ({
    documentId: doc.id,
    documentNo: doc.documentNo,
    date: doc.date,
    counterpartyName: doc.counterpartyName,
    total: Number(doc.total),
    vat: Math.round((vatByDoc.get(doc.id) ?? 0) * Number(doc.exchangeRate || 1) * 100) / 100,
    supplierEbarimtId: doc.supplierEbarimtId,
  }));
}

/**
 * Тулгалт (амьд). Хамрах хүрээ: худалдан авалт татсан `purchasesSyncFrom` … өнөөдөр.
 * Холболтгүй / хэзээ ч татаагүй бол мөргүй.
 */
export async function loadEbarimtPurchaseChecks(
  orgId: string,
  range?: { from: string; to: string }
): Promise<{
  rows: EbarimtPurchaseCheckRow[];
  summary: { checked: number; problems: number; danger: number };
  syncFrom: string | null;
  syncedThrough: string | null;
}> {
  const connection = await loadTpiConnectionRow(orgId);
  const empty = { rows: [], summary: summarizePurchaseChecks([]), syncFrom: null, syncedThrough: null };
  if (!connection?.purchasesSyncFrom) return empty;
  const todayUb = ulaanbaatarToday();
  // Муж өгвөл (Өглөг → eBarimt — топбарын период) тэр хугацаанд, үгүй бол бүх татсан хугацаа.
  const from = range && range.from > connection.purchasesSyncFrom ? range.from : connection.purchasesSyncFrom;
  const to = range && range.to < todayUb ? range.to : todayUb;
  const purchases = await db
    .select({
      ddtd: ebarimtTaxPurchases.ddtd,
      receiptDate: ebarimtTaxPurchases.receiptDate,
      total: ebarimtTaxPurchases.total,
      vat: ebarimtTaxPurchases.vat,
      sellerName: ebarimtTaxPurchases.sellerName,
      sellerRegNo: ebarimtTaxPurchases.sellerRegNo,
      receiptType: ebarimtTaxPurchases.receiptType,
      taxDate: ebarimtTaxPurchases.taxDate,
      cityTax: ebarimtTaxPurchases.cityTax,
      fromType: ebarimtTaxPurchases.fromType,
    })
    .from(ebarimtTaxPurchases)
    .where(
      and(
        eq(ebarimtTaxPurchases.organizationId, orgId),
        gte(ebarimtTaxPurchases.receiptDate, from),
        lte(ebarimtTaxPurchases.receiptDate, to)
      )
    );
  const invoices = await loadApInvoices(orgId, from, to);
  const rows = reconcilePurchases(
    purchases.map((row) => ({ ...row, total: Number(row.total), vat: Number(row.vat), cityTax: Number(row.cityTax) })),
    invoices,
    { syncFrom: from, syncedThrough: connection.purchasesSyncedThrough, todayUb }
  );
  return {
    rows,
    summary: summarizePurchaseChecks(rows.map((row) => row.check)),
    syncFrom: from,
    syncedThrough: connection.purchasesSyncedThrough,
  };
}

/** Нэг өглөгийн eBarimt-ийн төлөв (АП панель) — ДДТД холбогдсон бол ТЕГ-ийн баримт. */
export async function loadApEbarimtReceipt(
  orgId: string,
  documentId: string
): Promise<{ ddtd: string | null; taxTotal: number | null; taxVat: number | null; taxDate: string | null; entryVat: number; connected: boolean } | null> {
  const [invoice] = await loadApInvoices(orgId, "", "", documentId);
  if (!invoice) return null;
  const connection = await loadTpiConnectionRow(orgId);
  const purchase = invoice.supplierEbarimtId
    ? await db.query.ebarimtTaxPurchases.findFirst({
        where: and(eq(ebarimtTaxPurchases.organizationId, orgId), eq(ebarimtTaxPurchases.ddtd, invoice.supplierEbarimtId)),
        columns: { total: true, vat: true, taxDate: true },
      })
    : null;
  return {
    ddtd: invoice.supplierEbarimtId,
    taxTotal: purchase ? Number(purchase.total) : null,
    taxVat: purchase ? Number(purchase.vat) : null,
    taxDate: purchase?.taxDate ?? null,
    entryVat: invoice.vat,
    connected: !!connection?.purchasesSyncFrom,
  };
}

/**
 * Хуваарьт худалдан авалтын татлага (ticker) — борлуулалтынхтай ИЖИЛ хуваарь
 * (`isTaxSyncDue`: бодит орчинд 01:00–07:00, өдөрт нэг, нөхөлт 10 мин тутам), ТУСДАА
 * явц. Хэзээ ч шидэхгүй; багцад eBarimt боломжгүй бол алгасна.
 */
export async function runDueEbarimtPurchaseSyncs(now = new Date()): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  try {
    const rows = await db.query.ebarimtTpiConnections.findMany({ where: eq(ebarimtTpiConnections.isEnabled, true) });
    if (rows.length === 0) return { synced, errors };
    const todayUb = ulaanbaatarToday(now);
    const hourUb = ulaanbaatarHour(now);
    const { getEntitlements } = await import("@/lib/billing/load");
    for (const row of rows) {
      const due = isTaxSyncDue({
        environment: row.environment === "staging" ? "staging" : "production",
        lastSyncAt: row.lastPurchaseSyncAt,
        lastSyncDateUb: row.lastPurchaseSyncAt ? ulaanbaatarToday(row.lastPurchaseSyncAt) : null,
        lastSyncError: row.lastPurchaseSyncError,
        syncedThrough: row.purchasesSyncedThrough,
        now,
        todayUb,
        hourUb,
      });
      if (!due) continue;
      if (!(await getEntitlements(row.organizationId)).features.ebarimt) continue;
      try {
        await syncEbarimtTaxPurchases(row.organizationId);
        synced += 1;
      } catch (error) {
        errors.push(`${row.organizationId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { synced, errors };
}
