// ТЕГ-ийн БҮХ борлуулалтын баримт (TPI `getSalesTotalData` status 0) — ЦЭВЭР,
// client-safe (DB/сүлжээгүй), tests/ebarimt-tax-sales.test.ts.
// docs/dev/ebarimt-tax-reconcile.md §8.
//
// ТЕГ-д танай ТТД дээр бүртгэлтэй баримт бүрийг Entry-ийн илгээсэн баримттай ДДТД-аар
// тулгана: Entry-ээс илгээгдсэн (POS / АР нэхэмжлэх / төлөлтийн баримт / гар ДДТД)
// эсвэл «Entry-д алга» — өөр касс, ТЕГ-ийн апп, порталаас гараар олгосон баримт.
// Дүн ЗОХИОХГҮЙ: ТЕГ-ийн хариуны дүнг л харуулна. ЗӨВХӨН унших.

/** ТЕГ-ийн баримтын төрөл — татсан мөрийн шинжээр (`taxReceiptKindOf`). */
export const EBARIMT_TAX_SALE_KINDS = ["invoice", "payment", "b2b", "b2c"] as const;
export type EbarimtTaxSaleKind = (typeof EBARIMT_TAX_SALE_KINDS)[number];

export const EBARIMT_TAX_SALE_KIND_LABELS: Record<EbarimtTaxSaleKind, string> = {
  invoice: "Нэхэмжлэх",
  payment: "Нэхэмжлэхийн төлөлт",
  b2b: "ААН-д",
  b2c: "Иргэнд",
};

/**
 * Төрөл: нэхэмжлэх (status 3) > нэхэмжлэхийн төлбөрийн баримт (`prParentRno`) >
 * худалдан авагчийн регистртэй (ААН) > иргэн. TPI-ийн регистр далдлагдаж
 * («00000543***») ирж болох тул хоосон эсэхээр л ялгана.
 */
export function taxReceiptKindOf(row: { isInvoice: boolean; parentDdtd: string | null; buyerRegNo: string }): EbarimtTaxSaleKind {
  if (row.isInvoice) return "invoice";
  if (row.parentDdtd) return "payment";
  return row.buyerRegNo.trim() ? "b2b" : "b2c";
}

/** Entry-ийн аль баримттай тулсан бэ — null бол Entry-д алга. */
export type EbarimtTaxSaleMatch = "pos" | "arap" | "payment" | null;

export const EBARIMT_TAX_SALE_MATCH_LABELS: Record<Exclude<EbarimtTaxSaleMatch, null>, string> = {
  pos: "POS борлуулалт",
  arap: "Авлагын нэхэмжлэх",
  payment: "Төлөлтийн баримт",
};

export interface EbarimtTaxSaleRow {
  ddtd: string;
  /** ТЕГ-ийн огноо (эх текст) — байхгүй бол татсан өдөр. */
  taxDate: string;
  /** Татсан (хүсэлтийн) өдөр YYYY-MM-DD — периодын шүүлт үүгээр. */
  receiptDate: string;
  kind: EbarimtTaxSaleKind;
  parentDdtd: string | null;
  buyerRegNo: string;
  buyerName: string;
  posNo: string;
  total: number;
  vat: number;
  cityTax: number;
  match: EbarimtTaxSaleMatch;
  /** Тулсан Entry-ийн баримтын дугаар (POS-YYMM-NNNN, нэхэмжлэхийн дугаар). */
  entryDocumentNo: string | null;
  /** Панель нээх: POS борлуулалт эсвэл АР баримтын id. */
  saleId: string | null;
  arapDocumentId: string | null;
}

/**
 * Entry-ийн тулгалтын эх (DB-ээс): илгээгдсэн submission-ий төрөл ба гар ДДТД-тэй
 * борлуулалт. Submission давамгайлна; payment төрөл нь «Төлөлтийн баримт».
 */
export function taxSaleMatchOf(input: {
  submissionKind: string | null;
  submissionSaleId: string | null;
  submissionArapId: string | null;
  manualSaleId: string | null;
}): EbarimtTaxSaleMatch {
  if (input.submissionKind === "payment") return "payment";
  if (input.submissionSaleId) return "pos";
  if (input.submissionArapId) return "arap";
  if (input.manualSaleId) return "pos";
  return null;
}

export interface EbarimtTaxSalesSummary {
  count: number;
  total: number;
  vat: number;
  cityTax: number;
  /** Entry-д алга баримт — тоо ба дүн. */
  unmatched: number;
  unmatchedTotal: number;
  byKind: Record<EbarimtTaxSaleKind, number>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function summarizeTaxSales(rows: readonly EbarimtTaxSaleRow[]): EbarimtTaxSalesSummary {
  const byKind: Record<EbarimtTaxSaleKind, number> = { invoice: 0, payment: 0, b2b: 0, b2c: 0 };
  let total = 0;
  let vat = 0;
  let cityTax = 0;
  let unmatched = 0;
  let unmatchedTotal = 0;
  for (const row of rows) {
    byKind[row.kind] += 1;
    // Нэхэмжлэхийн төлөлт нь нэхэмжлэхийн давхар дүн (ТЕГ ч НӨАТ-ын тайланд давхар
    // тусгадаггүй) — борлуулалтын нийлбэрт ОРОХГҮЙ, тоонд л.
    if (row.kind !== "payment") {
      total += row.total;
      vat += row.vat;
      cityTax += row.cityTax;
    }
    if (!row.match) {
      unmatched += 1;
      unmatchedTotal += row.total;
    }
  }
  return {
    count: rows.length,
    total: round2(total),
    vat: round2(vat),
    cityTax: round2(cityTax),
    unmatched,
    unmatchedTotal: round2(unmatchedTotal),
    byKind,
  };
}

/**
 * 2026-10-02-оос өмнөх холболт зөвхөн нэхэмжлэх + төлөлт хадгалдаг байсан тул БҮХ
 * баримтыг эхнээс нь дахин татна: `allReceiptsFrom` null бол `syncedThrough`-ыг
 * тэглэнэ (явц `syncFrom`-оос, хуваарь ердийнхөөрөө 01:00–07:00-д).
 */
export function taxSalesBackfillNeeded(connection: { allReceiptsFrom: string | null }): boolean {
  return !connection.allReceiptsFrom;
}
