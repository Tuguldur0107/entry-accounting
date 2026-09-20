// QPay — dashboard REST v1 (qpay-dashboard docs/API.md, ХӨЛДӨӨСӨН гэрээ) ба
// Entry-ийн intent харагдац. CLIENT-SAFE.

import type { QpayIntentStatus } from "./constants";

/** Dashboard `POST /api/v1/invoices` хариу (нормчилсон нэрс). */
export interface DashboardInvoice {
  invoiceId: string;
  qrText: string;
  qrImage: string | null;
  urls: { name: string; logo: string; link: string }[];
  invoiceStatus: string | null;
}

/** Dashboard `GET /api/v1/invoices` мөр. */
export interface DashboardInvoiceRow {
  invoiceId: string;
  senderInvoiceNo: string | null;
  amount: number;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

/** Dashboard `GET /api/v1/payments/check` хариу. */
export interface DashboardPaymentCheck {
  paid: boolean;
  invoiceStatus: string;
  paidAmount: number | null;
}

/** Dashboard `payment.paid` webhook body (docs/API.md). */
export interface QpayWebhookPayload {
  event: "payment.paid";
  invoiceId: string;
  senderInvoiceNo: string | null;
  amount: number;
  paymentId: string | null;
  paidAt: string | null;
}

/** Кассын дэлгэц / жагсаалтын харагдац (нууц, snapshot байхгүй). */
export interface QpayIntentView {
  id: string;
  status: QpayIntentStatus;
  amount: number;
  qpayInvoiceId: string | null;
  qrText: string | null;
  qrImage: string | null;
  urls: { name: string; logo: string; link: string }[];
  paymentId: string | null;
  paidAt: string | null;
  expiresAt: string;
  saleId: string | null;
  saleDocumentNo: string | null;
  lastError: string | null;
  createdAt: string;
  cashierName: string;
  /** Snapshot-ын товч — жагсаалтад (мөрийн тоо, харилцагч). */
  lineCount: number;
}

export interface QpayStatusSummary {
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  merchantId: string | null;
  /** NEXT_PUBLIC_APP_URL + webhook зам; null = нийтийн URL тохируулаагүй. */
  webhookUrl: string | null;
  invoiceTtlSec: number;
  openIntents: number;
  paidUnfinalized: number;
  finalizedToday: number;
}
