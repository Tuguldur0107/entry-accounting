// АР нэхэмжлэхийн ТӨЛӨЛТ → eBarimt төлбөрийн баримт (`invoiceId`-тай) — ЦЭВЭР
// (DB/сүлжээгүй, tests/ebarimt-invoice-payment.test.ts). docs/pos/05 Шат 3.
//
// Албан спек 3.0.1 §5 «Нэхэмжлэхийн төлбөр»: өмнө үүсгэсэн нэхэмжлэхийн дагуу
// төлж буй баримтын `invoiceId` талбарт тэр нэхэмжлэхийн ДДТД-г өгнө. Нэхэмжлэх
// аль хэдийн НӨАТ-ын тайланд орсон тул төлбөрийн баримт ДАВХАР тусгагдахгүй,
// харин сугалаа ба НӨАТ-ын буцаан олголтод хамрагдана; ТЕГ-ийн задаргаанд
// `prParentRno` = нэхэмжлэхийн ДДТД. Дүрэм:
//  - Төрөл: B2B_INVOICE → B2B_RECEIPT, B2C_INVOICE → B2C_RECEIPT (худалдан авагч ижил).
//  - Мөрүүд = ИЛГЭЭГДСЭН нэхэмжлэхийн мөрүүд, төлсөн дүнгийн ХУВИАР (бүтэн
//    төлөлтөд яг ижил); бөөрөнхийллийн үлдэгдлийг сүүлийн мөр шингээнэ.
//  - Төлбөр: эх нь касс → CASH, банк → BANK_TRANSFER, QPay-ийн нэхэмжлэхийн линк →
//    BANK_TRANSFER_QPAY (албан код), PAID.
//  - Нэхэмжлэхийн дүнгээс их / 0 төлөлт → ил алдаа (зохиохгүй).

import { roundMoney as round2 } from "@/lib/arap/accounting";

import { EBARIMT_ERRORS, EBARIMT_PAYMENT_STATUS_PAID, type EbarimtPaymentCode, type EbarimtReceiptType } from "./constants";
import { EbarimtError } from "./receipt";
import type { EbarimtItem, EbarimtReceiptRequest, EbarimtSubReceipt } from "./types";

/** QPay-ийн нэхэмжлэхийн линкээр орсон кассын баримтын `externalRef` угтвар (lib/qpay/arap.ts). */
export const QPAY_ARAP_EXTERNAL_REF_PREFIX = "qpay-arap:";

/** Төлөлтийн эх (кассын баримт + данс) → албан төлбөрийн код. */
export function invoicePaymentCodeOf(source: { accountType: string | null; externalRef: string | null }): EbarimtPaymentCode {
  if (source.externalRef?.startsWith(QPAY_ARAP_EXTERNAL_REF_PREFIX)) return "BANK_TRANSFER_QPAY";
  return source.accountType === "cash" ? "CASH" : "BANK_TRANSFER";
}

const RECEIPT_TYPE_OF_INVOICE: Partial<Record<EbarimtReceiptType, EbarimtReceiptType>> = {
  B2B_INVOICE: "B2B_RECEIPT",
  B2C_INVOICE: "B2C_RECEIPT",
};

/**
 * Төлөлтийн баримтын `billIdSuffix` — settlement-ийн UUID-аас тогтмол «7» + 7
 * орон (нэхэмжлэхийнх «8…», POS-ийнх «0…/9…»-тэй давхцахгүй). Нэг төлөлтийн
 * дахин оролдлого бүрд ИЖИЛ — PosAPI давхардлыг таних.
 */
export function invoicePaymentBillIdSuffix(settlementId: string): string {
  const hex = settlementId.replace(/[^0-9a-f]/gi, "").slice(0, 8);
  if (hex.length < 8)
    throw new EbarimtError(EBARIMT_ERRORS.billId, `Төлөлтийн ID "${settlementId}"-аас billIdSuffix гаргах боломжгүй`);
  return `7${String(parseInt(hex, 16) % 10_000_000).padStart(7, "0")}`;
}

export interface InvoicePaymentInput {
  /** ТЕГ-д илгээгдсэн нэхэмжлэхийн хүсэлт (submission.payload.request). */
  invoiceRequest: EbarimtReceiptRequest;
  /** Нэхэмжлэхийн ДДТД. */
  invoiceId: string;
  /** Энэ төлөлтийн дүн (MNT). */
  amount: number;
  paymentCode: EbarimtPaymentCode;
  billIdSuffix: string;
}

function scaleItem(item: EbarimtItem, factor: number): EbarimtItem {
  const totalAmount = round2(item.totalAmount * factor);
  return {
    ...item,
    totalAmount,
    totalVAT: round2(item.totalVAT * factor),
    totalCityTax: round2(item.totalCityTax * factor),
    unitPrice: item.qty > 0 ? round2(totalAmount / item.qty) : 0,
  };
}

/** Бөөрөнхийллийн зөрүүг тухайн талбар >0 сүүлийн мөрөнд шингээнэ. */
function absorb(items: EbarimtItem[], field: "totalAmount" | "totalVAT" | "totalCityTax", target: number) {
  const diff = round2(target - items.reduce((sum, item) => sum + item[field], 0));
  if (Math.abs(diff) < 0.001) return;
  const host = [...items].reverse().find((item) => item[field] > 0) ?? items[items.length - 1];
  host[field] = round2(host[field] + diff);
  if (field === "totalAmount") host.unitPrice = host.qty > 0 ? round2(host.totalAmount / host.qty) : 0;
}

export function buildInvoicePaymentReceipt(input: InvoicePaymentInput): EbarimtReceiptRequest {
  const invoice = input.invoiceRequest;
  const type = RECEIPT_TYPE_OF_INVOICE[invoice.type];
  if (!type)
    throw new EbarimtError(EBARIMT_ERRORS.notSent, `Төлөлт зөвхөн НЭХЭМЖЛЭХэд (B2B/B2C_INVOICE) бүртгэгдэнэ — ТЕГ-д ${invoice.type} төрлөөр очсон`);
  const invoiceId = input.invoiceId.trim();
  if (!invoiceId) throw new EbarimtError(EBARIMT_ERRORS.notSent, "Нэхэмжлэхийн ДДТД байхгүй — эхлээд нэхэмжлэх ТЕГ-д бүртгэгдэнэ");
  const total = round2(invoice.totalAmount);
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, `Төлөлтийн дүн ${amount} — эерэг байна`);
  if (amount > total + 0.01)
    throw new EbarimtError(
      EBARIMT_ERRORS.totalMismatch,
      `Төлөлт ${amount} нь ТЕГ-д бүртгэлтэй нэхэмжлэхийн дүнгээс (${total}) их — илүү төлөлтийг нэхэмжлэхэд бүртгэхгүй`
    );

  const factor = Math.min(1, amount / total);
  const items = invoice.receipts.flatMap((receipt, receiptIndex) =>
    receipt.items.map((item) => ({ receiptIndex, item: scaleItem(item, factor) }))
  );
  const flat = items.map((entry) => entry.item);
  // Нийт дүн ЯГ төлсөн дүн; НӨАТ/НХАТ эх нэхэмжлэхийн харьцаагаар (бүтэн төлөлтөд эхтэй ижил).
  absorb(flat, "totalAmount", amount);
  absorb(flat, "totalVAT", round2(invoice.totalVAT * factor));
  absorb(flat, "totalCityTax", round2(invoice.totalCityTax * factor));

  const receipts: EbarimtSubReceipt[] = invoice.receipts
    .map((receipt, index) => {
      const own = items.filter((entry) => entry.receiptIndex === index && entry.item.totalAmount > 0).map((entry) => entry.item);
      return {
        taxType: receipt.taxType,
        merchantTin: receipt.merchantTin,
        totalAmount: round2(own.reduce((sum, item) => sum + item.totalAmount, 0)),
        totalVAT: round2(own.reduce((sum, item) => sum + item.totalVAT, 0)),
        totalCityTax: round2(own.reduce((sum, item) => sum + item.totalCityTax, 0)),
        items: own,
      };
    })
    .filter((receipt) => receipt.items.length > 0);
  if (receipts.length === 0) throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, "Төлөлтийн баримтад мөр үлдсэнгүй");

  const totalAmount = round2(receipts.reduce((sum, receipt) => sum + receipt.totalAmount, 0));
  if (Math.abs(totalAmount - amount) > 0.011)
    throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, `Төлөлтийн баримтын дүн ${totalAmount} ≠ төлөлт ${amount}`);

  const request: EbarimtReceiptRequest = {
    totalAmount,
    totalVAT: round2(receipts.reduce((sum, receipt) => sum + receipt.totalVAT, 0)),
    totalCityTax: round2(receipts.reduce((sum, receipt) => sum + receipt.totalCityTax, 0)),
    billIdSuffix: input.billIdSuffix,
    branchNo: invoice.branchNo,
    districtCode: invoice.districtCode,
    merchantTin: invoice.merchantTin,
    posNo: invoice.posNo,
    type,
    invoiceId,
    receipts,
    payments: [{ code: input.paymentCode, status: EBARIMT_PAYMENT_STATUS_PAID, paidAmount: totalAmount }],
  };
  if (invoice.customerTin) request.customerTin = invoice.customerTin;
  else if (invoice.consumerNo) request.consumerNo = invoice.consumerNo;
  return request;
}
