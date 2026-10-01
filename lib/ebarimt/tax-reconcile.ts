// ТЕГ ↔ Entry НЭХЭМЖЛЭХИЙН ҮЛДЭГДЛИЙН тулгалт — ЦЭВЭР (DB/сүлжээгүй, client-safe,
// tests/ebarimt-tax-reconcile.test.ts). docs/dev/ebarimt-tax-reconcile.md.
//
// ТЕГ-ийн порталын «Үлдэгдэл» = нэхэмжлэхийн дүн − Σ түүний `invoiceId`-тай
// төлбөрийн баримт. TPI `getSalesTotalData` нэхэмжлэхийг (status 3) ба төлбөрийн
// баримтыг эх нэхэмжлэхийн ДДТД-тэй (`prParentRno`) өгдөг тул ижил дүнг энд бодно.
//
// Гурван дүн харьцуулна:
//   ТЕГ-д бүртгэлтэй төлөлт (taxPaid)  ↔  Entry-ийн ТЕГ-д мэдэгдсэн төлөлт (reportedPaid)
//   Entry-ийн мэдэгдсэн төлөлт         ↔  Entry-ийн авлагын төлөлт (entryPaid)
//   ТЕГ-ийн нэхэмжлэхийн дүн            ↔  Entry-ийн ТЕГ-д бүртгэсэн дүн (registeredTotal)
// Зөрүү бүр ШАЛТГААНТАЙ ангилагдана — дүн ЗОХИОХГҮЙ, автоматаар засахгүй.
// PosAPI ТЕГ рүү 72 цаг хүртэл хоцорч илгээдэг тул сүүлд илгээсэн нь «хүлээгдэж буй».

import { shiftDays } from "@/lib/periods/period";

import { EBARIMT_DRIFT_TOLERANCE } from "./list-types";

/** PosAPI → ТЕГ илгээлтийн хуулийн хугацаа (цаг) — үүнээс өмнө ТЕГ-д харагдахгүй байж болно. */
export const EBARIMT_TAX_SEND_LAG_HOURS = 72;

export const EBARIMT_TAX_CHECKS = [
  "ok",
  "pending",
  "tax_extra",
  "tax_missing_payment",
  "entry_unreported",
  "entry_reversed",
  "total_mismatch",
  "tax_missing_invoice",
  "not_synced",
] as const;
export type EbarimtTaxCheck = (typeof EBARIMT_TAX_CHECKS)[number];

export const EBARIMT_TAX_CHECK_LABELS: Record<EbarimtTaxCheck, string> = {
  ok: "Тулсан",
  pending: "ТЕГ-д хүрэх хүлээгдэж буй",
  tax_extra: "ТЕГ-д илүү төлөлт",
  tax_missing_payment: "Төлөлт ТЕГ-д алга",
  entry_unreported: "Төлөлт ТЕГ-д мэдэгдээгүй",
  entry_reversed: "Entry-д буцаагдсан төлөлт",
  total_mismatch: "Нэхэмжлэхийн дүн зөрсөн",
  tax_missing_invoice: "Нэхэмжлэх ТЕГ-д алга",
  not_synced: "ТЕГ-ээс татаагүй хугацаа",
};

/** Шалтгааны тайлбар — UI, «Анхаарах», AI tool нэг эх. */
export const EBARIMT_TAX_CHECK_HINTS: Record<EbarimtTaxCheck, string> = {
  ok: "ТЕГ-ийн үлдэгдэл Entry-ийн авлагын үлдэгдэлтэй тэнцүү",
  pending: "Entry сүүлийн 72 цагт илгээсэн — PosAPI ТЕГ рүү хараахан түлхээгүй байж болно",
  tax_extra:
    "ТЕГ-д Entry-ийн илгээснээс ИЛҮҮ төлөлт бүртгэгдсэн — порталын «+»-аар гараар нэмсэн эсвэл өөр системээс. Давхар бүртгэлийн эрсдэл: ТЕГ-ийн порталаас шалгаж илүүг нь цуцална",
  tax_missing_payment:
    "Entry-ийн илгээсэн төлөлтийн баримт 72 цагаас хойш ТЕГ-д харагдахгүй байна — PosAPI-ийн sendData, лог, ТЕГ-ийн порталаас шалгана",
  entry_unreported:
    "Entry-д төлөгдсөн ч ТЕГ-д мэдэгдээгүй: төлөлтийн баримт алдаатай/дараалалд, кассгүй хаалт (харилцан суутгал, ECL хасалт, кредит нэхэмжлэл, бэлгийн карт), эсвэл 2026-10-01-ээс өмнөх POS-ийн зээлийн төлөлт",
  entry_reversed:
    "ТЕГ-д мэдэгдсэн төлөлт Entry-д буцаагдсан (касс/хуулга) — ТЕГ-ийн порталаас гараар засна",
  total_mismatch:
    "ТЕГ-ийн нэхэмжлэх/үлдэгдэл Entry-ийнхээс өөр — буцаалтын засвар (inactiveId) ТЕГ-д очоогүй, эсвэл зээлийн борлуулалтын төлөгдсөн хэсгийг бэлнээр буцаасан (ТЕГ-д өмнө явсан төлбөрийн баримт буцаагдаагүй) эсэхийг шалгаж ТЕГ-ийн порталаас засна",
  tax_missing_invoice:
    "Entry ДДТД авсан нэхэмжлэх 72 цагаас хойш ТЕГ-ийн жагсаалтад алга — PosAPI-ийн sendData, ТЕГ-ийн порталаас шалгана",
  not_synced: "Нэхэмжлэхийн огноо ТЕГ-ээс татсан хугацаанаас өмнө — тулгагдаагүй",
};

/** ТЕГ-д буруу/давхар бүртгэлийн эрсдэл — «Анхаарах»-д danger (өнгө: lib/status.ts EBARIMT_TAX_CHECK_TONES). */
const DANGER_CHECKS: readonly EbarimtTaxCheck[] = [
  "tax_extra",
  "tax_missing_payment",
  "entry_reversed",
  "total_mismatch",
  "tax_missing_invoice",
];

/** «Анхаарах»-д тоологдох (pending / ok / not_synced биш). */
export const isTaxCheckProblem = (check: EbarimtTaxCheck) =>
  check !== "ok" && check !== "pending" && check !== "not_synced";
export const isTaxCheckDanger = (check: EbarimtTaxCheck) => DANGER_CHECKS.includes(check);

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface TaxReceiptInput {
  ddtd: string;
  isInvoice: boolean;
  parentDdtd: string | null;
  total: number;
}

export interface TaxLedger {
  /** Нэхэмжлэхийн ДДТД → ТЕГ-ийн дүн. */
  invoices: Map<string, number>;
  /** Нэхэмжлэхийн ДДТД → Σ төлбөрийн баримт + тоо (нэхэмжлэх нь татагдаагүй ч). */
  payments: Map<string, { paid: number; count: number }>;
}

const key = (ddtd: string) => ddtd.replace(/\s/g, "");

/** Татсан мөрүүд → нэхэмжлэх ба төлөлтийн нийлбэр (ДДТД давхардвал нэг л удаа). */
export function buildTaxLedger(rows: readonly TaxReceiptInput[]): TaxLedger {
  const invoices = new Map<string, number>();
  const payments = new Map<string, { paid: number; count: number }>();
  const seen = new Set<string>();
  for (const row of rows) {
    const ddtd = key(row.ddtd);
    if (!ddtd || seen.has(ddtd)) continue;
    seen.add(ddtd);
    if (row.isInvoice) invoices.set(ddtd, round2(row.total));
    const parent = row.parentDdtd ? key(row.parentDdtd) : "";
    if (parent && parent !== ddtd) {
      const entry = payments.get(parent) ?? { paid: 0, count: 0 };
      entry.paid = round2(entry.paid + row.total);
      entry.count += 1;
      payments.set(parent, entry);
    }
  }
  return { invoices, payments };
}

export interface EntryInvoiceInput {
  /** ТЕГ-д бүртгэлтэй нэхэмжлэхийн ДДТД (одоо хүчинтэй — засварын дараах). */
  ddtd: string;
  /**
   * Энэ нэхэмжлэхийн ӨМНӨХ ДДТД-ууд (хэсэгчилсэн буцаалтын `inactiveId` засвар
   * бүр шинэ ДДТД олгоно). Засварын өмнө илгээсэн төлөлтийн баримт хуучин ДДТД-д
   * (`prParentRno`) бүртгэлтэй тул төлөлтийг бүх гинжээр нийлүүлнэ — эс бөгөөс
   * худал «Төлөлт ТЕГ-д алга». Баримт бүр НЭГ эх-тэй тул давхар тоологдохгүй.
   */
  previousDdtds?: readonly string[];
  /** Нэхэмжлэхийн огноо (YYYY-MM-DD). */
  invoiceDate: string;
  /** Нэхэмжлэх ТЕГ-д илгээгдсэн мөч (PosAPI SUCCESS). */
  invoiceSentAt: Date | null;
  /** Entry-ийн ТЕГ-д бүртгэсэн нэхэмжлэхийн дүн (`ebarimtTotal`); null = хуучин өгөгдөл. */
  registeredTotal: number | null;
  /** Авлагын баримтын дүн ба төлөгдсөн (MNT). */
  entryTotal: number;
  entryPaid: number;
  /** Entry-ийн ТЕГ-д амжилттай илгээсэн төлөлтийн баримтын нийлбэр. */
  reportedPaid: number;
  /** Хамгийн сүүлд илгээсэн төлөлтийн баримтын мөч. */
  lastReportedAt: Date | null;
}

export interface TaxCoverage {
  /** ТЕГ-ээс татаж эхэлсэн өдөр (YYYY-MM-DD); null = хэзээ ч татаагүй. */
  syncFrom: string | null;
  now: Date;
}

export interface TaxInvoiceCheckResult {
  check: EbarimtTaxCheck;
  taxTotal: number | null;
  taxPaid: number;
  taxRemaining: number | null;
  entryRemaining: number;
  /** ТЕГ-ийн үлдэгдэл − Entry-ийн үлдэгдэл (ТЕГ-ийн нэхэмжлэх олдсон үед). */
  difference: number | null;
  paymentCount: number;
}

const withinLag = (at: Date | null, now: Date) =>
  !!at && now.getTime() - at.getTime() < EBARIMT_TAX_SEND_LAG_HOURS * 3600_000;

/**
 * Нэг нэхэмжлэхийн тулгалт. Дараалал чухал — ТЕГ-ийн бүртгэлийн эрсдэл (илүү,
 * дутуу) Entry талын дутуугаас ТҮРҮҮЛЖ гарна.
 */
export function checkTaxInvoice(entry: EntryInvoiceInput, ledger: TaxLedger, coverage: TaxCoverage): TaxInvoiceCheckResult {
  const tol = EBARIMT_DRIFT_TOLERANCE;
  const ddtd = key(entry.ddtd);
  const taxTotal = ledger.invoices.get(ddtd) ?? null;
  const chain = [ddtd, ...(entry.previousDdtds ?? []).map(key).filter((value) => value && value !== ddtd)];
  const payment = [...new Set(chain)].reduce(
    (sum, value) => {
      const entryPayment = ledger.payments.get(value);
      return entryPayment ? { paid: round2(sum.paid + entryPayment.paid), count: sum.count + entryPayment.count } : sum;
    },
    { paid: 0, count: 0 }
  );
  const taxPaid = payment.paid;
  const entryRemaining = round2(entry.entryTotal - entry.entryPaid);
  const taxRemaining = taxTotal === null ? null : round2(taxTotal - taxPaid);
  const base = {
    taxTotal,
    taxPaid,
    taxRemaining,
    entryRemaining,
    difference: taxRemaining === null ? null : round2(taxRemaining - entryRemaining),
    paymentCount: payment.count,
  };
  const result = (check: EbarimtTaxCheck): TaxInvoiceCheckResult => ({ check, ...base });

  if (taxTotal === null) {
    if (withinLag(entry.invoiceSentAt, coverage.now)) return result("pending");
    if (!coverage.syncFrom || entry.invoiceDate < coverage.syncFrom) return result("not_synced");
    return result("tax_missing_invoice");
  }
  if (entry.registeredTotal !== null && Math.abs(taxTotal - entry.registeredTotal) > tol) return result("total_mismatch");
  if (taxPaid > entry.reportedPaid + tol) return result("tax_extra");
  if (taxPaid < entry.reportedPaid - tol)
    return result(withinLag(entry.lastReportedAt, coverage.now) ? "pending" : "tax_missing_payment");
  if (entry.reportedPaid > entry.entryPaid + tol) return result("entry_reversed");
  if (entry.entryPaid > entry.reportedPaid + tol) return result("entry_unreported");
  // Төлөлт бүгд тулсан ч үлдэгдэл зөрвөл — Entry-ийн дүн ТЕГ-ийн бүртгэлээс өөр (буцаалт г.м.).
  if (base.difference !== null && Math.abs(base.difference) > tol) return result("total_mismatch");
  return result("ok");
}

export interface TaxCheckSummary {
  checked: number;
  problems: number;
  danger: number;
}

export function summarizeTaxChecks(checks: readonly EbarimtTaxCheck[]): TaxCheckSummary {
  return {
    checked: checks.length,
    problems: checks.filter(isTaxCheckProblem).length,
    danger: checks.filter(isTaxCheckDanger).length,
  };
}

// ── Холболт, татлагын хуваарь ───────────────────────────────────────────────

/** Нэг татлагад хамгийн ихдээ хэдэн өдөр (анхны нөхөлт дараагийн тикэд үргэлжилнэ). */
export const EBARIMT_TAX_SYNC_MAX_DAYS = 31;
/** Дахин татах өдөр — PosAPI 72 цаг хоцорч ТЕГ рүү түлхдэг тул сүүлийн 3 өдрийг давтана. */
export const EBARIMT_TAX_RESYNC_DAYS = 3;
/** Анхны татлага хамгийн эртдээ хэдэн хоногийн өмнөөс (нээлттэй нэхэмжлэхийн огноогоор). */
export const EBARIMT_TAX_MAX_LOOKBACK_DAYS = 400;
/**
 * `getSalesTotalData`-ийг бодит орчинд ЗӨВХӨН шөнийн 01:00–07:00 (УБ) цагт дуудна
 * (албан хуудас: «Хэрэглэгч сервисийг зөвхөн шөнийн цагаар буюу 01:00–07:00 цагийн
 * хооронд дуудан ашиглах боломжтой»; туршилтын орчинд хязгааргүй). PosAPI-ийн 23:30-ийн
 * sendData-ийн дараа тул өдрийн татлагад тохиромжтой.
 */
export const TPI_SALES_WINDOW_UB = { fromHour: 1, toHour: 7 } as const;

/** УБ-ын цаг (0–23). */
export function ulaanbaatarHour(now: Date = new Date()): number {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", hour: "2-digit", hourCycle: "h23" }).format(now));
  return Number.isFinite(hour) ? hour % 24 : 0;
}

/** TPI-ийн борлуулалтын сервисийг одоо дуудаж болох уу — туршилтын орчинд үргэлж. */
export function isTpiSalesWindowOpen(environment: "staging" | "production", hourUb: number): boolean {
  if (environment === "staging") return true;
  return hourUb >= TPI_SALES_WINDOW_UB.fromHour && hourUb < TPI_SALES_WINDOW_UB.toHour;
}
/** Сүүлийн амжилттай татлагаас хойш энэ цагаас удвал «Анхаарах». */
export const EBARIMT_TAX_SYNC_STALE_HOURS = 48;

/** Тохиргооны харагдац — НУУЦ УТГАГҮЙ (client руу). */
export interface EbarimtTpiConnectionView {
  environment: "staging" | "production";
  username: string;
  hasPassword: boolean;
  /** Байгууллагын өөрийн X-API-KEY хадгалагдсан эсэх (үгүй бол серверийн env). */
  hasApiKey: boolean;
  /** Серверт env ITC_TPI_API_KEY тохируулагдсан эсэх (утгагүй). */
  serverApiKey: boolean;
  isEnabled: boolean;
  syncFrom: string | null;
  syncedThrough: string | null;
  lastSyncAt: string | null;
  lastSyncOkAt: string | null;
  lastSyncError: string | null;
  lastSyncSkipped: number;
  summary: TaxCheckSummary | null;
  /** Худалдан авалт (getSaleListERP) — тусдаа явц. */
  purchasesSyncFrom: string | null;
  purchasesSyncedThrough: string | null;
  lastPurchaseSyncOkAt: string | null;
  lastPurchaseSyncError: string | null;
  purchaseSummary: TaxCheckSummary | null;
}

/** Тулгалтын жагсаалт / панель / AI tool-ийн мөр. */
export interface EbarimtTaxCheckRow extends TaxInvoiceCheckResult {
  documentId: string;
  documentNo: string;
  source: "arap" | "pos";
  counterpartyName: string | null;
  ddtd: string;
  invoiceDate: string;
  entryTotal: number;
  entryPaid: number;
  reportedPaid: number;
}

/**
 * Хуваарьт татлага одоо хийх үү (ticker 10 мин тутам асууна) — ЦЭВЭР:
 *  - бодит орчинд ЗӨВХӨН 01:00–07:00 УБ (TPI-ийн албан хязгаар) — бусад үед үгүй
 *  - хэзээ ч татаагүй → тийм
 *  - сүүлийнх алдаатай бол 1 цаг хүлээнэ (ТЕГ-ийг ачаалахгүй)
 *  - нөхөлт дуусаагүй (өчигдрөөс хоцорсон) → 10 мин тутам үргэлжилнэ
 *  - эс бөгөөс өдөрт нэг
 */
export function isTaxSyncDue(input: {
  environment: "staging" | "production";
  lastSyncAt: Date | null;
  lastSyncDateUb: string | null;
  lastSyncError: string | null;
  syncedThrough: string | null;
  now: Date;
  todayUb: string;
  hourUb: number;
}): boolean {
  if (!isTpiSalesWindowOpen(input.environment, input.hourUb)) return false;
  if (!input.lastSyncAt) return true;
  const minutes = (input.now.getTime() - input.lastSyncAt.getTime()) / 60_000;
  if (input.lastSyncError && minutes < 60) return false;
  const behind = !input.syncedThrough || input.syncedThrough < shiftDays(input.todayUb, -1);
  if (behind) return minutes >= 10;
  return input.lastSyncDateUb !== input.todayUb;
}

/** Татах өдрүүд: өмнөх татлагын сүүлийн 3 өдрөөс (эсвэл эхлэлээс) өнөөдөр хүртэл, ≤ maxDays. */
export function taxSyncDays(input: {
  syncFrom: string;
  syncedThrough: string | null;
  todayUb: string;
  maxDays?: number;
}): string[] {
  const resume = input.syncedThrough ? shiftDays(input.syncedThrough, -EBARIMT_TAX_RESYNC_DAYS) : input.syncFrom;
  let day = resume < input.syncFrom ? input.syncFrom : resume;
  const days: string[] = [];
  const max = input.maxDays ?? EBARIMT_TAX_SYNC_MAX_DAYS;
  while (day <= input.todayUb && days.length < max) {
    days.push(day);
    day = shiftDays(day, 1);
  }
  return days;
}
