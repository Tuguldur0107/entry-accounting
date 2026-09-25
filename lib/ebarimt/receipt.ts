// eBarimt 3.0 payload үүсгэгч — ЦЭВЭР (тесттэй, DB-гүй).
// docs/pos/03-ebarimt-integration-plan.md §4.2.
//
// Дүрэм:
//  1. НӨАТ төлөгч бус → бүх мөр NOT_VAT; төлөгч бол vatMode → VAT_ABLE /
//     VAT_FREE / VAT_ZERO.
//  2. Мөрүүдийг taxType-аар БҮЛЭГЛЭЖ дэд баримт (receipts[]) болгоно.
//  3. Мөрийн дүн = POS-ийн lineTotal (хөнгөлөлтийн дараах, татвар орсон) —
//     computeSaleTotals-той ЯГ ижил; unitPrice = lineTotal / qty (2 орон).
//  4. payments[] = хэлбэрийн ebarimtCode; Σ paidAmount = totalAmount. Зээлээр
//     (`credit`) төлбөр → тэр хэсэг `PAY` статус, баримт `B2C/B2B_INVOICE`
//     (receiptTypeOf; сугалаа олгогдохгүй). Хэсэгчилсэн
//     буцаалтын дараа (Σ мөр < бүтэн төлбөр) төлбөрүүдийг ХУВЬ ТЭНЦҮҮЛЭН
//     хуваарилж, бөөрөнхийллийн зөрүүг хамгийн том төлбөр шингээнэ.
//  5. Ямар нэг зүйл дутуу (ангилал, татварын код, төлбөрийн код, Σ зөрүү) →
//     `[EBARIMT_*]` алдаа ШИДНЭ — payload зохиогдохгүй, борлуулалт зогсохгүй
//     (дуудагч submission-ийг failed болгож шалтгааныг ил харуулна).
//  6. Wire түлхүүр АЛБАН спекийнхээр: `totalVAT` (root, receipts[], items[]) —
//     camelCase `totalVat` гэж явуулбал PosAPI НӨАТ-ыг 0 гэж уншиж болзошгүй
//     (P0-1); `billIdSuffix` заавал (P0-2) — billIdSuffixOf.

import { roundMoney as round2 } from "@/lib/arap/accounting";

import {
  CLASSIFICATION_CODE_RE,
  CONSUMER_NO_RE,
  DISTRICT_CODE_RE,
  EBARIMT_BARCODE_TYPES,
  EBARIMT_ERRORS,
  EBARIMT_INVOICE_PAYMENT_KINDS,
  EBARIMT_PAYMENT_STATUS_PAID,
  EBARIMT_PAYMENT_STATUS_PAY,
  MERCHANT_TIN_RE,
  TAX_PRODUCT_CODE_RE,
  type EbarimtBarcodeType,
  type EbarimtPaymentStatus,
  type EbarimtReceiptType,
  type EbarimtStatus,
  type EbarimtTaxType,
} from "./constants";
import type {
  EbarimtItem,
  EbarimtPayment,
  EbarimtReceiptRequest,
  EbarimtSaleInput,
  EbarimtSaleLineInput,
  EbarimtSettingsInput,
  EbarimtSubReceipt,
} from "./types";

export class EbarimtError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(`[${code}] ${message}`);
    this.name = "EbarimtError";
  }
}

/**
 * Борлуулалт бүртгэх МӨЧИД eBarimt-ийн анхны статус ба автомат илгээх эсэх
 * (createPosSale + AI create_pos_sale нэг дүрэм):
 *  - eBarimt унтраалттай / НӨАТ төлөгч бус → null, илгээхгүй
 *  - гар ДДТД өгсөн → manual (ТЕГ-ийн апп-аар олгосон), илгээхгүй
 *  - кассчин «eBarimt илгээх»-ийг унтраасан → skipped (дараа панелиас илгээж болно)
 *  - бусад → pending, дараалалд орно
 */
export function initialSaleEbarimtStatus(input: {
  enabled: boolean;
  isVatPayer: boolean;
  manualId: string | null;
  skip: boolean;
}): { status: EbarimtStatus | null; autoSend: boolean } {
  if (input.manualId) return { status: "manual", autoSend: false };
  if (!input.enabled || !input.isVatPayer) return { status: null, autoSend: false };
  if (input.skip) return { status: "skipped", autoSend: false };
  return { status: "pending", autoSend: true };
}

/** Тохиргооны бүрэн байдал — дутуу бол шалтгааны жагсаалт (UI + worker хоёулаа). */
export function ebarimtSettingsProblems(settings: EbarimtSettingsInput): string[] {
  const problems: string[] = [];
  if (!MERCHANT_TIN_RE.test(settings.merchantTin.trim())) problems.push("Мерчантын ТТД 11 эсвэл 14 оронтой тоо байна");
  if (!settings.branchNo.trim()) problems.push("Салбарын дугаар (branchNo) хоосон");
  if (!DISTRICT_CODE_RE.test(settings.districtCode.trim())) problems.push("Дүүргийн код 4 оронтой байна");
  if (!settings.posNo.trim()) problems.push("Кассын дугаар (posNo) хоосон");
  if (!/^https?:\/\/\S+$/.test(settings.posApiUrl.trim())) problems.push("PosAPI URL http(s)://… хэлбэртэй байна");
  return problems;
}

export function taxTypeOf(line: Pick<EbarimtSaleLineInput, "vatMode">, isVatPayer: boolean): EbarimtTaxType {
  if (!isVatPayer) return "NOT_VAT";
  switch (line.vatMode) {
    case "exempt":
      return "VAT_FREE";
    case "zero":
      return "VAT_ZERO";
    default:
      return "VAT_ABLE";
  }
}

/** Барааны картын баркодын төрөл → PosAPI `barCodeType` (танигдахгүй бол UNDEFINED). */
export function barcodeTypeOf(value: string | null | undefined): EbarimtBarcodeType {
  const upper = value?.trim().toUpperCase();
  return (EBARIMT_BARCODE_TYPES as readonly string[]).includes(upper ?? "")
    ? (upper as EbarimtBarcodeType)
    : "UNDEFINED";
}

function toItem(line: EbarimtSaleLineInput, taxType: EbarimtTaxType): EbarimtItem {
  const classification = line.classificationCode?.trim() ?? "";
  if (!CLASSIFICATION_CODE_RE.test(classification))
    throw new EbarimtError(
      EBARIMT_ERRORS.unmappedItem,
      `"${line.itemName}" бараанд ТЕГ-ийн ангилалын код (7 орон) байхгүй — барааны карт эсвэл бүлэгт оруулна`
    );
  const taxProductCode = line.taxProductCode?.trim() ?? "";
  if ((taxType === "VAT_FREE" || taxType === "VAT_ZERO") && !TAX_PRODUCT_CODE_RE.test(taxProductCode))
    throw new EbarimtError(
      EBARIMT_ERRORS.taxProductCode,
      `"${line.itemName}" НӨАТ-гүй/0% бараанд татварын бүтээгдэхүүний код (3 орон) байхгүй`
    );
  const qty = round2(line.quantity);
  const totalAmount = round2(line.lineTotal);
  const totalVAT = taxType === "VAT_ABLE" ? round2(line.vatAmount) : 0;
  const item: EbarimtItem = {
    name: line.itemName,
    classificationCode: classification,
    measureUnit: line.unit || "ш",
    qty,
    unitPrice: qty > 0 ? round2(totalAmount / qty) : 0,
    totalVAT,
    totalCityTax: 0,
    totalAmount,
  };
  if (line.barcode) {
    item.barCode = line.barcode;
    item.barCodeType = barcodeTypeOf(line.barcodeType);
  }
  if (taxType === "VAT_FREE" || taxType === "VAT_ZERO") item.taxProductCode = taxProductCode;
  return item;
}

/** Дараа төлөгдөх (нэхэмжлэх) төлбөр мөн эсэх — зээлээр. */
function paymentStatusOf(payment: EbarimtSaleInput["payments"][number]): EbarimtPaymentStatus {
  return EBARIMT_INVOICE_PAYMENT_KINDS.includes(payment.kind)
    ? EBARIMT_PAYMENT_STATUS_PAY
    : EBARIMT_PAYMENT_STATUS_PAID;
}

/**
 * Баримтын төрөл: зээлээр (дараа төлөх) хэсэгтэй бол НЭХЭМЖЛЭХ
 * (`B2C_INVOICE` / `B2B_INVOICE`), үгүй бол RECEIPT; байгууллагын ТТД-тэй бол B2B.
 */
export function receiptTypeOf(
  payments: EbarimtSaleInput["payments"],
  customerTin: string | null
): EbarimtReceiptType {
  const invoice = payments.some(
    (payment) => payment.baseAmount > 0.005 && paymentStatusOf(payment) === EBARIMT_PAYMENT_STATUS_PAY
  );
  if (customerTin) return invoice ? "B2B_INVOICE" : "B2B_RECEIPT";
  return invoice ? "B2C_INVOICE" : "B2C_RECEIPT";
}

/**
 * Төлбөрүүдийг илгээх дүнд (targetTotal) тааруулна. Бүтэн борлуулалтад
 * ижил; хэсэгчилсэн буцаалтын дараа хувь тэнцүүлж, зөрүүг хамгийн том нь
 * шингээнэ. Код хоосон хэлбэр → [EBARIMT_UNMAPPED_PAYMENT].
 */
export function allocatePayments(
  payments: EbarimtSaleInput["payments"],
  targetTotal: number
): EbarimtPayment[] {
  const positive = payments.filter((payment) => payment.baseAmount > 0.005);
  if (positive.length === 0) throw new EbarimtError(EBARIMT_ERRORS.unmappedPayment, "Төлбөр байхгүй");
  for (const payment of positive)
    if (!payment.ebarimtCode?.trim())
      throw new EbarimtError(
        EBARIMT_ERRORS.unmappedPayment,
        `"${payment.methodName}" төлбөрийн хэлбэрт eBarimt код оноогоогүй — Борлуулалт → Тохиргоо → Төлбөрийн хэлбэр`
      );
  const paidTotal = positive.reduce((sum, payment) => sum + payment.baseAmount, 0);
  const factor = paidTotal > 0 ? targetTotal / paidTotal : 0;
  const scaled = positive.map((payment) => ({
    code: payment.ebarimtCode!.trim(),
    status: paymentStatusOf(payment),
    paidAmount: round2(payment.baseAmount * factor),
    ...(payment.reference ? { exchangeCode: payment.reference } : {}),
  }));
  const diff = round2(targetTotal - scaled.reduce((sum, payment) => sum + payment.paidAmount, 0));
  if (Math.abs(diff) > 0.001) {
    const largest = scaled.reduce((best, payment) => (payment.paidAmount > best.paidAmount ? payment : best));
    largest.paidAmount = round2(largest.paidAmount + diff);
  }
  // Ижил код + статустай төлбөрүүдийг нэгтгэнэ (нэг хэлбэрээр хоёр удаа төлсөн).
  const merged = new Map<string, EbarimtPayment>();
  for (const payment of scaled) {
    const key = `${payment.code}|${payment.status}|${payment.exchangeCode ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.paidAmount = round2(existing.paidAmount + payment.paidAmount);
    else merged.set(key, { ...payment });
  }
  return [...merged.values()].filter((payment) => payment.paidAmount > 0.005);
}

const DOCUMENT_NO_RE = /^([A-Za-z]*)-?(\d{2})(\d{2})-(\d+)$/;

/**
 * `billIdSuffix` — албан спек (✔): «Баримтын ДДТД-ыг давхцуулахгүйн тулд олгох
 * дотоод дугаарлалт. Тухайн өдөртөө дахин давтагдашгүй дугаар». PosAPI ижил
 * suffix-тэй хоёр дахь хүсэлтийг давхардал гэж таньдаг (Fibocloud SDK: «used to
 * deduplicate ДДТД») тул:
 *  - НЭГ submission-ийн бүх оролдлогод ИЖИЛ утга (timeout → backoff → дахин
 *    илгээхэд хоёр дахь ДДТД үүсэхгүй — P0-3);
 *  - тухайн борлуулалтын ДАРААГИЙН бичилт (`inactiveId` засвар, цуцлагдсаны
 *    дараах дахин илгээлт) бүрд ӨӨР — `edit` = өмнөх submission-ийн тоо.
 *
 *   POS-2609-0001 → "090001"          MM + NNNN (сарын дараалал — өдөртөө давтагдахгүй;
 *                                      сарын хил дээр хоцорч илгээгдсэн баримт ч MM-ээр ялгарна)
 *   edit=1        → "09000101"        + 2 оронтой засварын дугаар
 *   RET-2609-0001 → "9090001"         POS биш угтварт тэргүүлэх "9" — буцаалтын баримт
 *                                      өөрөө илгээгдэхгүй ч эх борлуулалттай хэзээ ч давхцахгүй
 *   танигдахгүй хэлбэр → бүх цифр       (POS биш үсгэн угтварт мөн "9"; цифргүй бол [EBARIMT_BILL_ID])
 *
 * Зөвхөн цифр, ердийн тохиолдолд 6–8 орон — зөвшөөрөгдөх тэмдэгт/урт албан
 * баримтад бичигдээгүй тул хамгийн болгоомжтой хэлбэр (docs/integrations/01 §4.1 (4)).
 */
export function billIdSuffixOf(documentNo: string, edit = 0): string {
  const trimmed = documentNo.trim();
  if (!Number.isInteger(edit) || edit < 0 || edit > 99)
    throw new EbarimtError(EBARIMT_ERRORS.billId, `billIdSuffix-ийн засварын дугаар 0–99 байна (${edit})`);
  const match = DOCUMENT_NO_RE.exec(trimmed);
  const prefix = (match ? match[1] : trimmed.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  const digits = match ? `${match[3]}${match[4]}` : trimmed.replace(/\D/g, "");
  if (!digits)
    throw new EbarimtError(EBARIMT_ERRORS.billId, `Борлуулалтын дугаар "${documentNo}"-аас billIdSuffix гаргах боломжгүй (цифргүй)`);
  const base = prefix === "POS" || prefix === "" ? digits : `9${digits}`;
  return edit > 0 ? `${base}${String(edit).padStart(2, "0")}` : base;
}

/**
 * Борлуулалт → PosAPI 3.0 хүсэлт. Шидвэл payload зохиогдохгүй.
 * `inactiveId` = засварлах (хэсэгчилсэн буцаалт) баримтын ДДТД — албан спек §5:
 * эх баримт солигдоно, сугалаа дахин олгогдохгүй. Бүтэн буцаалт бол DELETE (§6).
 * `edit` = энэ борлуулалтын ӨМНӨХ submission-ийн тоо (`billIdSuffixOf`) — өгөөгүй
 * бол inactiveId-тай засварт 1, эс бөгөөс 0.
 */
export function buildEbarimtReceipt(
  sale: EbarimtSaleInput,
  settings: EbarimtSettingsInput,
  options: { inactiveId?: string | null; edit?: number } = {}
): EbarimtReceiptRequest {
  const problems = ebarimtSettingsProblems(settings);
  if (problems.length > 0) throw new EbarimtError(EBARIMT_ERRORS.settings, problems.join("; "));

  const activeLines = sale.lines.filter((line) => line.quantity > 1e-9);
  if (activeLines.length === 0)
    throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, "Илгээх мөр байхгүй (бүгд буцаагдсан)");

  const groups = new Map<EbarimtTaxType, EbarimtItem[]>();
  for (const line of activeLines) {
    const taxType = taxTypeOf(line, sale.isVatPayer);
    const list = groups.get(taxType) ?? [];
    list.push(toItem(line, taxType));
    groups.set(taxType, list);
  }
  const merchantTin = settings.merchantTin.trim();
  const receipts: EbarimtSubReceipt[] = [...groups.entries()].map(([taxType, items]) => ({
    taxType,
    merchantTin,
    totalAmount: round2(items.reduce((sum, item) => sum + item.totalAmount, 0)),
    totalVAT: round2(items.reduce((sum, item) => sum + item.totalVAT, 0)),
    totalCityTax: 0,
    items,
  }));
  const totalAmount = round2(receipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0));
  const totalVAT = round2(receipts.reduce((sum, receipt) => sum + receipt.totalVAT, 0));
  if (totalAmount <= 0) throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, "Баримтын дүн 0");

  const customerTin = sale.customerTin?.trim() || null;
  if (customerTin && !MERCHANT_TIN_RE.test(customerTin))
    throw new EbarimtError(EBARIMT_ERRORS.settings, "Худалдан авагчийн ТТД 11 эсвэл 14 оронтой байна");
  const consumerNo = sale.consumerNo?.trim() || null;
  if (consumerNo && !CONSUMER_NO_RE.test(consumerNo))
    throw new EbarimtError(EBARIMT_ERRORS.settings, "Иргэний eBarimt дугаар 8 оронтой байна");

  const inactiveId = options.inactiveId?.trim() || null;
  const request: EbarimtReceiptRequest = {
    totalAmount,
    totalVAT,
    totalCityTax: 0,
    // Засвар (inactiveId) бол edit ≥ 1 ЗААВАЛ — эх баримтын suffix-тэй ижил явуулбал
    // PosAPI давхардал гэж үзээд шинэ ДДТД олгохгүй байж болзошгүй.
    billIdSuffix: billIdSuffixOf(sale.documentNo, options.edit ?? (inactiveId ? 1 : 0)),
    branchNo: settings.branchNo.trim(),
    districtCode: settings.districtCode.trim(),
    merchantTin,
    posNo: settings.posNo.trim(),
    type: receiptTypeOf(sale.payments, customerTin),
    receipts,
    payments: allocatePayments(sale.payments, totalAmount),
  };
  if (customerTin) request.customerTin = customerTin;
  else if (consumerNo) request.consumerNo = consumerNo;
  if (inactiveId) request.inactiveId = inactiveId;

  const paid = round2(request.payments.reduce((sum, payment) => sum + payment.paidAmount, 0));
  if (Math.abs(paid - totalAmount) > 0.011)
    throw new EbarimtError(
      EBARIMT_ERRORS.totalMismatch,
      `Төлбөрийн нийлбэр ${paid} ≠ баримтын дүн ${totalAmount}`
    );
  return request;
}

/** Хариуг үнэлнэ — ДДТД ирсэн бол амжилт; үгүй бол PosAPI-ийн мессежийг өгнө. */
export function receiptResponseOutcome(response: {
  id?: string;
  status?: string;
  message?: string;
}): { ok: true; id: string } | { ok: false; message: string } {
  const id = typeof response.id === "string" ? response.id.trim() : "";
  const status = typeof response.status === "string" ? response.status.toUpperCase() : "";
  if (id && status !== "ERROR") return { ok: true, id };
  return {
    ok: false,
    message: (typeof response.message === "string" && response.message.trim()) || `PosAPI татгалзав (status: ${status || "?"})`,
  };
}

/**
 * PosAPI-ийн хариунаас ХАДГАЛЖ БОЛОХГҮЙ талбарыг хасна (албан спек §5:
 * «lottery болон qrData талбаруудын мэдээллийг хэрэглэгчийн системд хадгалахыг
 * хориглоно»). Дараалал / аудитад үлдэх `response` jsonb ҮҮГЭЭР дамжина;
 * дэд баримт (`receipts[]`) дотор ч мөн адил. Эх объектыг хөндөхгүй.
 */
export function stripReceiptSecrets(raw: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...raw };
  delete rest.lottery;
  delete rest.qrData;
  const receipts = rest.receipts;
  if (Array.isArray(receipts)) {
    rest.receipts = receipts.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? stripReceiptSecrets(entry as Record<string, unknown>)
        : entry
    );
  }
  return rest;
}
