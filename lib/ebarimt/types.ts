// eBarimt 3.0 — plain төрлүүд (client-safe). PosAPI 3.0 JSON яг тэр
// нэршлээр; Entry-ийн оролт (EbarimtSaleInput) нь борлуулалтаас ЦЭВЭР
// байдлаар тусгаарлагдсан тул receipt.ts тесттэй.

import type { PaymentKind, VatMode } from "@/lib/pos/constants";

import type { EbarimtBarcodeType, EbarimtReceiptType, EbarimtStatus, EbarimtTaxType } from "./constants";

// ── PosAPI 3.0 JSON ────────────────────────────────────────────────────────

export interface EbarimtItem {
  name: string;
  barCode?: string;
  barCodeType?: EbarimtBarcodeType;
  classificationCode: string;
  taxProductCode?: string;
  measureUnit: string;
  qty: number;
  /** Татвар ОРСОН нэгж үнэ. */
  unitPrice: number;
  totalVat: number;
  totalCityTax: number;
  totalAmount: number;
}

export interface EbarimtSubReceipt {
  taxType: EbarimtTaxType;
  merchantTin: string;
  totalAmount: number;
  totalVat: number;
  totalCityTax: number;
  items: EbarimtItem[];
}

export interface EbarimtPayment {
  code: string;
  status: "PAID";
  paidAmount: number;
  /** Гуравдагч системийн лавлагаа (картын слип, QPay гүйлгээ). */
  exchangeCode?: string;
}

export interface EbarimtReceiptRequest {
  totalAmount: number;
  totalVat: number;
  totalCityTax: number;
  branchNo: string;
  districtCode: string;
  merchantTin: string;
  posNo: string;
  type: EbarimtReceiptType;
  customerTin?: string;
  consumerNo?: string;
  receipts: EbarimtSubReceipt[];
  payments: EbarimtPayment[];
}

/** PosAPI-ийн хариу — амжилтад id/lottery/qrData/date; алдаанд message. */
export interface EbarimtReceiptResponse {
  id?: string;
  status?: string;
  message?: string;
  lottery?: string;
  qrData?: string;
  date?: string;
  easy?: boolean;
  [key: string]: unknown;
}

export interface EbarimtDeleteRequest {
  id: string;
  date: string;
}

export interface PosApiInfo {
  [key: string]: unknown;
}

// ── Entry-ийн оролт (борлуулалтаас ЦЭВЭР) ─────────────────────────────────

export interface EbarimtSettingsInput {
  enabled: boolean;
  merchantTin: string;
  branchNo: string;
  districtCode: string;
  posNo: string;
  posApiUrl: string;
  mode: "server" | "browser";
}

export interface EbarimtSaleLineInput {
  itemName: string;
  barcode: string | null;
  unit: string;
  vatMode: VatMode;
  /** Барааных, хоосон бол бүлгийнх (ачаалагч өвлүүлж өгнө). */
  classificationCode: string | null;
  taxProductCode: string | null;
  /** Үлдсэн (буцаагдаагүй) тоо — 0 бол мөр илгээгдэхгүй. */
  quantity: number;
  /** Хөнгөлөлтийн ДАРААХ мөрийн дүн (татвар орсон) — үлдсэн тоонд. */
  lineTotal: number;
  vatAmount: number;
}

export interface EbarimtSalePaymentInput {
  kind: PaymentKind;
  methodName: string;
  /** pos_payment_methods.ebarimtCode — хоосон бол илгээгдэхгүй. */
  ebarimtCode: string | null;
  /** MNT дүн (хариулт ХАСАГДСАН). */
  baseAmount: number;
  reference: string | null;
}

export interface EbarimtSaleInput {
  saleId: string;
  documentNo: string;
  isVatPayer: boolean;
  /** Байгууллагын ТТД өгсөн бол B2B, үгүй бол B2C. */
  customerTin: string | null;
  consumerNo: string | null;
  lines: EbarimtSaleLineInput[];
  payments: EbarimtSalePaymentInput[];
  /** Борлуулалтын төлөх дүн (бүтэн); хэсэгчилсэн буцаалтын дараа Σ мөр бага байна. */
  total: number;
}

export interface EbarimtStatusSummary {
  enabled: boolean;
  mode: "server" | "browser";
  pending: number;
  failed: number;
  sentToday: number;
  lastSentAt: string | null;
  lastError: string | null;
}

export interface EbarimtSubmissionView {
  id: string;
  saleId: string;
  documentNo: string;
  kind: "send" | "cancel";
  status: "pending" | "sent" | "failed" | "cancelled";
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  sentAt: string | null;
  payload: EbarimtReceiptRequest | null;
  /** Цуцлах хүсэлт (kind=cancel). */
  cancel: EbarimtDeleteRequest | null;
}

export interface EbarimtSaleResult {
  ebarimtId: string | null;
  ebarimtLottery: string | null;
  ebarimtQrData: string | null;
  ebarimtDate: string | null;
  ebarimtType: string | null;
  ebarimtStatus: EbarimtStatus | null;
}
