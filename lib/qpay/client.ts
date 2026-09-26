// qpay-dashboard REST v1 клиент (DB-гүй) — docs/API.md (ХӨЛДӨӨСӨН гэрээ).
// Entry QPay-тэй ШУУД ярихгүй: токен, sub-merchant, банкны данс, ККТТ-ийн
// дүрэм бүгд dashboard-д. Алдаа → QpayError([QPAY_DASHBOARD] …).

import { QPAY_ERRORS, QPAY_HTTP_TIMEOUT_MS } from "./constants";
import type { DashboardInvoice, DashboardInvoiceRow, DashboardPaymentCheck } from "./types";

export class QpayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number
  ) {
    super(`[${code}] ${message}`);
    this.name = "QpayError";
  }
}

export interface QpayClientConfig {
  apiUrl: string;
  apiKey: string;
}

async function call<T>(config: QpayClientConfig, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const base = config.apiUrl.replace(/\/$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(QPAY_HTTP_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new QpayError(
      QPAY_ERRORS.dashboard,
      `QPay dashboard-д хүрсэнгүй (${error instanceof Error ? error.message : "network"})`
    );
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    const detail = typeof data.error === "string" ? data.error : text.slice(0, 160) || res.statusText;
    const hint =
      res.status === 401
        ? // Dashboard дээр key солигдсон (rotate / дахин холболт) үед Entry-д хадгалсан
          // хуучин key хүчингүй болдог — засах зам нь нэг товч (2026-09-26 пилот).
          "API key буруу эсвэл хүчингүй — POS тохиргоо → QPay → [QPay дахин холбох]"
        : res.status === 403
          ? "API хандалт идэвхгүй / акаунт түдгэлзсэн"
          : res.status === 409
            ? "Мерчантад банкны данс холбогдоогүй"
            : res.status === 429
              ? "Хүсэлтийн хязгаар хэтэрсэн (120/мин)"
              : `HTTP ${res.status}`;
    throw new QpayError(QPAY_ERRORS.dashboard, `${hint}: ${detail}`, res.status);
  }
  return data as T;
}

function normalizeUrls(value: unknown): DashboardInvoice["urls"] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({
      name: String(entry.name ?? ""),
      logo: String(entry.logo ?? ""),
      link: String(entry.link ?? ""),
    }))
    .filter((entry) => entry.link);
}

export async function createDashboardInvoice(
  config: QpayClientConfig,
  input: {
    senderInvoiceNo: string;
    amount: number;
    description: string;
    callbackUrl: string | null;
    /**
     * Салбарын (агуулахын) QPay данс — мерчантын sync-лэсэн дансны дугаар;
     * dashboard энэ нэхэмжлэхийн төлбөрийг ТЭР данс руу чиглүүлнэ. null =
     * мерчантын үндсэн данс. Бүртгэлгүй дугаар → dashboard 400 (данс зохиохгүй).
     */
    payoutAccountNumber?: string | null;
  }
): Promise<DashboardInvoice> {
  const data = await call<Record<string, unknown>>(config, "POST", "/api/v1/invoices", {
    sender_invoice_no: input.senderInvoiceNo,
    amount: input.amount,
    invoice_description: input.description,
    ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    ...(input.payoutAccountNumber ? { payout_account_number: input.payoutAccountNumber } : {}),
  });
  const invoiceId = String(data.invoice_id ?? data.id ?? "").trim();
  if (!invoiceId) throw new QpayError(QPAY_ERRORS.dashboard, "Нэхэмжлэхийн id ирсэнгүй");
  return {
    invoiceId,
    qrText: String(data.qr_text ?? data.qr_code ?? ""),
    qrImage: typeof data.qr_image === "string" && data.qr_image ? data.qr_image : null,
    urls: normalizeUrls(data.urls),
    invoiceStatus: typeof data.invoice_status === "string" ? data.invoice_status : null,
  };
}

export async function cancelDashboardInvoice(config: QpayClientConfig, invoiceId: string): Promise<void> {
  await call(config, "DELETE", `/api/v1/invoices/${encodeURIComponent(invoiceId)}`);
}

export async function checkDashboardPayment(config: QpayClientConfig, invoiceId: string): Promise<DashboardPaymentCheck> {
  const data = await call<Record<string, unknown>>(
    config,
    "GET",
    `/api/v1/payments/check?invoice_id=${encodeURIComponent(invoiceId)}`
  );
  const status = String(data.invoice_status ?? "").toUpperCase();
  const paidAmount = Number(data.paid_amount ?? data.payment_amount);
  return {
    paid: data.paid === true || status === "PAID",
    invoiceStatus: status || "UNKNOWN",
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : null,
  };
}

/** Холболт шалгах + сүүлийн нэхэмжлэхүүд (QPay-д хүрэхгүй, хямд). */
export async function listDashboardInvoices(
  config: QpayClientConfig,
  limit = 5
): Promise<{ merchantId: string | null; invoices: DashboardInvoiceRow[] }> {
  const data = await call<Record<string, unknown>>(config, "GET", `/api/v1/invoices?limit=${limit}`);
  const rows = Array.isArray(data.invoices) ? (data.invoices as Record<string, unknown>[]) : [];
  return {
    merchantId: typeof data.merchant_id === "string" ? data.merchant_id : null,
    invoices: rows.map((row) => ({
      invoiceId: String(row.invoice_id ?? ""),
      senderInvoiceNo: typeof row.sender_invoice_no === "string" ? row.sender_invoice_no : null,
      amount: Number(row.amount) || 0,
      status: String(row.status ?? ""),
      createdAt: String(row.created_at ?? ""),
      paidAt: typeof row.paid_at === "string" ? row.paid_at : null,
    })),
  };
}
