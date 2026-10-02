// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт (Авлага → eBarimt · борлуулалт,
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
/** Анхаарах төлөв: алдаатай, илгээгээгүй (кассчин), хүлээгдэж буй. */
export const isAttentionStatus = (status: string) =>
  status === "failed" || status === "skipped" || status === "pending";

/**
 * ТЕГ-ийн дүн Entry-ийн дүнтэй ЗӨРСӨН / зөрж болзошгүй:
 * - `pending` / `failed` — буцаалтын засварын баримт (inactiveId / DELETE) ТЕГ-д очоогүй
 * - `mismatch` — ТЕГ-д бүртгэлтэй дүн ≠ Entry-ийн ҮЛДСЭН дүн (засвар дараалалд ороогүй:
 *   eBarimt унтраалттай / багцгүй үед буцаасан, засвар явж байхад дахин буцаасан г.м.)
 * - `manual` — гараар ДДТД бичсэн борлуулалт буцаагдсан; ТЕГ-д гараар засна
 * - `unknown` — хуучин өгөгдөл: ТЕГ-д бүртгэлтэй дүн хадгалагдаагүй, буцаалттай
 */
export type EbarimtCorrection = "pending" | "failed" | "mismatch" | "manual" | "unknown";

export const EBARIMT_CORRECTION_LABELS: Record<EbarimtCorrection, string> = {
  pending: "Буцаалтын засвар ТЕГ-д очоогүй (хүлээгдэж буй)",
  failed: "Буцаалтын засвар ТЕГ-д амжилтгүй — панелаас «Засвар илгээх»",
  mismatch: "ТЕГ-д бүртгэлтэй дүн Entry-ийн үлдсэн дүнтэй зөрсөн — панелаас «Засвар илгээх»",
  manual: "Гараар олгосон баримт буцаагдсан — ТЕГ-д гараар засна",
  unknown: "ТЕГ-д бүртгэлтэй дүн тодорхойгүй (хуучин өгөгдөл) — ТЕГ-ийн порталаас тулгана",
};

/** ТЕГ ↔ Entry зөрүүний тэвчээр (₮) — мөрийн бутархай бөөрөнхийлөлт. */
export const EBARIMT_DRIFT_TOLERANCE = 1;

/** Системээр засвар илгээж болох уу (гараар / хуучин өгөгдөл — үгүй). */
export const canResendCorrection = (correction: EbarimtCorrection | null) =>
  correction === "failed" || correction === "mismatch";

/**
 * POS борлуулалтын ТЕГ ↔ Entry тулгалт — ЦЭВЭР. Засварын тэмдэгт (дараалал) бүрэн
 * найдахгүй: ТЕГ-д бүртгэлтэй дүнг Entry-ийн ҮЛДСЭН дүнтэй (борлуулалт − буцаалтууд,
 * бэлэн мөнгөний тоймлолтгүй — баримтад ордоггүй) шууд харьцуулна. Ингэснээр засвар
 * ямар замаар алдагдсан ч «Анхаарах»-д ил гарна (CLAUDE.md §5c).
 */
export function posEbarimtCorrection(input: {
  ebarimtStatus: string | null;
  saleStatus: string;
  flag: string | null;
  registeredTotal: number | null;
  remainingTotal: number;
}): EbarimtCorrection | null {
  if (input.flag === "pending" || input.flag === "failed") return input.flag;
  const returned = input.saleStatus === "partially_returned" || input.saleStatus === "returned";
  const drift =
    input.registeredTotal !== null && Math.abs(input.registeredTotal - input.remainingTotal) > EBARIMT_DRIFT_TOLERANCE;
  switch (input.ebarimtStatus) {
    case "manual":
      return (input.registeredTotal === null ? returned : drift) ? "manual" : null;
    case "sent":
      if (input.registeredTotal === null) return returned ? "unknown" : null;
      return drift ? "mismatch" : null;
    case "cancelled":
      // ТЕГ-д цуцлагдсан (0) ч Entry-д үлдэгдэлтэй борлуулалт.
      return input.remainingTotal > EBARIMT_DRIFT_TOLERANCE ? "mismatch" : null;
    default:
      return null;
  }
}

/** Анхаарах мөр: анхаарах төлөв ЭСВЭЛ ТЕГ-ийн дүн буцаалттай зөрж болзошгүй. */
export const isAttentionRow = (row: Pick<EbarimtDocumentRow, "status" | "correction">) =>
  isAttentionStatus(row.status) || row.correction !== null;

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
  /** ТЕГ-ийн дүн буцаалттай зөрж болзошгүй шалтгаан — null бол зөрөөгүй. */
  correction: EbarimtCorrection | null;
  /** B2C_RECEIPT / B2B_RECEIPT / B2C_INVOICE / B2B_INVOICE. */
  ebarimtType: string | null;
  status: EbarimtStatus | string;
  /** ДДТД (33 орон). */
  ebarimtId: string | null;
  ebarimtDate: string | null;
  /**
   * Нийт, НӨАТ, НХАТ (MNT). ТЕГ-д бүртгэлтэй бол баримт дээр хадгалсан ТЕГ-ийн
   * дүн (markSent — засварын дараах үлдсэн дүн); бусад үед баримтын өөрийн MNT дүн.
   */
  total: number;
  vat: number;
  cityTax: number;
  /** Илгээгдээгүй бол сүүлийн илгээлтийн алдаа (шалтгааныг ил харуулна). */
  lastError: string | null;
}

/** Харагдаж буй бүх мөрийн дүн (төлөв харгалзахгүй) — шүүлтүүрийн хөл дүн. */
export function totalAmounts(rows: EbarimtDocumentRow[]): EbarimtAmounts {
  let total = 0;
  let vat = 0;
  let cityTax = 0;
  for (const row of rows) {
    total += row.total;
    vat += row.vat;
    cityTax += row.cityTax;
  }
  return { count: rows.length, total: round2(total), vat: round2(vat), cityTax: round2(cityTax) };
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
    if (isAttentionRow(row)) attention += 1;
  }
  return { count: rows.length, byStatus, reported: reportedAmounts(rows), attention };
}
