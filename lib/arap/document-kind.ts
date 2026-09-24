// АР/АП баримтын ТӨРӨЛ — ЦЭВЭР (tests/arap-document-kind.test.ts).
//
// Нэхэмжлэх (ar_invoice / ap_bill) ба түүний БУЦААЛТ (ENT-029 — ar_credit_note
// «Кредит нэхэмжлэл» / ap_debit_note «Дебит нэхэмжлэх»). Төрлөөс хамаарах
// бүх шийдвэр (эрхийн модуль, хяналтын дансны тал, мөнгөний чиглэл, барааны
// хөдөлгөөн, дугаарын угтвар) ЭНД — `=== "ar_invoice" ? … : …` гэсэн хоёр
// салаат шалгалт шинэ төрлийг АП руу чимээгүй унагадаг байсан.
//
// Кредит/дебит баримтын дүн ЭЕРЭГ хадгалагдана; тэмдэг нь GL-ийн тал
// (controlSide) ба дэвтрийн үлдэгдлийн тэмдгээр (ledgerSign) илэрхийлэгдэнэ.

export const ARAP_DOCUMENT_TYPES = [
  "ar_invoice",
  "ap_bill",
  "ar_credit_note",
  "ap_debit_note",
] as const;

export type ArApDocumentType = (typeof ARAP_DOCUMENT_TYPES)[number];

export type ArApLedger = "ar" | "ap";

export function isArApDocumentType(value: unknown): value is ArApDocumentType {
  return (ARAP_DOCUMENT_TYPES as readonly unknown[]).includes(value);
}

/** Дэвтэр — эрхийн модуль, журналын дугаарын модуль, харилцагчийн чиглэл. */
export function arapLedger(type: string): ArApLedger {
  return type === "ar_invoice" || type === "ar_credit_note" ? "ar" : "ap";
}

/** Эх нэхэмжлэхийг бууруулдаг (буцаалтын) баримт эсэх. */
export function isCreditDocument(type: string): boolean {
  return type === "ar_credit_note" || type === "ap_debit_note";
}

/** Буцаалтын баримтын эх нэхэмжлэхийн төрөл (ба эсрэгээр). */
export function creditDocumentTypeFor(sourceType: string): ArApDocumentType | null {
  if (sourceType === "ar_invoice") return "ar_credit_note";
  if (sourceType === "ap_bill") return "ap_debit_note";
  return null;
}

/**
 * Баримтын журналд хяналтын данс аль талд суух вэ. Авлагын нэхэмжлэл ба
 * дебит нэхэмжлэх (нийлүүлэгчээс авах) → Дт; өглөгийн нэхэмжлэх ба кредит
 * нэхэмжлэл (худалдан авагчид өгөх) → Кт. Мөрүүд нь эсрэг талд.
 */
export function controlSide(type: string): "debit" | "credit" {
  return type === "ar_invoice" || type === "ap_debit_note" ? "debit" : "credit";
}

/**
 * Үлдэгдлийг хаах мөнгө ОРОХ уу (receipt), ГАРАХ уу (payment). Кредит
 * нэхэмжлэлийн илүүдлийг худалдан авагчид буцаан олгох нь зарлага,
 * дебит нэхэмжлэхийн дүнг нийлүүлэгчээс авах нь орлого.
 */
export function settlementCashType(type: string): "receipt" | "payment" {
  return controlSide(type) === "debit" ? "receipt" : "payment";
}

/**
 * Дэвтрийн байгалийн үлдэгдэлд (АР — Дт, АП — Кт) баримтын нээлттэй дүн
 * ямар тэмдгээр нэмэгдэх вэ: нэхэмжлэх +1, буцаалт −1.
 */
export function ledgerSign(type: string): 1 | -1 {
  return isCreditDocument(type) ? -1 : 1;
}

/** Бараатай мөрөөс үүсэх хөдөлгөөний төрөл. */
export function lineMovementType(
  type: string
): "issue" | "receipt" | "return_in" | "return_out" {
  switch (type) {
    case "ar_invoice":
      return "issue";
    case "ar_credit_note":
      return "return_in";
    case "ap_debit_note":
      return "return_out";
    default:
      return "receipt";
  }
}

export const ARAP_DOCUMENT_TYPE_LABELS: Record<ArApDocumentType, string> = {
  ar_invoice: "Авлагын нэхэмжлэл",
  ap_bill: "Өглөгийн нэхэмжлэх",
  ar_credit_note: "Кредит нэхэмжлэл",
  ap_debit_note: "Дебит нэхэмжлэх",
};

export function documentTypeLabel(type: string): string {
  return isArApDocumentType(type) ? ARAP_DOCUMENT_TYPE_LABELS[type] : type;
}

/** Автомат баримтын дугаарын угтвар. */
export function documentNoPrefix(type: string): string {
  switch (type) {
    case "ar_invoice":
      return "AR";
    case "ar_credit_note":
      return "CN";
    case "ap_debit_note":
      return "DN";
    default:
      return "AP";
  }
}

/**
 * Суутган тооцооны хос — нэг нь Дт талын (авлагын нэхэмжлэл / дебит
 * нэхэмжлэх), нөгөө нь Кт талын (өглөгийн нэхэмжлэх / кредит нэхэмжлэл)
 * хяналтын данстай байна. GL: Dr Кт талынхны данс / Cr Дт талынхны данс.
 * АР ↔ АП (харилцан суутгал) ба нэхэмжлэл ↔ кредит нэхэмжлэл (кредитийг
 * дараагийн нэхэмжлэхэд тооцох) хоёулаа энэ дүрмээр.
 */
export function offsetPair<T extends { documentType: string }>(
  a: T,
  b: T
): { debitSide: T; creditSide: T } | null {
  const sa = controlSide(a.documentType);
  const sb = controlSide(b.documentType);
  if (sa === sb) return null;
  return sa === "debit"
    ? { debitSide: a, creditSide: b }
    : { debitSide: b, creditSide: a };
}
