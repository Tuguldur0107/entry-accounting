// АР/АП самбарын KPI — ЦЭВЭР, client-safe (tests/arap-kpis.test.ts).
//
// ENT-017: «Нийт өглөг», «Нээлттэй», «Хэтэрсэн» нь НООРОГ нэхэмжлэхийг ч
// тоолдог байсан (80 сая ₮-ийн ноорог байхад батлагдсан өглөг 21.5 сая атлаа
// 101.7 сая гэж харагдав). Ноорог нь өр биш — зөвхөн БАТЛАГДСАН
// (posted / partially_paid) баримт тоологдоно; ноорог тусдаа тоологдоно.
//
// ENT-029: кредит нэхэмжлэл / дебит нэхэмжлэх нь дэвтрийнхээ үлдэгдлийг
// БУУРУУЛНА (хасах тэмдгээр); хугацаа хэтрэлтэд тоологдохгүй (кредит нь өр биш).

import { arapLedger, isCreditDocument, ledgerSign } from "./document-kind";

export interface ArapKpiDocument {
  documentType: string;
  status: string;
  dueDate: string;
  date: string;
  baseBalance: number;
}

/** Өр/авлагад тоологдох төлөв — батлагдсан, бүрэн төлөгдөөгүй. */
export function isOutstandingStatus(status: string): boolean {
  return status === "posted" || status === "partially_paid";
}

export function arapKpis(documents: ArapKpiDocument[], asOf: string) {
  let ar = 0;
  let ap = 0;
  let open = 0;
  let overdue = 0;
  let overdueCount = 0;
  let draftCount = 0;
  let draftAmount = 0;
  for (const doc of documents) {
    if (doc.status === "draft") {
      draftCount += 1;
      draftAmount += doc.baseBalance;
      continue;
    }
    if (!isOutstandingStatus(doc.status)) continue;
    const signed = ledgerSign(doc.documentType) * doc.baseBalance;
    if (arapLedger(doc.documentType) === "ar") ar += signed;
    else ap += signed;
    open += signed;
    if (isCreditDocument(doc.documentType)) continue;
    if (doc.dueDate < asOf && doc.baseBalance > 0.005) {
      overdue += doc.baseBalance;
      overdueCount += 1;
    }
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    arBalance: round(ar),
    apBalance: round(ap),
    openBalance: round(open),
    overdueBalance: round(overdue),
    overdueCount,
    draftCount,
    draftAmount: round(draftAmount),
  };
}

// ── Насжилтын зурвас (UI гайдын карт 6, ENT-060) ────────────────────────
// «Нийт / Нээлттэй / Хэтэрсэн» гэсэн гурван ИЖИЛ тооны оронд нэг гол тоо +
// хугацаа хэтэрсэн хоногоор ангилсан зурвас. Хугацаа нь болоогүй баримт
// «0–30» хэсэгт орно (Σ хэсгүүд = гол тоо — зурвас бүхэлдээ дүүрнэ).

export type ArapAgingBucketKey = "0-30" | "31-60" | "60+";

export interface ArapAgingBucket {
  key: ArapAgingBucketKey;
  label: string;
  amount: number;
  count: number;
}

export interface ArapBalanceSummary {
  /** Цэвэр үлдэгдэл = Σ зурвас − ашиглагдаагүй кредит. */
  total: number;
  /** Эх нэхэмжлэхэд тооцогдоогүй кредит/дебит баримтын үлдэгдэл (эерэг). */
  creditTotal: number;
  documentCount: number;
  counterpartyCount: number;
  buckets: ArapAgingBucket[];
}

const AGING_BUCKETS: { key: ArapAgingBucketKey; label: string; maxDays: number }[] = [
  { key: "0-30", label: "0–30 хоног", maxDays: 30 },
  { key: "31-60", label: "31–60 хоног", maxDays: 60 },
  { key: "60+", label: "60+ хоног", maxDays: Number.POSITIVE_INFINITY },
];

function daysPastDue(asOf: string, dueDate: string): number {
  const diff = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`);
  return Number.isFinite(diff) ? Math.floor(diff / 86_400_000) : 0;
}

/**
 * Нэг дэвтрийн (ar_invoice → АР, ap_bill → АП) батлагдсан үлдэгдлийн
 * хураангуй — ноорог тоологдохгүй (arapKpis-тэй ижил дүрэм). Зурвас нь
 * нэхэмжлэхүүдийн насжилт; кредит баримт `creditTotal`-д тусдаа, цэвэр дүнгээс
 * хасагдана.
 */
export function arapBalanceSummary(
  documents: (ArapKpiDocument & { counterpartyId?: string })[],
  asOf: string,
  documentType: "ar_invoice" | "ap_bill"
): ArapBalanceSummary {
  const buckets = AGING_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    amount: 0,
    count: 0,
  }));
  const counterparties = new Set<string>();
  let total = 0;
  let creditTotal = 0;
  let documentCount = 0;
  const ledger = arapLedger(documentType);
  for (const doc of documents) {
    if (arapLedger(doc.documentType) !== ledger) continue;
    if (!isOutstandingStatus(doc.status) || doc.baseBalance <= 0.005) continue;
    if (isCreditDocument(doc.documentType)) {
      creditTotal += doc.baseBalance;
      documentCount += 1;
      if (doc.counterpartyId) counterparties.add(doc.counterpartyId);
      continue;
    }
    const days = daysPastDue(asOf, doc.dueDate);
    const index = AGING_BUCKETS.findIndex((bucket) => days <= bucket.maxDays);
    const bucket = buckets[index === -1 ? buckets.length - 1 : index];
    bucket.amount += doc.baseBalance;
    bucket.count += 1;
    total += doc.baseBalance;
    documentCount += 1;
    if (doc.counterpartyId) counterparties.add(doc.counterpartyId);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    total: round(total - creditTotal),
    creditTotal: round(creditTotal),
    documentCount,
    counterpartyCount: counterparties.size,
    buckets: buckets.map((bucket) => ({ ...bucket, amount: round(bucket.amount) })),
  };
}
