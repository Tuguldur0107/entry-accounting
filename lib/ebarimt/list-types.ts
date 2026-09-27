// eBarimt-д илгээсэн баримтуудын НЭГДСЭН жагсаалт (`/tax/ebarimt`) — ЦЭВЭР төрөл,
// нийлбэр. `@/lib/db` импортгүй (client component импортлодог — CLAUDE.md «Client/
// server хил»). DB давхарга: list-data.ts.

import type { EbarimtStatus } from "./constants";

/** Эх модуль: POS борлуулалт/буцаалт эсвэл АР нэхэмжлэх (docs/pos/05 Шат 2). */
export type EbarimtDocumentSource = "pos" | "arap";

export const EBARIMT_SOURCE_LABELS: Record<EbarimtDocumentSource, string> = {
  pos: "POS",
  arap: "Авлагын нэхэмжлэх",
};

/** PosAPI-ийн баримтын төрөл → UI шошго (төлбөрийн баримт vs нэхэмжлэх, иргэн vs ААН). */
export const EBARIMT_TYPE_LABELS: Record<string, string> = {
  B2C_RECEIPT: "Төлбөрийн баримт · иргэн",
  B2B_RECEIPT: "Төлбөрийн баримт · ААН",
  B2C_INVOICE: "Нэхэмжлэх · иргэн",
  B2B_INVOICE: "Нэхэмжлэх · ААН",
};

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
  /** POS буцаалт — дүн ХАСАХ утгаар (улаан сторно, CLAUDE.md §1). */
  isReturn: boolean;
  /** B2C_RECEIPT / B2B_RECEIPT / B2C_INVOICE / B2B_INVOICE — PosAPI-ийн хариунаас. */
  ebarimtType: string | null;
  status: EbarimtStatus | string;
  /** ДДТД (33 орон). */
  ebarimtId: string | null;
  ebarimtDate: string | null;
  /** Нийт, НӨАТ, НХАТ (MNT) — буцаалтад хасах. */
  total: number;
  vat: number;
  cityTax: number;
  /** Илгээгдээгүй бол сүүлийн илгээлтийн алдаа (шалтгааныг ил харуулна). */
  lastError: string | null;
}

export interface EbarimtListSummary {
  count: number;
  byStatus: Record<string, number>;
  /** ЗӨВХӨН илгээгдсэн (sent) баримтын цэвэр дүн — ТЕГ-д очсон. */
  sentTotal: number;
  sentVat: number;
  sentCityTax: number;
  /** Анхаарал шаардах: алдаатай + илгээгээгүй + хүлээгдэж буй. */
  attention: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Жагсаалтын хураангуй — дүн нь ЗӨВХӨН илгээгдсэн баримтаас (буцаалт хасагдана). */
export function summarizeEbarimtRows(rows: EbarimtDocumentRow[]): EbarimtListSummary {
  const byStatus: Record<string, number> = {};
  let sentTotal = 0;
  let sentVat = 0;
  let sentCityTax = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (row.status !== "sent") continue;
    sentTotal += row.total;
    sentVat += row.vat;
    sentCityTax += row.cityTax;
  }
  return {
    count: rows.length,
    byStatus,
    sentTotal: round2(sentTotal),
    sentVat: round2(sentVat),
    sentCityTax: round2(sentCityTax),
    attention: (byStatus.failed ?? 0) + (byStatus.skipped ?? 0) + (byStatus.pending ?? 0),
  };
}

/** Буцаалтыг хасах тэмдэгтэй болгоно (DB-д дүн эерэг хадгалагддаг). */
export function signedAmount(isReturn: boolean, value: number): number {
  return (isReturn ? -1 : 1) * value;
}
