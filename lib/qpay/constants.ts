// QPay (qpay-dashboard хаалга) — литералын ЦОРЫН ГАНЦ эх сурвалж. CLIENT-SAFE
// (DB импортгүй). docs/pos/04-qpay-integration-plan.md §3.

/** `pos_payment_methods.provider` утга — ewallet kind-ийн QPay дэд төрөл. */
export const QPAY_PROVIDER = "qpay" as const;

export const QPAY_DEFAULT_API_URL = "https://qpay-dashboard-production.up.railway.app";
/** Entry-ийн webhook хүлээн авагчийн зам (NEXT_PUBLIC_APP_URL + энэ). */
export const QPAY_WEBHOOK_PATH = "/api/pos/qpay/webhook";

/** pos_qpay_intents.status */
export const QPAY_INTENT_STATUSES = ["open", "paid", "finalized", "cancelled", "expired", "failed"] as const;
export type QpayIntentStatus = (typeof QPAY_INTENT_STATUSES)[number];
export const QPAY_INTENT_STATUS_LABELS: Record<QpayIntentStatus, string> = {
  open: "Төлбөр хүлээж байна",
  paid: "Төлөгдсөн — борлуулалт бүртгэгдээгүй",
  finalized: "Борлуулалт бүртгэгдсэн",
  cancelled: "Цуцлагдсан",
  expired: "Хугацаа дууссан",
  failed: "Алдаатай",
};

/** Нэхэмжлэхийн хүчинтэй хугацаа (сек) — тохиргоо, доод/дээд хязгаартай. */
export const QPAY_INVOICE_TTL_DEFAULT_SEC = 180;
export const QPAY_INVOICE_TTL_MIN_SEC = 60;
export const QPAY_INVOICE_TTL_MAX_SEC = 900;

/**
 * QPay-руу (dashboard `payments/check`) гар шалгалтын доод зай — ККТТ «cron /
 * bill-check тогтмол ажиллуулахыг» хориглодог (гэрээ §4.1.5); кассын дэлгэц
 * ЗӨВХӨН Entry DB-ээс уншина.
 */
export const QPAY_CHECK_MIN_INTERVAL_MS = 10_000;
/** Кассын дэлгэц intent-ийн төлөвийг Entry DB-ээс уншдаг давтамж. */
export const QPAY_STATUS_POLL_MS = 2_000;
/** `paid` боловч борлуулалт бүртгэгдээгүй intent — хэдэн минутын дараа дохио. */
export const QPAY_PAID_UNFINALIZED_MINUTES = 10;
/** Dashboard-руу хийх HTTP хүсэлтийн timeout. */
export const QPAY_HTTP_TIMEOUT_MS = 8_000;

export const QPAY_ERRORS = {
  notConfigured: "QPAY_NOT_CONFIGURED",
  disabled: "QPAY_DISABLED",
  intentRequired: "QPAY_INTENT_REQUIRED",
  intentNotPaid: "QPAY_INTENT_NOT_PAID",
  amountMismatch: "QPAY_AMOUNT_MISMATCH",
  alreadyFinalized: "QPAY_ALREADY_FINALIZED",
  checkThrottled: "QPAY_CHECK_THROTTLED",
  dashboard: "QPAY_DASHBOARD",
  webhookSignature: "QPAY_WEBHOOK_SIGNATURE",
} as const;
