// QPay intent-ийн ЦЭВЭР дүрмүүд (DB-гүй, CLIENT-SAFE, тесттэй) — docs/pos/04 §3.3.
// Гарын үсгийн шалгалт node `crypto` шаарддаг тул webhook-signature.ts-д (server).
// Шилжилт: open → paid → finalized; open → cancelled | expired | failed.
// Webhook = ДОХИО (dashboard `verifyAndMarkPaid` баталгаажуулсан), Entry
// нэмээд гарын үсэг + ДҮНГ өөрийн intent-тэй тулгана.

import {
  QPAY_CHECK_MIN_INTERVAL_MS,
  QPAY_INVOICE_TTL_DEFAULT_SEC,
  QPAY_INVOICE_TTL_MAX_SEC,
  QPAY_INVOICE_TTL_MIN_SEC,
  type QpayIntentStatus,
} from "./constants";
import type { QpayWebhookPayload } from "./types";

const TRANSITIONS: Record<QpayIntentStatus, readonly QpayIntentStatus[]> = {
  open: ["paid", "cancelled", "expired", "failed"],
  paid: ["finalized"],
  finalized: [],
  cancelled: [],
  expired: [],
  failed: [],
};

export function canTransition(from: QpayIntentStatus, to: QpayIntentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Intent-ийн эцсийн (өөрчлөгдөхгүй) төлөв үү. */
export function isTerminalStatus(status: QpayIntentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Тохиргооны TTL — хязгаар дотор, гажиг бол default. */
export function clampInvoiceTtl(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return QPAY_INVOICE_TTL_DEFAULT_SEC;
  return Math.min(QPAY_INVOICE_TTL_MAX_SEC, Math.max(QPAY_INVOICE_TTL_MIN_SEC, n));
}

/** `open` intent хугацаа нь дууссан уу (expiresAt ≤ now). */
export function isExpired(intent: { status: QpayIntentStatus; expiresAt: Date | string }, now: Date): boolean {
  if (intent.status !== "open") return false;
  const at = intent.expiresAt instanceof Date ? intent.expiresAt : new Date(intent.expiresAt);
  return at.getTime() <= now.getTime();
}

/** QPay-руу дахин шалгах зөвшөөрөгдөх үү — сүүлийн шалгалтаас ≥ доод зай. */
export function checkAllowed(lastCheckAt: Date | null, now: Date, minIntervalMs = QPAY_CHECK_MIN_INTERVAL_MS): boolean {
  if (!lastCheckAt) return true;
  return now.getTime() - lastCheckAt.getTime() >= minIntervalMs;
}

/** MNT бүхэл — dashboard бөөрөнхийлдөг тул 0.5₮ дотор таарвал ижил. */
export function amountMatches(intentAmount: number, paidAmount: number | null | undefined): boolean {
  if (paidAmount == null || !Number.isFinite(paidAmount)) return false;
  return Math.abs(Math.round(intentAmount) - Math.round(paidAmount)) < 1;
}

/** QPay-д илгээх бүхэл дүн — сөрөг/гажиг бол null. */
export function invoiceAmountOf(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Webhook body → нормчилсон payload; хэлбэр буруу бол null. */
export function parseWebhookPayload(body: unknown): QpayWebhookPayload | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (raw.event !== "payment.paid") return null;
  const invoiceId = typeof raw.invoice_id === "string" ? raw.invoice_id.trim() : "";
  if (!invoiceId) return null;
  const amount = Number(raw.amount);
  return {
    event: "payment.paid",
    invoiceId,
    senderInvoiceNo: typeof raw.sender_invoice_no === "string" ? raw.sender_invoice_no : null,
    amount: Number.isFinite(amount) ? amount : NaN,
    paymentId: typeof raw.payment_id === "string" ? raw.payment_id : null,
    paidAt: typeof raw.paid_at === "string" ? raw.paid_at : null,
  };
}

/** Кассын дэлгэцийн таймер — үлдсэн секунд (0-оос доошгүй). */
export function secondsLeft(expiresAt: Date | string, now: Date): number {
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 1000));
}
