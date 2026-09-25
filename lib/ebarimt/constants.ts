// eBarimt 3.0 (PosAPI 3.0) литералын ЦОРЫН ГАНЦ эх сурвалж —
// docs/pos/03-ebarimt-integration-plan.md §1, §4. Client-safe (DB импортгүй).
//
// Утгууд нь ТЕГ-ийн PosAPI 3.0 API-ийн нэршил (B2C_RECEIPT, VAT_ABLE, CASH …).
// Төлбөрийн кодыг кодод ХААЛТТАЙ жагсаалт болгохгүй — pos_payment_methods
// мөр бүр өөрийн `ebarimtCode`-той (лавлах); энд зөвхөн санал болгох default.

import type { PaymentKind } from "@/lib/pos/constants";

/**
 * pos_sales.ebarimtStatus. `skipped` = кассчин төлбөрийн диалогт «eBarimt илгээх»-ийг
 * унтраасан (eBarimt асаалттай байсан ч энэ борлуулалт ТЕГ-д илгээгдээгүй) —
 * панелиас [Илгээх]-ээр дараа нь илгээж болно. null = eBarimt огт унтраалттай.
 */
export const EBARIMT_STATUSES = ["manual", "pending", "sent", "failed", "cancelled", "skipped"] as const;
export type EbarimtStatus = (typeof EBARIMT_STATUSES)[number];
export const EBARIMT_STATUS_LABELS: Record<EbarimtStatus, string> = {
  manual: "Гараар (ДДТД)",
  pending: "Илгээж байна",
  sent: "Илгээгдсэн",
  failed: "Алдаатай",
  cancelled: "Цуцлагдсан",
  skipped: "Илгээгээгүй (кассчин)",
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

/**
 * Төлбөрийн статус — PosAPI `payments[].status`: PAID = төлөгдсөн, PAY =
 * төлөгдөх (нэхэмжлэхийн дараа төлөх хэсэг — зээлээр `credit`).
 */
export const EBARIMT_PAYMENT_STATUS_PAID = "PAID";
export const EBARIMT_PAYMENT_STATUS_PAY = "PAY";
export type EbarimtPaymentStatus = typeof EBARIMT_PAYMENT_STATUS_PAID | typeof EBARIMT_PAYMENT_STATUS_PAY;

/**
 * Дараа төлөгдөх (НЭХЭМЖЛЭХ) төлбөрийн `kind`. Ийм төлбөртэй борлуулалт
 * `B2C_INVOICE` / `B2B_INVOICE` төрлөөр илгээгдэж, тэр хэсэг нь `PAY` статустай
 * (docs/pos/03 T3). Сугалаа нэхэмжлэхэд олгогдохгүй.
 */
export const EBARIMT_INVOICE_PAYMENT_KINDS: readonly PaymentKind[] = ["credit"];

/**
 * PosAPI 3.0 `payments[].code`-ийн АЛБАН жагсаалт (developer портал «Төлбөрийн
 * баримт хадгалах», 2026-08; docs/integrations/01 P1-4). Хориглолт БИШ — ТЕГ код
 * нэмж болно (readiness ЗӨВХӨН анхааруулна), гэхдээ жагсаалтад байхгүй кодтой
 * баримт PosAPI-д татгалзагдах эрсдэлтэй.
 */
export const EBARIMT_PAYMENT_CODES = ["CASH", "PAYMENT_CARD", "BANK_TRANSFER", "BANK_TRANSFER_QPAY"] as const;
export type EbarimtPaymentCode = (typeof EBARIMT_PAYMENT_CODES)[number];
export const EBARIMT_PAYMENT_CODE_LABELS: Record<EbarimtPaymentCode, string> = {
  CASH: "Бэлнээр",
  PAYMENT_CARD: "Төлбөрийн карт",
  BANK_TRANSFER: "Банкны шилжүүлэг",
  BANK_TRANSFER_QPAY: "QPay-ээр",
};
export function isKnownEbarimtPaymentCode(code: string | null | undefined): boolean {
  return (EBARIMT_PAYMENT_CODES as readonly string[]).includes((code ?? "").trim().toUpperCase());
}

/**
 * Төлбөрийн хэлбэрийн `kind` → санал болгох eBarimt код (`EBARIMT_PAYMENT_CODES`-оос).
 * ЗӨВХӨН UI-ийн placeholder ба анхны seed-д; хэрэглэгч pos_payment_methods.ebarimtCode-д
 * өөрөө оноож баталгаажуулна. null = санал байхгүй: ewallet ерөнхийд нь (QPay
 * провайдертай хэлбэр л `BANK_TRANSFER_QPAY` — lib/qpay/seed.ts), BNPL, зээл
 * (`credit` = PAY статустай дараа төлөгдөх хэсэг — төлөгдөх хэлбэрийнх нь код;
 * өмнөх `INVOICE` санал албан жагсаалтад БАЙХГҮЙ тул хасагдав).
 */
export const EBARIMT_PAYMENT_CODE_SUGGESTIONS: Record<PaymentKind, string | null> = {
  cash: "CASH",
  cash_fx: "CASH",
  card: "PAYMENT_CARD",
  ewallet: null,
  transfer: "BANK_TRANSFER",
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

/**
 * ТЕГ-ийн нийтийн лавлах (нэвтрэлтгүй). ЗӨВХӨН Монгол Улсын сүлжээнээс хандагддаг
 * (албан заавар «Сүлжээний тохиргоо»; docs/integrations/01 P1-1) — гадаад бүсийн
 * серверт env `EBARIMT_PUBLIC_API_BASE`-ээр Монголд байрлах прокси/операторын
 * хаягаар СОЛИНО (lib/ebarimt/lookup.ts `publicApiBase`). Энэ default нь баримт.
 */
export const EBARIMT_PUBLIC_API_BASE = "https://api.ebarimt.mn/api/info/check";

/** Оруулгын шалгалт — формат зохиохгүй, ТЕГ-ийн баримтаас. */
/** ТТД — албан спек: хуулийн этгээд 11 орон, хувь хүн (civil id) 12–14 орон (P2-1). */
export const MERCHANT_TIN_RE = /^\d{11,14}$/;
export const CLASSIFICATION_CODE_RE = /^\d{7}$/;
/**
 * Татварын бүтээгдэхүүний код — албан жагсаалт 3 орон (305–446, 501–507) боловч
 * `getProductTaxCode` лавлах 5 оронтой код (43401) ч буцаадаг тул 3–5 (P2-2).
 */
export const TAX_PRODUCT_CODE_RE = /^\d{3,5}$/;
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
  /** HTTP timeout — хүсэлт PosAPI-д хүрч ДДТД үүссэн байж болзошгүй (давхардлын эрсдэл). */
  posApiTimeout: "EBARIMT_POSAPI_TIMEOUT",
  /** Борлуулалтын дугаараас `billIdSuffix` гаргах боломжгүй. */
  billId: "EBARIMT_BILL_ID",
  rejected: "EBARIMT_REJECTED",
  notSent: "EBARIMT_NOT_SENT",
} as const;

/** Дахин оролдлогын зай (мс) — оролдлогын тооноос; сүүлийнх нь давтагдана. */
export const EBARIMT_BACKOFF_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
/** Үүнээс хойш оролдохоо болино — failed хэвээр, гараар «Дахин илгээх». */
export const EBARIMT_MAX_ATTEMPTS = 20;
/** Энэ тооны дараалсан алдаанд аудит + мэдэгдэл (`ebarimt_failed`) — нэг л удаа. */
export const EBARIMT_ALERT_AFTER_ATTEMPTS = 3;
/** PosAPI-ийн HTTP timeout — хөнгөн хүсэлтэд (`/rest/info`, гар шалгалт). */
export const POSAPI_TIMEOUT_MS = 10_000;
/**
 * `POST`/`DELETE /rest/receipt`-ийн HTTP timeout. PosAPI daemon ТЕГ рүү нөөцөө
 * түлхэж байх үедээ хариуг хэдэн арван секунд барьдаг (Techpartners SDK-ийн
 * тэмдэглэл, docs/integrations/01 §2 P0-3). 10 сек-д таслаад дахин илгээвэл
 * хүрсэн хүсэлт ДДТД+сугалаа үүсгэчихсэн байж болох тул ХОЁР ДАХЬ ДДТД
 * (ТЕГ-д давхар борлуулалт) гарна — тиймээс урт хүлээнэ. Кассын дэлгэц үүнийг
 * хүлээхгүй (`EBARIMT_INLINE_SEND_TIMEOUT_MS`, Promise.race).
 */
export const POSAPI_RECEIPT_TIMEOUT_MS = 90_000;
/**
 * Борлуулалт батлагдмагц КАССЫН ДЭЛГЭЦ хариуг ХҮЛЭЭХ дээд хугацаа — сугалаа/QR
 * нь DB-д хадгалагдахгүй (албан спек) тул зөвхөн ЭНЭ цонхонд ирсэн хариу л
 * баримт дээр хэвлэгдэнэ; хэтэрвэл баримт QR-гүй гарч, илгээлт дараалалд
 * үргэлжилнэ (ДДТД дахин хэвлэхэд гарна).
 */
export const EBARIMT_INLINE_SEND_TIMEOUT_MS = 8_000;
/** Сугалаа энэ тооноос доош үлдвэл анхааруулна (тестийн checklist). */
export const EBARIMT_LOTTERY_LOW_THRESHOLD = 200;
/** ТЕГ рүү сүүлд илгээснээс хойш энэ цагаас удвал анхааруулна (хуулийн 72ц-ийн 2/3). */
export const EBARIMT_SEND_STALE_HOURS = 48;

export function backoffMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), EBARIMT_BACKOFF_MS.length) - 1;
  return EBARIMT_BACKOFF_MS[index];
}
