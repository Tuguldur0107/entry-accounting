// ГААЛИЙН МЭДҮҮЛЭГ татах (developer портал 10.4, `tpiDeclaration`) — DB давхарга
// (SERVER; "use server" БИШ). docs/dev/ebarimt-tax-reconcile.md §10.
// ЦЭВЭР логик: lib/itc/tpi.ts (customsDeclarationBody / parseCustomsDeclarations /
// customsHasMorePages), муж/эхлэл purchase-reconcile.ts-тэй ИЖИЛ.
//
// Дүрэм:
//  - ЗӨВХӨН унших — гааль/ТЕГ-д юу ч бичихгүй, GL-д бичихгүй; дүн ЗОХИОХГҮЙ.
//  - X-API-KEY нь Гаалийн ерөнхий газрынх — ОПЕРАТОРЫН серверийн env
//    `ITC_CUSTOMS_API_KEY` (харилцагчийн UI-д БАЙХГҮЙ). Тохируулаагүй бол татлага
//    ил шалтгаантай алгасна (алдаа биш — борлуулалт/худалдан авалтыг зогсоохгүй).
//  - Борлуулалт/худалдан авалтаас ТУСДАА явц/алдаа (`customsSyncedThrough`,
//    `lastCustomsSync*`); хуваарьт татлага ХЭЗЭЭ Ч шидэхгүй.

import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ebarimtCustomsDeclarations, ebarimtTpiConnections } from "@/lib/db/schema";
import { tpiCustomsDeclarations } from "@/lib/itc/client";
import { ItcError } from "@/lib/itc/auth";
import { ITC_ERRORS } from "@/lib/itc/constants";
import { CUSTOMS_MAX_PAGES, CUSTOMS_PAGE_SIZE, customsHasMorePages, type CustomsDeclaration } from "@/lib/itc/tpi";
import { ulaanbaatarToday } from "@/lib/periods/document-date";

import { summarizeCustomsDeclarations, type EbarimtCustomsRow, type EbarimtCustomsSummary } from "./customs";
import { EBARIMT_CUSTOMS_CHUNK_DAYS, purchaseSyncRanges, purchasesBackfillNeeded, purchasesSyncStart } from "./purchase-reconcile";
import { earliestApBillDate } from "./purchase-sync";
import { isTaxSyncDue, ulaanbaatarHour } from "./tax-reconcile";
import { loadTpiConnectionRow, sessionOf } from "./tax-sync";

/** Операторын гаалийн X-API-KEY тохируулагдсан эсэх (утга БИШ — тийм/үгүй). */
export function customsApiKeyConfigured(): boolean {
  return !!process.env.ITC_CUSTOMS_API_KEY?.trim();
}

async function upsertDeclarations(orgId: string, rows: CustomsDeclaration[], fallbackDate: string): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await db
      .insert(ebarimtCustomsDeclarations)
      .values(
        chunk.map((row) => ({
          organizationId: orgId,
          declarationNo: row.declarationNo,
          rawDate: row.rawDate,
          declarationDate: row.date || fallbackDate,
          items: row.items,
          dutyAmount: String(row.duty),
          exciseAmount: String(row.excise),
          feeAmount: String(row.fee),
          vatBaseAmount: String(row.vatBase),
          vatAmount: String(row.vat),
        }))
      )
      .onConflictDoUpdate({
        // Түлхүүрт эх огноо ч орно — албан жишээнд дугаар далдлагдсан («14215******I25514»)
        // тул дугаар дангаараа өөр мэдүүлгүүдийг нэг мөрд нийлүүлж (overwrite) болзошгүй.
        target: [ebarimtCustomsDeclarations.organizationId, ebarimtCustomsDeclarations.declarationNo, ebarimtCustomsDeclarations.rawDate],
        set: {
          declarationDate: sql`excluded.declaration_date`,
          items: sql`excluded.items`,
          dutyAmount: sql`excluded.duty_amount`,
          exciseAmount: sql`excluded.excise_amount`,
          feeAmount: sql`excluded.fee_amount`,
          vatBaseAmount: sql`excluded.vat_base_amount`,
          vatAmount: sql`excluded.vat_amount`,
          syncedAt: sql`now()`,
        },
      });
  }
}

export interface CustomsSyncResult {
  ranges: { startDate: string; endDate: string }[];
  declarations: number;
  skipped: number;
  caughtUp: boolean;
}

/**
 * Нэг байгууллагын гаалийн мэдүүлгийн татлага. Эхлэл худалдан авалттай ИЖИЛ
 * (`purchasesSyncStart` — хамгийн эртний өглөг, ≤ 400 хоног), 7 хоногийн муж, муж бүрд
 * хуудаслалт (`pageNumber` 1-ээс). Алдаа → `lastCustomsSyncError` бичээд ШИДНЭ.
 */
export async function syncEbarimtCustomsDeclarations(orgId: string, options: { maxChunks?: number } = {}): Promise<CustomsSyncResult> {
  const row = await loadTpiConnectionRow(orgId);
  if (!row) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт тохируулаагүй");
  if (!row.isEnabled) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт идэвхгүй");
  const apiKey = process.env.ITC_CUSTOMS_API_KEY?.trim();
  if (!apiKey)
    throw new ItcError(ITC_ERRORS.config, "Гаалийн мэдүүлгийн түлхүүр (Гаалийн ерөнхий газрын X-API-KEY) Entry-д тохируулагдаагүй — Entry багт хандана уу");
  const todayUb = ulaanbaatarToday();
  let syncedThrough = row.customsSyncedThrough;
  let declarations = 0;
  let skipped = 0;
  try {
    const session = sessionOf(row);
    const desiredFrom = purchasesSyncStart({ todayUb, earliestApBill: await earliestApBillDate(orgId) });
    let syncFrom = row.customsSyncFrom ?? desiredFrom;
    if (!row.customsSyncFrom)
      await db.update(ebarimtTpiConnections).set({ customsSyncFrom: syncFrom }).where(eq(ebarimtTpiConnections.id, row.id));
    else if (purchasesBackfillNeeded(row.customsSyncFrom, desiredFrom)) {
      syncFrom = desiredFrom;
      syncedThrough = null;
      await db
        .update(ebarimtTpiConnections)
        .set({ customsSyncFrom: desiredFrom, customsSyncedThrough: null })
        .where(eq(ebarimtTpiConnections.id, row.id));
    }
    const ranges = purchaseSyncRanges({ syncFrom, syncedThrough, todayUb, maxChunks: options.maxChunks, chunkDays: EBARIMT_CUSTOMS_CHUNK_DAYS });
    for (const range of ranges) {
      let pageNumber = 1;
      // Мужид үзсэн мэдүүлэг — сервер хуудаслалтыг үл тоож ижил хуудас давтвал (шинэ
      // мэдүүлэггүй хуудас) зогсоно; 200 хуудас хүртэл эргэж алдаа болохгүй.
      const seen = new Set<string>();
      for (;;) {
        if (pageNumber > CUSTOMS_MAX_PAGES)
          throw new ItcError(ITC_ERRORS.tpi, `${range.startDate}…${range.endDate}: ${CUSTOMS_MAX_PAGES} хуудаснаас их мэдүүлэг — татлага таслагдав`);
        const result = await tpiCustomsDeclarations(
          session.env,
          { token: await session.token(), apiKey },
          { startDate: range.startDate, endDate: range.endDate, pageNumber, pageSize: CUSTOMS_PAGE_SIZE }
        );
        await upsertDeclarations(orgId, result.rows, range.startDate);
        declarations += result.rows.length;
        skipped += result.skipped;
        const before = seen.size;
        for (const row of result.rows) seen.add(`${row.declarationNo}|${row.rawDate}`);
        const repeated = result.rows.length > 0 && seen.size === before;
        if (repeated || !customsHasMorePages(pageNumber, result.rows.length + result.skipped, result.totalPages, CUSTOMS_PAGE_SIZE, result.last)) break;
        pageNumber += 1;
      }
      if (!syncedThrough || range.endDate > syncedThrough) {
        syncedThrough = range.endDate;
        await db.update(ebarimtTpiConnections).set({ customsSyncedThrough: range.endDate }).where(eq(ebarimtTpiConnections.id, row.id));
      }
    }
    const now = new Date();
    await db
      .update(ebarimtTpiConnections)
      .set({ lastCustomsSyncAt: now, lastCustomsSyncOkAt: now, lastCustomsSyncError: null })
      .where(eq(ebarimtTpiConnections.id, row.id));
    return { ranges, declarations, skipped, caughtUp: syncedThrough === todayUb };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ebarimtTpiConnections)
      .set({ lastCustomsSyncAt: new Date(), lastCustomsSyncError: message.slice(0, 1000) })
      .where(eq(ebarimtTpiConnections.id, row.id));
    throw error;
  }
}

/**
 * Гаалийн мэдүүлэг — огнооны мужаар (Өглөг → eBarimt → «Гаалийн мэдүүлэг») эсвэл
 * дугаараар (AI). Дугаараар хайлт DB-д шууд, огнооны цонхгүй (§9a — хуучин мэдүүлэг
 * «олдсонгүй» болохгүй); далдлагдсан дугаар давхардвал огноогоор ялгаатай хэд хэдэн мөр.
 */
export async function loadEbarimtCustomsDeclarations(
  orgId: string,
  range: { from: string; to: string } | { declarationNo: string }
): Promise<{ rows: EbarimtCustomsRow[]; summary: EbarimtCustomsSummary }> {
  const filter =
    "declarationNo" in range
      ? eq(ebarimtCustomsDeclarations.declarationNo, range.declarationNo.trim())
      : and(gte(ebarimtCustomsDeclarations.declarationDate, range.from), lte(ebarimtCustomsDeclarations.declarationDate, range.to));
  const rows = await db
    .select({
      declarationNo: ebarimtCustomsDeclarations.declarationNo,
      rawDate: ebarimtCustomsDeclarations.rawDate,
      declarationDate: ebarimtCustomsDeclarations.declarationDate,
      items: ebarimtCustomsDeclarations.items,
      dutyAmount: ebarimtCustomsDeclarations.dutyAmount,
      exciseAmount: ebarimtCustomsDeclarations.exciseAmount,
      feeAmount: ebarimtCustomsDeclarations.feeAmount,
      vatBaseAmount: ebarimtCustomsDeclarations.vatBaseAmount,
      vatAmount: ebarimtCustomsDeclarations.vatAmount,
    })
    .from(ebarimtCustomsDeclarations)
    .where(and(eq(ebarimtCustomsDeclarations.organizationId, orgId), filter))
    .orderBy(sql`${ebarimtCustomsDeclarations.declarationDate} desc, ${ebarimtCustomsDeclarations.declarationNo}, ${ebarimtCustomsDeclarations.rawDate}`);
  const mapped: EbarimtCustomsRow[] = rows.map((row) => ({
    declarationNo: row.declarationNo,
    rawDate: row.rawDate,
    date: row.declarationDate,
    items: row.items ?? [],
    duty: Number(row.dutyAmount),
    excise: Number(row.exciseAmount),
    fee: Number(row.feeAmount),
    vatBase: Number(row.vatBaseAmount),
    vat: Number(row.vatAmount),
  }));
  return { rows: mapped, summary: summarizeCustomsDeclarations(mapped) };
}

/**
 * Хуваарьт гаалийн мэдүүлгийн татлага (ticker) — худалдан авалттай ИЖИЛ хуваарь
 * (`isTaxSyncDue`), ТУСДАА явц. Операторын түлхүүргүй бол бүгдийг алгасна. Хэзээ ч шидэхгүй.
 */
export async function runDueEbarimtCustomsSyncs(now = new Date()): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  if (!customsApiKeyConfigured()) return { synced, errors };
  try {
    const rows = await db.query.ebarimtTpiConnections.findMany({ where: eq(ebarimtTpiConnections.isEnabled, true) });
    if (rows.length === 0) return { synced, errors };
    const todayUb = ulaanbaatarToday(now);
    const hourUb = ulaanbaatarHour(now);
    const { getEntitlements } = await import("@/lib/billing/load");
    for (const row of rows) {
      const due = isTaxSyncDue({
        environment: row.environment === "staging" ? "staging" : "production",
        lastSyncAt: row.lastCustomsSyncAt,
        lastSyncDateUb: row.lastCustomsSyncAt ? ulaanbaatarToday(row.lastCustomsSyncAt) : null,
        lastSyncError: row.lastCustomsSyncError,
        syncedThrough: row.customsSyncedThrough,
        now,
        todayUb,
        hourUb,
      });
      if (!due) continue;
      if (!(await getEntitlements(row.organizationId)).features.ebarimt) continue;
      try {
        await syncEbarimtCustomsDeclarations(row.organizationId);
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
