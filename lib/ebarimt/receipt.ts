// eBarimt 3.0 payload үүсгэгч — ЦЭВЭР (тесттэй, DB-гүй).
// docs/pos/03-ebarimt-integration-plan.md §4.2.
//
// Дүрэм:
//  1. НӨАТ төлөгч бус → бүх мөр NOT_VAT; төлөгч бол vatMode → VAT_ABLE /
//     VAT_FREE / VAT_ZERO.
//  2. Мөрүүдийг taxType-аар БҮЛЭГЛЭЖ дэд баримт (receipts[]) болгоно.
//  3. Мөрийн дүн = POS-ийн lineTotal (хөнгөлөлтийн дараах, татвар орсон) —
//     computeSaleTotals-той ЯГ ижил; unitPrice = lineTotal / qty (2 орон).
//  4. payments[] = хэлбэрийн ebarimtCode; Σ paidAmount = totalAmount. Хэсэгчилсэн
//     буцаалтын дараа (Σ мөр < бүтэн төлбөр) төлбөрүүдийг ХУВЬ ТЭНЦҮҮЛЭН
//     хуваарилж, бөөрөнхийллийн зөрүүг хамгийн том төлбөр шингээнэ.
//  5. Ямар нэг зүйл дутуу (ангилал, татварын код, төлбөрийн код, Σ зөрүү) →
//     `[EBARIMT_*]` алдаа ШИДНЭ — payload зохиогдохгүй, борлуулалт зогсохгүй
//     (дуудагч submission-ийг failed болгож шалтгааныг ил харуулна).

import { roundMoney as round2 } from "@/lib/arap/accounting";

import {
  CLASSIFICATION_CODE_RE,
  CONSUMER_NO_RE,
  DISTRICT_CODE_RE,
  EBARIMT_ERRORS,
  MERCHANT_TIN_RE,
  TAX_PRODUCT_CODE_RE,
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
  const totalVat = taxType === "VAT_ABLE" ? round2(line.vatAmount) : 0;
  const item: EbarimtItem = {
    name: line.itemName,
    classificationCode: classification,
    measureUnit: line.unit || "ш",
    qty,
    unitPrice: qty > 0 ? round2(totalAmount / qty) : 0,
    totalVat,
    totalCityTax: 0,
    totalAmount,
  };
  if (line.barcode) {
    item.barCode = line.barcode;
    item.barCodeType = "UNDEFINED";
  }
  if (taxType === "VAT_FREE" || taxType === "VAT_ZERO") item.taxProductCode = taxProductCode;
  return item;
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
    status: "PAID" as const,
    paidAmount: round2(payment.baseAmount * factor),
    ...(payment.reference ? { exchangeCode: payment.reference } : {}),
  }));
  const diff = round2(targetTotal - scaled.reduce((sum, payment) => sum + payment.paidAmount, 0));
  if (Math.abs(diff) > 0.001) {
    const largest = scaled.reduce((best, payment) => (payment.paidAmount > best.paidAmount ? payment : best));
    largest.paidAmount = round2(largest.paidAmount + diff);
  }
  // Ижил кодтой төлбөрүүдийг нэгтгэнэ (нэг хэлбэрээр хоёр удаа төлсөн).
  const merged = new Map<string, EbarimtPayment>();
  for (const payment of scaled) {
    const key = `${payment.code}|${payment.exchangeCode ?? ""}`;
    const existing = merged.get(key);
    if (existing) existing.paidAmount = round2(existing.paidAmount + payment.paidAmount);
    else merged.set(key, { ...payment });
  }
  return [...merged.values()].filter((payment) => payment.paidAmount > 0.005);
}

/**
 * Борлуулалт → PosAPI 3.0 хүсэлт. Шидвэл payload зохиогдохгүй.
 * `inactiveId` = засварлах (хэсэгчилсэн буцаалт) баримтын ДДТД — албан спек §5:
 * эх баримт солигдоно, сугалаа дахин олгогдохгүй. Бүтэн буцаалт бол DELETE (§6).
 */
export function buildEbarimtReceipt(
  sale: EbarimtSaleInput,
  settings: EbarimtSettingsInput,
  options: { inactiveId?: string | null } = {}
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
    totalVat: round2(items.reduce((sum, item) => sum + item.totalVat, 0)),
    totalCityTax: 0,
    items,
  }));
  const totalAmount = round2(receipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0));
  const totalVat = round2(receipts.reduce((sum, receipt) => sum + receipt.totalVat, 0));
  if (totalAmount <= 0) throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, "Баримтын дүн 0");

  const customerTin = sale.customerTin?.trim() || null;
  if (customerTin && !MERCHANT_TIN_RE.test(customerTin))
    throw new EbarimtError(EBARIMT_ERRORS.settings, "Худалдан авагчийн ТТД 11 эсвэл 14 оронтой байна");
  const consumerNo = sale.consumerNo?.trim() || null;
  if (consumerNo && !CONSUMER_NO_RE.test(consumerNo))
    throw new EbarimtError(EBARIMT_ERRORS.settings, "Иргэний eBarimt дугаар 8 оронтой байна");

  const request: EbarimtReceiptRequest = {
    totalAmount,
    totalVat,
    totalCityTax: 0,
    branchNo: settings.branchNo.trim(),
    districtCode: settings.districtCode.trim(),
    merchantTin,
    posNo: settings.posNo.trim(),
    type: customerTin ? "B2B_RECEIPT" : "B2C_RECEIPT",
    receipts,
    payments: allocatePayments(sale.payments, totalAmount),
  };
  if (customerTin) request.customerTin = customerTin;
  else if (consumerNo) request.consumerNo = consumerNo;
  const inactiveId = options.inactiveId?.trim();
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
