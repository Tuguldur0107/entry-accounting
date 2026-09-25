// eBarimt 3.0 — plain төрлүүд (client-safe). PosAPI 3.0 JSON яг тэр
// нэршлээр; Entry-ийн оролт (EbarimtSaleInput) нь борлуулалтаас ЦЭВЭР
// байдлаар тусгаарлагдсан тул receipt.ts тесттэй.

import type { PaymentKind, VatMode } from "@/lib/pos/constants";

import type { EbarimtBarcodeType, EbarimtPaymentStatus, EbarimtReceiptType, EbarimtStatus, EbarimtTaxType } from "./constants";

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
  /** Wire түлхүүр ЯГ `totalVAT` (албан спек, Fibocloud/Java SDK) — `totalVat` БИШ. */
  totalVAT: number;
  totalCityTax: number;
  totalAmount: number;
}

export interface EbarimtSubReceipt {
  taxType: EbarimtTaxType;
  merchantTin: string;
  totalAmount: number;
  totalVAT: number;
  totalCityTax: number;
  items: EbarimtItem[];
}

export interface EbarimtPayment {
  code: string;
  /** PAID = төлөгдсөн; PAY = нэхэмжлэхийн дараа төлөгдөх хэсэг (зээл). */
  status: EbarimtPaymentStatus;
  paidAmount: number;
  /** Гуравдагч системийн лавлагаа (картын слип, QPay гүйлгээ). */
  exchangeCode?: string;
}

export interface EbarimtReceiptRequest {
  totalAmount: number;
  totalVAT: number;
  totalCityTax: number;
  /**
   * Албан спек (✔ шаардлагатай): «Баримтын ДДТД-ыг давхцуулахгүйн тулд олгох
   * дотоод дугаарлалт. Тухайн өдөртөө дахин давтагдашгүй дугаар». Нэг
   * submission-ийн БҮХ оролдлогод ИЖИЛ (timeout-ын дараах дахин илгээлтийг
   * PosAPI давхардал гэж таньдаг), борлуулалтын дараагийн бичилт бүрд ӨӨР —
   * `billIdSuffixOf` (receipt.ts).
   */
  billIdSuffix: string;
  branchNo: string;
  districtCode: string;
  merchantTin: string;
  posNo: string;
  type: EbarimtReceiptType;
  customerTin?: string;
  consumerNo?: string;
  /**
   * Засварлах (хэсэгчилсэн буцаалт) баримтын ДДТД — албан спек §5 «Баримтын
   * засвар»: шинэ бичилт эхийг ОРЛОНО, сугалаа дахин олгогдохгүй; дараагийн
   * засварт ӨМНӨХ (сүүлийн) ДДТД-г өгч гинжлэнэ. DELETE нь зөвхөн БҮТЭН буцаалт.
   */
  inactiveId?: string;
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

/**
 * `GET /rest/info`-ийн уншигдахуйц хэлбэр (parsePosApiInfo, ЦЭВЭР). Албан спек
 * §6: operatorName/operatorTIN, posNo (8 орон), lastSentDate, leftLotteries,
 * merchants[]. Сугалаа дуусах, илгээлт хоцрох анхааруулгын ЭХ.
 */
export interface PosApiHealth {
  operatorName: string | null;
  operatorTin: string | null;
  posNo: string | null;
  /** Сүүлд ТЕГ рүү илгээсэн огноо "yyyy-MM-dd HH:mm:ss" (PosAPI-ийн цаг). */
  lastSentDate: string | null;
  /** Үлдсэн сугалааны тоо — null бол PosAPI өгөөгүй. */
  leftLotteries: number | null;
  /** PosAPI-д бүртгэлтэй (операторын хүсэлтийг батласан) мерчантууд. */
  merchants: { name: string; tin: string }[];
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
  /** Барааны картын баркодын төрөл — хоосон/танигдахгүй бол "UNDEFINED". */
  barcodeType?: string | null;
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
  /**
   * PosAPI-ийн амьд байдал (`/rest/info`, server горим, ≤5 сек) — хүрэхгүй бол
   * null. Мерчант нь энэ PosAPI-д бүртгэлтэй эсэх (`merchantRegistered`) нь
   * операторын хүсэлтийг харилцагч батласан эсэхийг ИЛ харуулна.
   */
  posApi: (PosApiHealth & { merchantRegistered: boolean | null }) | null;
  /** Сүүлийн амжилттай `/rest/receipt` хариуны `version` (жишээ 3.2.44) — ≥ 3.0.12 байх ёстой (P2-10). */
  posApiVersion: string | null;
  /** Мерчантын ТЕГ бүртгэл (`getInfo?tin=`, server горим) — НХАТ/чөлөөлөгдөх төслийн анхааруулга (P2-4). null = лавлах хүрээгүй. */
  merchant: { name: string; vatPayer: boolean | null; cityPayer: boolean | null; freeProject: boolean | null } | null;
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

/**
 * Илгээлтийн ТҮР үр дүн — зөвхөн тухайн баримтыг НЭГ удаа хэвлэхэд. Сугалаа ба
 * QR-ийг DB-д ХАДГАЛАХЫГ албан спек хориглодог («lottery болон qrData … хэрэглэгчийн
 * системд хадгалахыг хориглоно») тул эдгээр нь `pos_sales`-д ОРОХГҮЙ; дахин
 * хэвлэхэд зөвхөн ДДТД гарна.
 */
export interface EbarimtSaleResult {
  ebarimtId: string | null;
  ebarimtLottery: string | null;
  ebarimtQrData: string | null;
  ebarimtDate: string | null;
  ebarimtType: string | null;
  ebarimtStatus: EbarimtStatus | null;
}
