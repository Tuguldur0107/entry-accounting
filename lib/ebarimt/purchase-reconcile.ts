// ХУДАЛДАН АВАЛТЫН eBarimt ↔ өглөгийн нэхэмжлэх тулгалт — ЦЭВЭР (DB/сүлжээгүй,
// client-safe, tests/ebarimt-purchase-reconcile.test.ts). docs/dev/ebarimt-tax-reconcile.md §7.
//
// ТЕГ (TPI getSaleListERP) танай регистр дээр нийлүүлэгчдийн олгосон баримтыг өгнө,
// харин борлуулагчийн нэр/регистр ДАЛДЛАГДСАН («ГУР*****МБА», «57***85») тул
// тааруулалт ЗӨВХӨН ДДТД-ээр (`supplierEbarimtId`). ДДТД холбоогүй баримтад дүн +
// огноогоор САНАЛ (candidate) гаргана — холбох нь хэрэглэгчийн шийдвэр (автомат биш).
// Дүн ЗОХИОХГҮЙ, ТЕГ-д юу ч бичихгүй.

import { shiftDays } from "@/lib/periods/period";

import { EBARIMT_DRIFT_TOLERANCE } from "./list-types";
import { EBARIMT_TAX_RESYNC_DAYS } from "./tax-reconcile";

/** Нийлүүлэгч баримтаа PosAPI-аар 72 цаг хүртэл хоцорч ТЕГ рүү түлхдэг. */
export const EBARIMT_PURCHASE_LAG_DAYS = 3;
/** Санал болгох өглөгийн огнооны зай (± хоног). */
export const EBARIMT_PURCHASE_CANDIDATE_DAYS = 7;
/** Нэг баримтад хамгийн ихдээ хэдэн санал. */
export const EBARIMT_PURCHASE_CANDIDATE_LIMIT = 5;

export const EBARIMT_PURCHASE_CHECKS = [
  "ok",
  "amount_mismatch",
  "entry_missing",
  "tax_missing",
  "no_receipt",
  "pending",
  "not_synced",
] as const;
export type EbarimtPurchaseCheck = (typeof EBARIMT_PURCHASE_CHECKS)[number];

export const EBARIMT_PURCHASE_CHECK_LABELS: Record<EbarimtPurchaseCheck, string> = {
  ok: "Тулсан",
  amount_mismatch: "Дүн зөрсөн",
  entry_missing: "Өглөгт бүртгэлгүй",
  tax_missing: "ДДТД ТЕГ-д алга",
  no_receipt: "eBarimt холбогдоогүй",
  pending: "ТЕГ-д хүрэх хүлээгдэж буй",
  not_synced: "Татаагүй хугацаа",
};

export const EBARIMT_PURCHASE_CHECK_HINTS: Record<EbarimtPurchaseCheck, string> = {
  ok: "ТЕГ-ийн баримтын дүн, НӨАТ өглөгийн нэхэмжлэхтэй тэнцүү",
  amount_mismatch:
    "Холбосон өглөгийн дүн/НӨАТ ТЕГ-ийн баримтаас өөр — авсан НӨАТ буруу хасагдах эрсдэл. Өглөг эсвэл ДДТД-ийн холбоосыг шалгана",
  entry_missing:
    "Танай регистр дээр олгогдсон баримт өглөгт бүртгэгдээгүй (эсвэл ДДТД холбоогүй) — авсан НӨАТ хасагдахгүй үлдэх, эсвэл танд хамааралгүй баримт. Санал болгосон өглөгтэй холбоно эсвэл өглөг үүсгэнэ",
  tax_missing:
    "Өглөгт бичсэн ДДТД ТЕГ-ийн худалдан авалтын жагсаалтад алга — ДДТД буруу, нийлүүлэгч хүчингүй болгосон эсвэл өөр регистр дээр олгосон байж болно",
  no_receipt:
    "НӨАТ-тай өглөгт нийлүүлэгчийн eBarimt (ДДТД) холбогдоогүй — eBarimt-гүй авсан НӨАТ хасагдахгүй. ТЕГ-ийн баримттай холбоно",
  pending: "Сүүлийн 3 хоногийн өглөг — нийлүүлэгчийн баримт ТЕГ-д хараахан хүрээгүй байж болно",
  not_synced: "Огноо нь ТЕГ-ээс татсан хугацаанаас өмнө — тулгагдаагүй",
};

const PROBLEM_CHECKS: readonly EbarimtPurchaseCheck[] = ["amount_mismatch", "entry_missing", "tax_missing", "no_receipt"];
const DANGER_CHECKS: readonly EbarimtPurchaseCheck[] = ["amount_mismatch", "tax_missing"];
export const isPurchaseCheckProblem = (check: EbarimtPurchaseCheck) => PROBLEM_CHECKS.includes(check);
export const isPurchaseCheckDanger = (check: EbarimtPurchaseCheck) => DANGER_CHECKS.includes(check);

export interface TaxPurchaseInput {
  ddtd: string;
  /** YYYY-MM-DD. */
  receiptDate: string;
  total: number;
  vat: number;
  sellerName: string;
  sellerRegNo: string;
  receiptType: string | null;
}

export interface ApInvoiceInput {
  documentId: string;
  documentNo: string;
  /** YYYY-MM-DD. */
  date: string;
  counterpartyName: string | null;
  /** Нэхэмжлэхийн нийт дүн (MNT). */
  total: number;
  /** Оролтын НӨАТ-ын мөрүүдийн нийлбэр (MNT). */
  vat: number;
  supplierEbarimtId: string | null;
}

export interface PurchaseCandidate {
  documentId: string;
  documentNo: string;
  date: string;
  counterpartyName: string | null;
  total: number;
}

export interface EbarimtPurchaseCheckRow {
  /** `receipt` — ТЕГ-ийн баримтын мөр; `ap` — ТЕГ-д таарах баримтгүй өглөг. */
  kind: "receipt" | "ap";
  key: string;
  check: EbarimtPurchaseCheck;
  ddtd: string | null;
  date: string;
  taxTotal: number | null;
  taxVat: number | null;
  sellerName: string | null;
  receiptType: string | null;
  documentId: string | null;
  documentNo: string | null;
  counterpartyName: string | null;
  entryTotal: number | null;
  entryVat: number | null;
  /** `entry_missing`-д л — дүн + огноогоор санал болгох өглөг. */
  candidates: PurchaseCandidate[];
}

export interface PurchaseCoverage {
  /** ТЕГ-ээс худалдан авалт татаж эхэлсэн өдөр; null = хэзээ ч. */
  syncFrom: string | null;
  /** Энэ өдөр хүртэл татагдсан; null = хэзээ ч. */
  syncedThrough: string | null;
  /** Өнөөдөр (УБ, YYYY-MM-DD). */
  todayUb: string;
}

const key = (ddtd: string) => ddtd.replace(/\s/g, "");
const round2 = (value: number) => Math.round(value * 100) / 100;

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * Бүх тулгалт. ТЕГ-ийн баримт бүр нэг мөр (холбосон өглөгтэй эсвэл саналтай);
 * ТЕГ-д таарах баримтгүй өглөг (холбосон ДДТД алга, эсвэл НӨАТ-тай ч ДДТД-гүй) тусдаа мөр.
 * Хамрах хүрээ: өглөгийн огноо `syncFrom`…`syncedThrough`.
 */
export function reconcilePurchases(
  purchases: readonly TaxPurchaseInput[],
  invoices: readonly ApInvoiceInput[],
  coverage: PurchaseCoverage
): EbarimtPurchaseCheckRow[] {
  const tol = EBARIMT_DRIFT_TOLERANCE;
  const byDdtd = new Map<string, ApInvoiceInput>();
  for (const invoice of invoices) if (invoice.supplierEbarimtId) byDdtd.set(key(invoice.supplierEbarimtId), invoice);
  const unlinked = invoices.filter((invoice) => !invoice.supplierEbarimtId);
  const seen = new Set<string>();
  const rows: EbarimtPurchaseCheckRow[] = [];

  for (const purchase of purchases) {
    const ddtd = key(purchase.ddtd);
    if (!ddtd || seen.has(ddtd)) continue;
    seen.add(ddtd);
    const invoice = byDdtd.get(ddtd) ?? null;
    const base = {
      kind: "receipt" as const,
      key: `r:${ddtd}`,
      ddtd,
      date: purchase.receiptDate,
      taxTotal: round2(purchase.total),
      taxVat: round2(purchase.vat),
      sellerName: purchase.sellerName || null,
      receiptType: purchase.receiptType,
    };
    if (invoice) {
      const mismatch = Math.abs(invoice.total - purchase.total) > tol || Math.abs(invoice.vat - purchase.vat) > tol;
      rows.push({
        ...base,
        check: mismatch ? "amount_mismatch" : "ok",
        documentId: invoice.documentId,
        documentNo: invoice.documentNo,
        counterpartyName: invoice.counterpartyName,
        entryTotal: round2(invoice.total),
        entryVat: round2(invoice.vat),
        candidates: [],
      });
      continue;
    }
    const candidates = unlinked
      .filter(
        (entry) =>
          Math.abs(entry.total - purchase.total) <= tol &&
          dayDiff(entry.date, purchase.receiptDate) <= EBARIMT_PURCHASE_CANDIDATE_DAYS
      )
      .sort((a, b) => dayDiff(a.date, purchase.receiptDate) - dayDiff(b.date, purchase.receiptDate))
      .slice(0, EBARIMT_PURCHASE_CANDIDATE_LIMIT)
      .map((entry) => ({
        documentId: entry.documentId,
        documentNo: entry.documentNo,
        date: entry.date,
        counterpartyName: entry.counterpartyName,
        total: round2(entry.total),
      }));
    rows.push({
      ...base,
      check: "entry_missing",
      documentId: null,
      documentNo: null,
      counterpartyName: null,
      entryTotal: null,
      entryVat: null,
      candidates,
    });
  }

  const pendingFrom = shiftDays(coverage.todayUb, -EBARIMT_PURCHASE_LAG_DAYS);
  for (const invoice of invoices) {
    const linked = invoice.supplierEbarimtId ? key(invoice.supplierEbarimtId) : null;
    if (linked && seen.has(linked)) continue; // ТЕГ-ийн мөрөөр харагдсан
    if (!linked && !(invoice.vat > tol)) continue; // НӨАТ-гүй, ДДТД-гүй — асуудал биш
    let check: EbarimtPurchaseCheck;
    if (!coverage.syncFrom || invoice.date < coverage.syncFrom || (coverage.syncedThrough && invoice.date > coverage.syncedThrough))
      check = "not_synced";
    else if (invoice.date >= pendingFrom) check = "pending";
    else check = linked ? "tax_missing" : "no_receipt";
    rows.push({
      kind: "ap",
      key: `a:${invoice.documentId}`,
      check,
      ddtd: linked,
      date: invoice.date,
      taxTotal: null,
      taxVat: null,
      sellerName: null,
      receiptType: null,
      documentId: invoice.documentId,
      documentNo: invoice.documentNo,
      counterpartyName: invoice.counterpartyName,
      entryTotal: round2(invoice.total),
      entryVat: round2(invoice.vat),
      candidates: [],
    });
  }
  rows.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : b.date.localeCompare(a.date)));
  return rows;
}

export function summarizePurchaseChecks(checks: readonly EbarimtPurchaseCheck[]): {
  checked: number;
  problems: number;
  danger: number;
} {
  return {
    checked: checks.length,
    problems: checks.filter(isPurchaseCheckProblem).length,
    danger: checks.filter(isPurchaseCheckDanger).length,
  };
}

/** ДДТД-ийн хэлбэр — 33 оронтой тоо (зай хасна). Холбох үед шалгана. */
export const DDTD_RE = /^\d{33}$/;
export function normalizePurchaseDdtd(value: string): string | null {
  const compact = value.replace(/\s/g, "");
  return DDTD_RE.test(compact) ? compact : null;
}

/** Нэг хүсэлтийн муж (хоног) ба нэг татлагад хамгийн ихдээ хэдэн муж. */
export const EBARIMT_PURCHASE_CHUNK_DAYS = 31;
export const EBARIMT_PURCHASE_MAX_CHUNKS = 4;

/** Анхдагч эхлэл — 2 сарын өмнөх сарын 1 (НӨАТ-ын тайлант үе + өмнөх сар). */
export function defaultPurchasesSyncFrom(todayUb: string): string {
  const [year, month] = todayUb.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 - 2, 1));
  return start.toISOString().slice(0, 10);
}

/** Татах мужууд: өмнөх явцын сүүлийн 3 өдрөөс (эсвэл эхлэлээс) өнөөдөр хүртэл, 31 хоногоор. */
export function purchaseSyncRanges(input: {
  syncFrom: string;
  syncedThrough: string | null;
  todayUb: string;
  maxChunks?: number;
}): { startDate: string; endDate: string }[] {
  const resume = input.syncedThrough ? shiftDays(input.syncedThrough, -EBARIMT_TAX_RESYNC_DAYS) : input.syncFrom;
  let start = resume < input.syncFrom ? input.syncFrom : resume;
  const ranges: { startDate: string; endDate: string }[] = [];
  const max = input.maxChunks ?? EBARIMT_PURCHASE_MAX_CHUNKS;
  while (start <= input.todayUb && ranges.length < max) {
    const end = shiftDays(start, EBARIMT_PURCHASE_CHUNK_DAYS - 1);
    const endDate = end > input.todayUb ? input.todayUb : end;
    ranges.push({ startDate: start, endDate });
    start = shiftDays(endDate, 1);
  }
  return ranges;
}

