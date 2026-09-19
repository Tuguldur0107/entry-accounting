// eBarimt 3.0 (PosAPI 3.0) литералын ЦОРЫН ГАНЦ эх сурвалж —
// docs/pos/03-ebarimt-integration-plan.md §1, §4. Client-safe (DB импортгүй).
//
// Утгууд нь ТЕГ-ийн PosAPI 3.0 API-ийн нэршил (B2C_RECEIPT, VAT_ABLE, CASH …).
// Төлбөрийн кодыг кодод ХААЛТТАЙ жагсаалт болгохгүй — pos_payment_methods
// мөр бүр өөрийн `ebarimtCode`-той (лавлах); энд зөвхөн санал болгох default.

import type { PaymentKind } from "@/lib/pos/constants";

/** pos_sales.ebarimtStatus */
export const EBARIMT_STATUSES = ["manual", "pending", "sent", "failed", "cancelled"] as const;
export type EbarimtStatus = (typeof EBARIMT_STATUSES)[number];
export const EBARIMT_STATUS_LABELS: Record<EbarimtStatus, string> = {
  manual: "Гараар (ДДТД)",
  pending: "Илгээж байна",
  sent: "Илгээгдсэн",
  failed: "Алдаатай",
  cancelled: "Цуцлагдсан",
};

/** pos_ebarimt_submissions.kind / status */
export const SUBMISSION_KINDS = ["send", "cancel"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];
/** "claimed" = worker авсан түр төлөв (10 мин гацвал pending руу буцна). */
export const SUBMISSION_STATUSES = ["pending", "claimed", "sent", "failed", "cancelled"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Баримтын төрөл — PosAPI `type`. */
export const EBARIMT_RECEIPT_TYPES = ["B2C_RECEIPT", "B2B_RECEIPT", "B2C_INVOICE", "B2B_INVOICE"] as const;
export type EbarimtReceiptType = (typeof EBARIMT_RECEIPT_TYPES)[number];

/** Дэд баримтын татварын төрөл — PosAPI `receipts[].taxType`. */
export const EBARIMT_TAX_TYPES = ["VAT_ABLE", "VAT_FREE", "VAT_ZERO", "NOT_VAT"] as const;
export type EbarimtTaxType = (typeof EBARIMT_TAX_TYPES)[number];
export const EBARIMT_TAX_TYPE_LABELS: Record<EbarimtTaxType, string> = {
  VAT_ABLE: "НӨАТ-тай (10%)",
  VAT_FREE: "НӨАТ-гүй (чөлөөлөгдсөн)",
  VAT_ZERO: "НӨАТ 0%",
  NOT_VAT: "НӨАТ төлөгч бус",
};

/** Барааны баркодын төрөл — PosAPI `items[].barCodeType`. */
export const EBARIMT_BARCODE_TYPES = ["UNDEFINED", "GS1", "ISBN"] as const;
export type EbarimtBarcodeType = (typeof EBARIMT_BARCODE_TYPES)[number];

/** Төлбөрийн статус — PosAPI `payments[].status`. */
export const EBARIMT_PAYMENT_STATUS_PAID = "PAID";

/**
 * Төлбөрийн хэлбэрийн `kind` → санал болгох eBarimt код. ЗӨВХӨН UI-ийн
 * placeholder ба анхны seed-д; хэрэглэгч pos_payment_methods.ebarimtCode-д
 * ТЕГ-ийн жагсаалтаас өөрөө оноож баталгаажуулна. null = санал байхгүй
 * (ewallet/transfer/BNPL/зээл — ТЕГ-ийн кодыг мерчант багцаас тулгана, §8).
 */
export const EBARIMT_PAYMENT_CODE_SUGGESTIONS: Record<PaymentKind, string | null> = {
  cash: "CASH",
  cash_fx: "CASH",
  card: "PAYMENT_CARD",
  ewallet: null,
  transfer: null,
  credit: null,
  advance: "CASH",
  gift_card: "CASH",
  store_credit: "CASH",
  bnpl: null,
};

/** PosAPI 3.0 REST замууд (мерчантын PosAPI үйлчилгээ дээр). */
export const POSAPI_PATHS = {
  receipt: "/rest/receipt",
  info: "/rest/info",
  sendData: "/rest/sendData",
} as const;

/** ТЕГ-ийн нийтийн лавлах (нэвтрэлтгүй). */
export const EBARIMT_PUBLIC_API_BASE = "https://api.ebarimt.mn/api/info/check";

/** Оруулгын шалгалт — формат зохиохгүй, ТЕГ-ийн баримтаас. */
export const MERCHANT_TIN_RE = /^(\d{11}|\d{14})$/;
export const CLASSIFICATION_CODE_RE = /^\d{7}$/;
export const TAX_PRODUCT_CODE_RE = /^\d{3}$/;
export const DISTRICT_CODE_RE = /^\d{4}$/;
export const CONSUMER_NO_RE = /^\d{8}$/;
export const REGISTER_NO_RE = /^[А-ЯӨҮа-яөүA-Za-z]{2}\d{8}$/;

/** Алдааны кодууд — `[CODE] текст` (CLAUDE.md §9a хэв маяг). */
export const EBARIMT_ERRORS = {
  disabled: "EBARIMT_DISABLED",
  settings: "EBARIMT_SETTINGS",
  unmappedItem: "EBARIMT_UNMAPPED_ITEM",
  taxProductCode: "EBARIMT_TAX_PRODUCT_CODE",
  unmappedPayment: "EBARIMT_UNMAPPED_PAYMENT",
  totalMismatch: "EBARIMT_TOTAL_MISMATCH",
  posApi: "EBARIMT_POSAPI",
  rejected: "EBARIMT_REJECTED",
  notSent: "EBARIMT_NOT_SENT",
} as const;

/** Дахин оролдлогын зай (мс) — оролдлогын тооноос; сүүлийнх нь давтагдана. */
export const EBARIMT_BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
/** Үүнээс хойш оролдохоо болино — failed хэвээр, гараар «Дахин илгээх». */
export const EBARIMT_MAX_ATTEMPTS = 20;
/** Энэ тооны дараалсан алдаанд аудит + мэдэгдэл (`ebarimt_failed`) — нэг л удаа. */
export const EBARIMT_ALERT_AFTER_ATTEMPTS = 3;
/** PosAPI-ийн HTTP timeout. */
export const POSAPI_TIMEOUT_MS = 10_000;

export function backoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), EBARIMT_BACKOFF_MS.length) - 1;
  return EBARIMT_BACKOFF_MS[index];
}
