// ТЕГ-ийн eBarimt TPI-ээс нэхэмжлэх + төлбөрийн баримт татах, Entry-тэй тулгах —
// DB давхарга (SERVER; "use server" БИШ: action, ticker, AI tool гурвуул дуудна).
// docs/dev/ebarimt-tax-reconcile.md. ЦЭВЭР логик: tax-reconcile.ts, lib/itc/tpi.ts.
//
// Дүрэм:
//  - ЗӨВХӨН унших — ТЕГ-д юу ч бичихгүй; тулгалт дүн зохиохгүй, автоматаар засахгүй.
//  - Нууц (нууц үг, X-API-KEY) `encryptSecret`-ээр; утга нь алдаа/лог/аудитад гарахгүй.
//  - Хуваарьт татлага ХЭЗЭЭ Ч шидэхгүй (байгууллага бүрийн алдаа `lastSyncError`-д).

import { and, desc, eq, gte, inArray, isNotNull, max, or, sql } from "drizzle-orm";

import { decryptSecret } from "@/lib/ai/crypto";
import { db } from "@/lib/db";
import {
  arApDocuments,
  counterparties,
  ebarimtTaxReceipts,
  ebarimtTpiConnections,
  posEbarimtSubmissions,
  posSales,
} from "@/lib/db/schema";
import { fetchItcToken, tpiSalesTotalData } from "@/lib/itc/client";
import { ItcError, isAccessTokenUsable, isItcEnvironment, type ItcToken } from "@/lib/itc/auth";
import { ITC_ERRORS, TPI_SALES_STATUS, type ItcEnvironment, type TpiSalesStatus } from "@/lib/itc/constants";
import { TPI_MAX_PAGES, tpiHasMorePages, tpiPageWindow, type TpiSaleRow } from "@/lib/itc/tpi";
import { shiftDays } from "@/lib/periods/period";
import { ulaanbaatarToday } from "@/lib/periods/document-date";
import { summarizeTaxSales, taxReceiptKindOf, taxSaleMatchOf, taxSalesBackfillNeeded, type EbarimtTaxSaleRow, type EbarimtTaxSalesSummary } from "./tax-sales";

import {
  EBARIMT_TAX_MAX_LOOKBACK_DAYS,
  buildTaxLedger,
  checkTaxInvoice,
  isTaxSyncDue,
  isTpiSalesWindowOpen,
  summarizeTaxChecks,
  TPI_SALES_WINDOW_UB,
  ulaanbaatarHour,
  taxSyncDays,
  type EbarimtTaxCheckRow,
  type EbarimtTpiConnectionView,
  type TaxCheckSummary,
} from "./tax-reconcile";

type ConnectionRow = typeof ebarimtTpiConnections.$inferSelect;

const INVOICE_TYPES = ["B2B_INVOICE", "B2C_INVOICE"];

export async function loadTpiConnectionRow(orgId: string): Promise<ConnectionRow | null> {
  return (
    (await db.query.ebarimtTpiConnections.findFirst({ where: eq(ebarimtTpiConnections.organizationId, orgId) })) ?? null
  );
}

export function serverTpiApiKeyConfigured(): boolean {
  return !!process.env.ITC_TPI_API_KEY?.trim();
}

export function toTpiConnectionView(row: ConnectionRow): EbarimtTpiConnectionView {
  return {
    environment: row.environment === "staging" ? "staging" : "production",
    username: row.username,
    hasPassword: !!row.passwordEnc,
    hasApiKey: !!row.apiKeyEnc,
    serverApiKey: serverTpiApiKeyConfigured(),
    isEnabled: row.isEnabled,
    syncFrom: row.syncFrom,
    syncedThrough: row.syncedThrough,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    lastSyncOkAt: row.lastSyncOkAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
    lastSyncSkipped: row.lastSyncSkipped,
    summary: row.lastCheckSummary ?? null,
    purchasesSyncFrom: row.purchasesSyncFrom,
    purchasesSyncedThrough: row.purchasesSyncedThrough,
    lastPurchaseSyncOkAt: row.lastPurchaseSyncOkAt?.toISOString() ?? null,
    lastPurchaseSyncError: row.lastPurchaseSyncError,
    purchaseSummary: row.lastPurchaseSummary ?? null,
    customsSyncFrom: row.customsSyncFrom,
    customsSyncedThrough: row.customsSyncedThrough,
    lastCustomsSyncOkAt: row.lastCustomsSyncOkAt?.toISOString() ?? null,
    lastCustomsSyncError: row.lastCustomsSyncError,
    customsApiKey: !!process.env.ITC_CUSTOMS_API_KEY?.trim(),
  };
}

export interface TpiSession {
  env: ItcEnvironment;
  apiKey: string | null;
  token(): Promise<Pick<ItcToken, "accessToken">>;
}

/** Холболтын мөрөөс сесс — token дуусвал (30 сек skew) дахин нэвтэрнэ. Нууц энд л тайлагдана. */
export function sessionOf(row: ConnectionRow): TpiSession {
  if (!isItcEnvironment(row.environment)) throw new ItcError(ITC_ERRORS.config, "ITC орчин буруу — тохиргоогоо хадгална уу");
  const env = row.environment;
  const password = decryptSecret(row.passwordEnc);
  if (!password) throw new ItcError(ITC_ERRORS.config, "Нууц үг тайлагдсангүй (AUTH_SECRET солигдсон?) — тохиргоонд дахин оруулна уу");
  // X-API-KEY = Entry-ийн ОПЕРАТОРЫН түлхүүр (серверийн env) — харилцагч оруулахгүй
  // (product owner 2026-10-02). Хуучин байгууллагын түлхүүр (apiKeyEnc) зөвхөн
  // серверийн түлхүүр тохируулаагүй үед нөөц болно.
  const serverKey = process.env.ITC_TPI_API_KEY?.trim() || null;
  let apiKey = serverKey;
  if (!apiKey && row.apiKeyEnc) {
    apiKey = decryptSecret(row.apiKeyEnc);
    if (!apiKey) throw new ItcError(ITC_ERRORS.config, "ITC-ийн түлхүүр тайлагдсангүй — Entry багт хандана уу");
  }
  let current: ItcToken | null = null;
  return {
    env,
    apiKey,
    async token() {
      if (!current || !isAccessTokenUsable(current)) current = await fetchItcToken(env, { username: row.username, password });
      return current;
    },
  };
}

/**
 * Нэг өдөр × status-ийн бүх хуудас — `pageModel.totalElements` ирвэл түүгээр,
 * эс бөгөөс дүүрэн хуудсаар. Хуудасны дээд хязгаар хэтэрвэл ил алдаа.
 */
async function fetchDayRows(session: TpiSession, day: string, status: TpiSalesStatus): Promise<{ rows: TpiSaleRow[]; skipped: number }> {
  const [year, month, date] = day.split("-").map(Number);
  const rows: TpiSaleRow[] = [];
  let skipped = 0;
  for (let page = 0; page < TPI_MAX_PAGES; page += 1) {
    const window = tpiPageWindow(page);
    const result = await tpiSalesTotalData(
      session.env,
      { token: await session.token(), apiKey: session.apiKey },
      { year, month, day: date, status, ...window }
    );
    rows.push(...result.rows);
    skipped += result.skipped;
    const progress = { nextStart: window.endCount, totalElements: result.totalElements ?? null };
    if (!tpiHasMorePages(result.rows.length + result.skipped, undefined, progress)) return { rows, skipped };
  }
  throw new ItcError(ITC_ERRORS.tpi, `${day}: ${TPI_MAX_PAGES} хуудаснаас их мөр — татлага таслагдав (тулгалт бүрэн биш)`);
}

async function upsertTaxRows(orgId: string, day: string, rows: TpiSaleRow[], isInvoice: boolean): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    await db
      .insert(ebarimtTaxReceipts)
      .values(
        chunk.map((row) => ({
          organizationId: orgId,
          ddtd: row.ddtd.replace(/\s/g, ""),
          taxDate: row.date,
          receiptDate: day,
          isInvoice,
          parentDdtd: row.parentDdtd?.replace(/\s/g, "") || null,
          total: String(row.total),
          vat: String(row.vat),
          cityTax: String(row.cityTax),
          buyerRegNo: row.buyerRegNo,
          buyerName: row.buyerName,
          posNo: row.posNo ?? "",
          districtCode: row.districtCode ?? "",
        }))
      )
      .onConflictDoUpdate({
        target: [ebarimtTaxReceipts.organizationId, ebarimtTaxReceipts.ddtd],
        set: {
          taxDate: sql`excluded.tax_date`,
          total: sql`excluded.total`,
          vat: sql`excluded.vat`,
          cityTax: sql`excluded.city_tax`,
          parentDdtd: sql`coalesce(excluded.parent_ddtd, ${ebarimtTaxReceipts.parentDdtd})`,
          // status 3 (нэхэмжлэх) ба status 0 (бүгд) хоёуланд гарвал нэхэмжлэх хэвээр.
          isInvoice: sql`${ebarimtTaxReceipts.isInvoice} or excluded.is_invoice`,
          buyerRegNo: sql`excluded.buyer_reg_no`,
          buyerName: sql`excluded.buyer_name`,
          posNo: sql`excluded.pos_no`,
          districtCode: sql`excluded.district_code`,
          syncedAt: sql`now()`,
        },
      });
  }
}

/**
 * Анхны татлагын эхлэл — Entry-ийн ТЕГ-д илгээсэн хамгийн эртний баримт (нэхэмжлэх
 * эсвэл POS борлуулалт, ≤ 400 хоног); байхгүй бол энэ сарын 1 (БҮХ баримт татах тул
 * сарын борлуулалт бүтэн харагдана).
 */
async function defaultSyncFrom(orgId: string, todayUb: string): Promise<string> {
  const floor = shiftDays(todayUb, -EBARIMT_TAX_MAX_LOOKBACK_DAYS);
  const invoices = await loadEntryInvoices(orgId, { since: floor });
  const earliestInvoice = invoices.reduce<string | null>((min, row) => (!min || row.invoiceDate < min ? row.invoiceDate : min), null);
  const [pos] = await db
    .select({ earliest: sql<string | null>`min(${posSales.date})` })
    .from(posSales)
    .where(
      and(
        eq(posSales.organizationId, orgId),
        inArray(posSales.ebarimtStatus, ["sent", "manual"]),
        gte(posSales.date, floor)
      )
    );
  const candidates = [earliestInvoice, pos?.earliest ?? null].filter((value): value is string => !!value);
  return candidates.length > 0 ? candidates.sort()[0] : `${todayUb.slice(0, 8)}01`;
}

export interface TaxSyncResult {
  days: string[];
  invoices: number;
  payments: number;
  /** Татсан БҮХ борлуулалтын баримт (status 0 — нэхэмжлэх, төлөлт, ААН, иргэн). */
  receipts: number;
  skipped: number;
  /** Өнөөдөр хүртэл бүрэн татагдсан уу (үгүй бол дараагийн тикэд үргэлжилнэ). */
  caughtUp: boolean;
  summary: TaxCheckSummary;
}

/**
 * Нэг байгууллагын татлага. Өдөр бүрийн дараа `syncedThrough` урагшилна (дундаас
 * тасарвал явц алдагдахгүй). Алдаа → `lastSyncError` бичээд ШИДНЭ (гар дуудлагад
 * action `{ error }` болгоно; ticker барина).
 */
export async function syncEbarimtTaxReceipts(orgId: string, options: { maxDays?: number } = {}): Promise<TaxSyncResult> {
  const row = await loadTpiConnectionRow(orgId);
  if (!row) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт тохируулаагүй");
  if (!row.isEnabled) throw new ItcError(ITC_ERRORS.config, "ТЕГ-ийн TPI холболт идэвхгүй");
  // Цонхоос гадуурх ГАР татлага = хүлээгдэх нөхцөл, алдаа БИШ — `lastSyncError`-д
  // бичихгүй (карт «Алдаатай» болохгүй); action-ийн мессежээр л хэлнэ.
  if (!isTpiSalesWindowOpen(row.environment === "staging" ? "staging" : "production", ulaanbaatarHour()))
    throw new ItcError(
      ITC_ERRORS.config,
      `ТЕГ-ийн борлуулалтын задаргааны сервис зөвхөн ${TPI_SALES_WINDOW_UB.fromHour}:00–${TPI_SALES_WINDOW_UB.toHour}:00 (УБ) цагт ажилладаг — хуваарьт татлага тэр цагт автоматаар явна`
    );
  const todayUb = ulaanbaatarToday();
  let syncedThrough = row.syncedThrough;
  let totals = { invoices: 0, payments: 0, receipts: 0, skipped: 0 };
  try {
    const session = sessionOf(row);
    const syncFrom = row.syncFrom ?? (await defaultSyncFrom(orgId, todayUb));
    if (!row.syncFrom)
      await db.update(ebarimtTpiConnections).set({ syncFrom, updatedAt: new Date() }).where(eq(ebarimtTpiConnections.id, row.id));
    // 2026-10-02-оос өмнөх холболт зөвхөн нэхэмжлэх/төлөлт хадгалсан — БҮХ баримтыг
    // эхнээс нь дахин татна (явц syncFrom-оос, ердийн хуваариар).
    if (taxSalesBackfillNeeded(row)) {
      syncedThrough = null;
      await db
        .update(ebarimtTpiConnections)
        .set({ allReceiptsFrom: syncFrom, syncedThrough: null, updatedAt: new Date() })
        .where(eq(ebarimtTpiConnections.id, row.id));
    }
    const days = taxSyncDays({ syncFrom, syncedThrough, todayUb, maxDays: options.maxDays });
    const done: string[] = [];
    for (const day of days) {
      // Цонх хаагдвал явцаа хадгалаад зогсоно (алдаа биш — маргааш үргэлжилнэ).
      if (!isTpiSalesWindowOpen(session.env, ulaanbaatarHour())) break;
      const invoices = await fetchDayRows(session, day, TPI_SALES_STATUS.invoice);
      const all = await fetchDayRows(session, day, TPI_SALES_STATUS.all);
      // БҮХ баримт хадгалагдана (2026-10-02) — нэхэмжлэх ТҮРҮҮЛЖ (isInvoice хадгалагдана).
      await upsertTaxRows(orgId, day, invoices.rows, true);
      await upsertTaxRows(orgId, day, all.rows, false);
      totals = {
        invoices: totals.invoices + invoices.rows.length,
        payments: totals.payments + all.rows.filter((entry) => !!entry.parentDdtd).length,
        receipts: totals.receipts + all.rows.length,
        skipped: totals.skipped + invoices.skipped + all.skipped,
      };
      if (!syncedThrough || day > syncedThrough) {
        syncedThrough = day;
        await db.update(ebarimtTpiConnections).set({ syncedThrough: day }).where(eq(ebarimtTpiConnections.id, row.id));
      }
      done.push(day);
    }
    const { summary } = await loadEbarimtTaxChecks(orgId);
    const now = new Date();
    await db
      .update(ebarimtTpiConnections)
      .set({
        lastSyncAt: now,
        lastSyncOkAt: now,
        lastSyncError: null,
        lastSyncSkipped: totals.skipped,
        lastCheckSummary: summary,
        updatedAt: now,
      })
      .where(eq(ebarimtTpiConnections.id, row.id));
    return { days: done, ...totals, caughtUp: syncedThrough === todayUb, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ebarimtTpiConnections)
      .set({ lastSyncAt: new Date(), lastSyncError: message.slice(0, 1000), lastSyncSkipped: totals.skipped })
      .where(eq(ebarimtTpiConnections.id, row.id));
    throw error;
  }
}

/**
 * Холболт шалгах — нэвтэрч өнөөдрийн нэхэмжлэхийг (status 3) нэг хуудсаар
 * асууна. Бодит орчинд 01:00–07:00-оос гадуур бол ЗӨВХӨН нэвтрэлтийг шалгана
 * (`invoicesToday: null`). Юу ч хадгалахгүй. Шидэнэ (action `{ error }` болгоно).
 */
export async function testTpiConnection(orgId: string): Promise<{ invoicesToday: number | null; skipped: number }> {
  const row = await loadTpiConnectionRow(orgId);
  if (!row) throw new ItcError(ITC_ERRORS.config, "Эхлээд ТЕГ-ийн TPI холболтоо хадгална уу");
  const session = sessionOf(row);
  if (!isTpiSalesWindowOpen(session.env, ulaanbaatarHour())) {
    await session.token();
    return { invoicesToday: null, skipped: 0 };
  }
  const [year, month, day] = ulaanbaatarToday().split("-").map(Number);
  const result = await tpiSalesTotalData(
    session.env,
    { token: await session.token(), apiKey: session.apiKey },
    { year, month, day, status: TPI_SALES_STATUS.invoice, ...tpiPageWindow(0) }
  );
  return { invoicesToday: result.rows.length, skipped: result.skipped };
}

// ── Entry-ийн нэхэмжлэх ─────────────────────────────────────────────────────

interface EntryInvoiceRow {
  documentId: string;
  documentNo: string;
  source: "arap" | "pos";
  counterpartyName: string | null;
  ddtd: string;
  invoiceDate: string;
  registeredTotal: number | null;
  entryTotal: number;
  entryPaid: number;
  saleId: string | null;
}

/**
 * ТЕГ-д НЭХЭМЖЛЭХ болж бүртгэгдсэн Entry-ийн авлага: АР модулийнх (ДДТД баримт
 * дээр) ба POS «Зээлээр» (`sourceType=pos`, ДДТД борлуулалт дээр).
 */
async function loadEntryInvoices(orgId: string, options: { since?: string; documentId?: string } = {}): Promise<EntryInvoiceRow[]> {
  const rows = await db
    .select({
      documentId: arApDocuments.id,
      documentNo: arApDocuments.documentNo,
      date: arApDocuments.date,
      status: arApDocuments.status,
      sourceType: arApDocuments.sourceType,
      total: arApDocuments.baseTotalAmount,
      paid: arApDocuments.basePaidAmount,
      docEbarimtId: arApDocuments.ebarimtId,
      docEbarimtTotal: arApDocuments.ebarimtTotal,
      saleId: posSales.id,
      saleEbarimtId: posSales.ebarimtId,
      saleEbarimtTotal: posSales.ebarimtTotal,
      counterpartyName: counterparties.name,
    })
    .from(arApDocuments)
    .leftJoin(
      posSales,
      and(eq(arApDocuments.sourceType, "pos"), eq(posSales.id, arApDocuments.sourceId), eq(posSales.organizationId, orgId))
    )
    .leftJoin(counterparties, eq(counterparties.id, arApDocuments.counterpartyId))
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentType, "ar_invoice"),
        options.since ? gte(arApDocuments.date, options.since) : undefined,
        options.documentId ? eq(arApDocuments.id, options.documentId) : undefined,
        or(
          and(eq(arApDocuments.ebarimtStatus, "sent"), inArray(arApDocuments.ebarimtType, INVOICE_TYPES)),
          and(eq(posSales.ebarimtStatus, "sent"), inArray(posSales.ebarimtType, INVOICE_TYPES))
        )
      )
    );
  return rows
    .map((row) => {
      const pos = row.sourceType === "pos";
      const ddtd = (pos ? row.saleEbarimtId : row.docEbarimtId) ?? "";
      const registered = pos ? row.saleEbarimtTotal : row.docEbarimtTotal;
      return {
        documentId: row.documentId,
        documentNo: row.documentNo,
        source: pos ? ("pos" as const) : ("arap" as const),
        counterpartyName: row.counterpartyName,
        ddtd,
        invoiceDate: row.date,
        registeredTotal: registered === null ? null : Number(registered),
        entryTotal: Number(row.total),
        entryPaid: Number(row.paid),
        saleId: pos ? row.saleId : null,
      };
    })
    .filter((row) => !!row.ddtd);
}

/** Нэхэмжлэх ТЕГ-д илгээгдсэн мөч + Entry-ийн мэдэгдсэн төлөлт (submissions-оос). */
async function loadSubmissionFacts(invoices: EntryInvoiceRow[]) {
  const sentAt = new Map<string, Date>();
  const reported = new Map<string, { paid: number; at: Date | null }>();
  const docIds = invoices.map((row) => row.documentId);
  const saleIds = invoices.flatMap((row) => (row.saleId ? [row.saleId] : []));
  for (let index = 0; index < docIds.length; index += 1000) {
    const chunk = docIds.slice(index, index + 1000);
    const sends = await db
      .select({ documentId: posEbarimtSubmissions.arapDocumentId, at: max(posEbarimtSubmissions.sentAt) })
      .from(posEbarimtSubmissions)
      .where(
        and(
          inArray(posEbarimtSubmissions.arapDocumentId, chunk),
          eq(posEbarimtSubmissions.kind, "send"),
          eq(posEbarimtSubmissions.status, "sent")
        )
      )
      .groupBy(posEbarimtSubmissions.arapDocumentId);
    for (const send of sends) if (send.documentId && send.at) sentAt.set(send.documentId, send.at);
    const payments = await db
      .select({
        documentId: posEbarimtSubmissions.arapDocumentId,
        paid: sql<string>`coalesce(sum((${posEbarimtSubmissions.payload} -> 'request' ->> 'totalAmount')::numeric), 0)`,
        at: max(posEbarimtSubmissions.sentAt),
      })
      .from(posEbarimtSubmissions)
      .where(
        and(
          inArray(posEbarimtSubmissions.arapDocumentId, chunk),
          eq(posEbarimtSubmissions.kind, "payment"),
          eq(posEbarimtSubmissions.status, "sent")
        )
      )
      .groupBy(posEbarimtSubmissions.arapDocumentId);
    for (const payment of payments)
      if (payment.documentId) reported.set(payment.documentId, { paid: Number(payment.paid), at: payment.at ?? null });
  }
  // Нэхэмжлэхийн ДДТД-ийн гинж — амжилттай илгээлт бүрийн хариуны ДДТД (засвар бүр шинэ).
  const chains = new Map<string, Set<string>>();
  const addChain = (key: string, id: string | null) => {
    if (!id) return;
    const set = chains.get(key) ?? new Set<string>();
    set.add(id.replace(/\s/g, ""));
    chains.set(key, set);
  };
  const saleSentAt = new Map<string, Date>();
  for (let index = 0; index < saleIds.length; index += 1000) {
    const chunk = saleIds.slice(index, index + 1000);
    const sends = await db
      .select({ saleId: posEbarimtSubmissions.saleId, at: max(posEbarimtSubmissions.sentAt) })
      .from(posEbarimtSubmissions)
      .where(and(inArray(posEbarimtSubmissions.saleId, chunk), eq(posEbarimtSubmissions.status, "sent"), isNotNull(posEbarimtSubmissions.sentAt)))
      .groupBy(posEbarimtSubmissions.saleId);
    for (const send of sends) if (send.saleId && send.at) saleSentAt.set(send.saleId, send.at);
    const ids = await db
      .select({ saleId: posEbarimtSubmissions.saleId, ddtd: sql<string | null>`${posEbarimtSubmissions.response} ->> 'id'` })
      .from(posEbarimtSubmissions)
      .where(and(inArray(posEbarimtSubmissions.saleId, chunk), eq(posEbarimtSubmissions.status, "sent")));
    for (const row of ids) if (row.saleId) addChain(row.saleId, row.ddtd);
  }
  return {
    invoiceSentAt: (row: EntryInvoiceRow) => (row.saleId ? saleSentAt.get(row.saleId) : sentAt.get(row.documentId)) ?? null,
    reportedOf: (row: EntryInvoiceRow) => reported.get(row.documentId) ?? { paid: 0, at: null },
    previousDdtdsOf: (row: EntryInvoiceRow) =>
      row.saleId ? [...(chains.get(row.saleId) ?? [])].filter((id) => id !== row.ddtd) : [],
  };
}

async function loadTaxRows(orgId: string, ddtds: string[]) {
  const result: { ddtd: string; isInvoice: boolean; parentDdtd: string | null; total: number }[] = [];
  for (let index = 0; index < ddtds.length; index += 1000) {
    const chunk = ddtds.slice(index, index + 1000);
    const rows = await db
      .select({
        ddtd: ebarimtTaxReceipts.ddtd,
        isInvoice: ebarimtTaxReceipts.isInvoice,
        parentDdtd: ebarimtTaxReceipts.parentDdtd,
        total: ebarimtTaxReceipts.total,
      })
      .from(ebarimtTaxReceipts)
      .where(
        and(
          eq(ebarimtTaxReceipts.organizationId, orgId),
          or(inArray(ebarimtTaxReceipts.ddtd, chunk), inArray(ebarimtTaxReceipts.parentDdtd, chunk))
        )
      );
    for (const row of rows) result.push({ ...row, total: Number(row.total) });
  }
  return result;
}

/**
 * Тулгалт (амьд) — холболтгүй бол мөргүй. `documentId` өгвөл тэр нэг авлага
 * (АР панель). Хамрах хүрээ: сүүлийн 400 хоногийн ТЕГ-д бүртгэлтэй нэхэмжлэх.
 */
export async function loadEbarimtTaxChecks(
  orgId: string,
  options: { documentId?: string } = {}
): Promise<{ connection: EbarimtTpiConnectionView | null; rows: EbarimtTaxCheckRow[]; summary: TaxCheckSummary }> {
  const connection = await loadTpiConnectionRow(orgId);
  if (!connection) return { connection: null, rows: [], summary: summarizeTaxChecks([]) };
  const since = shiftDays(ulaanbaatarToday(), -EBARIMT_TAX_MAX_LOOKBACK_DAYS);
  const invoices = await loadEntryInvoices(orgId, options.documentId ? { documentId: options.documentId } : { since });
  const facts = await loadSubmissionFacts(invoices);
  const ledger = buildTaxLedger(
    await loadTaxRows(orgId, [...new Set(invoices.flatMap((row) => [row.ddtd, ...facts.previousDdtdsOf(row)]))])
  );
  const now = new Date();
  const rows = invoices.map((row): EbarimtTaxCheckRow => {
    const reported = facts.reportedOf(row);
    const result = checkTaxInvoice(
      {
        ddtd: row.ddtd,
        previousDdtds: facts.previousDdtdsOf(row),
        invoiceDate: row.invoiceDate,
        invoiceSentAt: facts.invoiceSentAt(row),
        registeredTotal: row.registeredTotal,
        entryTotal: row.entryTotal,
        entryPaid: row.entryPaid,
        reportedPaid: reported.paid,
        lastReportedAt: reported.at,
      },
      ledger,
      { syncFrom: connection.syncFrom, now }
    );
    return {
      ...result,
      documentId: row.documentId,
      documentNo: row.documentNo,
      source: row.source,
      counterpartyName: row.counterpartyName,
      ddtd: row.ddtd,
      invoiceDate: row.invoiceDate,
      entryTotal: row.entryTotal,
      entryPaid: row.entryPaid,
      reportedPaid: reported.paid,
    };
  });
  rows.sort((a, b) => (a.invoiceDate === b.invoiceDate ? a.documentNo.localeCompare(b.documentNo) : b.invoiceDate.localeCompare(a.invoiceDate)));
  return { connection: toTpiConnectionView(connection), rows, summary: summarizeTaxChecks(rows.map((row) => row.check)) };
}

/**
 * Хуваарьт татлага (ticker) — хугацаа нь болсон байгууллага бүрийг ДАРААЛАН.
 * Хэзээ ч шидэхгүй; багцад eBarimt боломжгүй бол алгасна.
 */
export async function runDueEbarimtTaxSyncs(now = new Date()): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;
  try {
    const rows = await db.query.ebarimtTpiConnections.findMany({
      where: eq(ebarimtTpiConnections.isEnabled, true),
      orderBy: [desc(ebarimtTpiConnections.lastSyncAt)],
    });
    if (rows.length === 0) return { synced, errors };
    const todayUb = ulaanbaatarToday(now);
    const hourUb = ulaanbaatarHour(now);
    const { getEntitlements } = await import("@/lib/billing/load");
    for (const row of rows) {
      const due = isTaxSyncDue({
        environment: row.environment === "staging" ? "staging" : "production",
        lastSyncAt: row.lastSyncAt,
        lastSyncDateUb: row.lastSyncAt ? ulaanbaatarToday(row.lastSyncAt) : null,
        lastSyncError: row.lastSyncError,
        syncedThrough: row.syncedThrough,
        now,
        todayUb,
        hourUb,
      });
      if (!due) continue;
      if (!(await getEntitlements(row.organizationId)).features.ebarimt) continue;
      try {
        await syncEbarimtTaxReceipts(row.organizationId);
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

/** «ТЕГ-ийн бүх баримт» жагсаалтын дээд мөр — нэг хуудсанд (огнооны мужаар нарийсгана). */
export const EBARIMT_TAX_SALES_MAX_ROWS = 20_000;

/**
 * ТЕГ-ийн БҮХ борлуулалтын баримт (огнооны мужид) + Entry-тэй ДДТД-аар тулгалт.
 * Тулгалтын эх: `sent` submission-ий хариуны ДДТД (толгой `id` ба дэд `receipts[].id` —
 * хэсэгчилсэн буцаалтын өмнөх ДДТД ч орно) ба гараар ДДТД бичсэн POS борлуулалт.
 * Raw sql-д Date биш ТЕКСТ огноо (CLAUDE.md §5c). Шидэхгүй биш — дуудагч барина.
 */
export async function loadEbarimtTaxSales(
  orgId: string,
  range: { from: string; to: string }
): Promise<{ rows: EbarimtTaxSaleRow[]; summary: EbarimtTaxSalesSummary; truncated: boolean }> {
  const result = (await db.execute(sql`
    with sent as (
      select s.response->>'id' as ddtd, s.kind, s.sale_id, s.arap_document_id
        from pos_ebarimt_submissions s
       where s.organization_id = ${orgId} and s.status = 'sent' and coalesce(s.response->>'id', '') <> ''
      union all
      select r.value->>'id', s.kind, s.sale_id, s.arap_document_id
        from pos_ebarimt_submissions s
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(s.response->'receipts') = 'array' then s.response->'receipts' else '[]'::jsonb end
        ) r
       where s.organization_id = ${orgId} and s.status = 'sent' and coalesce(r.value->>'id', '') <> ''
    ),
    matched as (
      select distinct on (ddtd) ddtd, kind, sale_id, arap_document_id from sent order by ddtd, kind
    )
    select t.ddtd, t.tax_date, t.receipt_date, t.is_invoice, t.parent_ddtd, t.buyer_reg_no, t.buyer_name,
           t.pos_no, t.total, t.vat, t.city_tax,
           m.kind as submission_kind, m.sale_id as submission_sale_id, m.arap_document_id as submission_arap_id,
           manual.id as manual_sale_id,
           coalesce(ps.document_no, manual.document_no, ad.document_no) as entry_document_no
      from ebarimt_tax_receipts t
      left join matched m on m.ddtd = t.ddtd
      left join pos_sales ps on ps.id = m.sale_id
      left join ar_ap_documents ad on ad.id = m.arap_document_id
      left join lateral (
        select p.id, p.document_no from pos_sales p
         where m.ddtd is null and p.organization_id = t.organization_id and p.ebarimt_id = t.ddtd
         limit 1
      ) manual on true
     where t.organization_id = ${orgId} and t.receipt_date >= ${range.from} and t.receipt_date <= ${range.to}
     order by t.receipt_date desc, t.tax_date desc, t.ddtd
     limit ${EBARIMT_TAX_SALES_MAX_ROWS + 1}
  `)) as unknown as Record<string, unknown>[];

  const text = (value: unknown) => (value == null ? "" : String(value));
  const nullable = (value: unknown) => (value == null || value === "" ? null : String(value));
  const rows: EbarimtTaxSaleRow[] = result.slice(0, EBARIMT_TAX_SALES_MAX_ROWS).map((raw) => {
    const parentDdtd = nullable(raw.parent_ddtd);
    const buyerRegNo = text(raw.buyer_reg_no);
    const isInvoice = raw.is_invoice === true || raw.is_invoice === "t";
    const submissionSaleId = nullable(raw.submission_sale_id);
    const submissionArapId = nullable(raw.submission_arap_id);
    const manualSaleId = nullable(raw.manual_sale_id);
    const match = taxSaleMatchOf({
      submissionKind: nullable(raw.submission_kind),
      submissionSaleId,
      submissionArapId,
      manualSaleId,
    });
    return {
      ddtd: text(raw.ddtd),
      taxDate: text(raw.tax_date) || text(raw.receipt_date),
      receiptDate: text(raw.receipt_date),
      kind: taxReceiptKindOf({ isInvoice, parentDdtd, buyerRegNo }),
      parentDdtd,
      buyerRegNo,
      buyerName: text(raw.buyer_name),
      posNo: text(raw.pos_no),
      total: Number(raw.total ?? 0),
      vat: Number(raw.vat ?? 0),
      cityTax: Number(raw.city_tax ?? 0),
      match,
      entryDocumentNo: nullable(raw.entry_document_no),
      saleId: submissionSaleId ?? manualSaleId,
      arapDocumentId: submissionArapId,
    };
  });
  return { rows, summary: summarizeTaxSales(rows), truncated: result.length > EBARIMT_TAX_SALES_MAX_ROWS };
}
