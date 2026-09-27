// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт (`/tax/ebarimt`,
// `/receivables/ebarimt`) — ЦЭВЭР төрөл, нийлбэр. `@/lib/db` импортгүй (client
// component импортлодог — CLAUDE.md «Client/server хил»). DB давхарга: list-data.ts.

import { EBARIMT_RECEIPT_TYPE_LABELS, type EbarimtReceiptType, type EbarimtStatus } from "./constants";

/** Эх модуль: POS борлуулалт эсвэл АР нэхэмжлэх (docs/pos/05 Шат 2). */
export type EbarimtDocumentSource = "pos" | "arap";

export const EBARIMT_SOURCE_LABELS: Record<EbarimtDocumentSource, string> = {
  pos: "POS",
  arap: "Авлагын нэхэмжлэх",
};

/**
 * ТЕГ-д БҮРТГЭЛТЭЙ баримтын төлөв: `sent` (Entry илгээсэн) ба `manual` (өөр
 * төхөөрөмжөөр олгож ДДТД-г гараар бичсэн). Хураангуй, хөл дүн зөвхөн эдгээрээс.
 */
export const EBARIMT_REPORTED_STATUSES: readonly string[] = ["sent", "manual"];
export const isReportedStatus = (status: string) => EBARIMT_REPORTED_STATUSES.includes(status);
/** Анхаарах: алдаатай, илгээгээгүй (кассчин), хүлээгдэж буй. */
export const isAttentionStatus = (status: string) =>
  status === "failed" || status === "skipped" || status === "pending";

export const ebarimtTypeLabel = (type: string | null) =>
  type ? EBARIMT_RECEIPT_TYPE_LABELS[type as EbarimtReceiptType] ?? type : "";

export interface EbarimtDocumentRow {
  /** `${source}:${id}` — grid-ийн мөрийн түлхүүр. */
  key: string;
  source: EbarimtDocumentSource;
  id: string;
  documentNo: string;
  /** Баримтын огноо YYYY-MM-DD. */
  date: string;
  counterpartyName: string | null;
  /** Худалдан авагч ААН-ийн ТТД (B2B) — иргэнд null. */
  customerTin: string | null;
  /**
   * POS борлуулалт хэсэгчлэн буцаагдсан — ДДТД нь буцаалтын дараах засварын
   * баримт (inactiveId гинж), дүн нь ТЕГ-д одоо бүртгэлтэй ҮЛДСЭН дүн.
   * Буцаалт өөрөө тусдаа баримт биш (queue.ts) тул жагсаалтад мөр болохгүй.
   */
  partiallyReturned: boolean;
  /** B2C_RECEIPT / B2B_RECEIPT / B2C_INVOICE / B2B_INVOICE. */
  ebarimtType: string | null;
  status: EbarimtStatus | string;
  /** ДДТД (33 орон). */
  ebarimtId: string | null;
  ebarimtDate: string | null;
  /**
   * Нийт, НӨАТ, НХАТ (MNT). Илгээгдсэн бол ТЕГ-д очсон СҮҮЛИЙН баримтаас;
   * бусад үед баримтын өөрийн MNT дүн (илгээх гэж буй).
   */
  total: number;
  vat: number;
  cityTax: number;
  /** Илгээгдээгүй бол сүүлийн илгээлтийн алдаа (шалтгааныг ил харуулна). */
  lastError: string | null;
}

export interface EbarimtAmounts {
  count: number;
  total: number;
  vat: number;
  cityTax: number;
}

export interface EbarimtListSummary {
  count: number;
  byStatus: Record<string, number>;
  /** ЗӨВХӨН ТЕГ-д бүртгэлтэй (sent + manual) баримт. */
  reported: EbarimtAmounts;
  attention: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** ТЕГ-д бүртгэлтэй мөрүүдийн дүн — хураангуй карт ба хөл дүн НЭГ эх. */
export function reportedAmounts(rows: EbarimtDocumentRow[]): EbarimtAmounts {
  let count = 0;
  let total = 0;
  let vat = 0;
  let cityTax = 0;
  for (const row of rows) {
    if (!isReportedStatus(row.status)) continue;
    count += 1;
    total += row.total;
    vat += row.vat;
    cityTax += row.cityTax;
  }
  return { count, total: round2(total), vat: round2(vat), cityTax: round2(cityTax) };
}

export function summarizeEbarimtRows(rows: EbarimtDocumentRow[]): EbarimtListSummary {
  const byStatus: Record<string, number> = {};
  let attention = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (isAttentionStatus(row.status)) attention += 1;
  }
  return { count: rows.length, byStatus, reported: reportedAmounts(rows), attention };
}
