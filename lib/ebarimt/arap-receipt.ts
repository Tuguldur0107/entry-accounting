// АР нэхэмжлэх → eBarimt НЭХЭМЖЛЭХ (`B2B_INVOICE` / `B2C_INVOICE`) — ЦЭВЭР
// (DB/сүлжээгүй, tests/ebarimt-arap-receipt.test.ts). docs/pos/05-ebarimt-invoice-plan.md
// Шат 1–2.
//
// АР-ын мөр НӨАТ-гүй (цэвэр) дүнтэй, НӨАТ нь гаралтын НӨАТ-ын данс дээрх ТУСДАА
// мөр (arap-lines-grid «НӨАТ 10% нэмэх», AI `vatMode`). eBarimt-ийн мөр татвар
// ОРСОН дүнтэй тул НӨАТ-ын мөрийг НӨАТ-тай (standard) мөрүүдэд дүнгийн хувиар
// хуваарилна (бөөрөнхийллийн үлдэгдэл сүүлийн мөрөнд). Бусад дүрэм:
//  - Ангиллын код: барааных (ачаалагч бүлгээс өвлүүлнэ) → мөрийн орлогын дансны
//    код (тохиргоо) → анхдагч код (тохиргоо) → байхгүй бол [EBARIMT_UNMAPPED_ITEM]
//    (ЗОХИОХГҮЙ — receipt.ts toItem).
//  - Төрөл ИЛ НЭХЭМЖЛЭХ (`invoice` → receiptTypeOf), дэд баримт бүрд мерчантын
//    ТЕГ-д бүртгэлтэй банкны данс `bankAccountNo` (+`iBan`) ЗААВАЛ (албан спек
//    3.0.1). `payments` = тохиргооны АЛБАН код (CASH / PAYMENT_CARD / BANK_TRANSFER /
//    BANK_TRANSFER_QPAY), `PAID`, бүтэн дүн — developer порталын B2B/B2C_INVOICE
//    жишээтэй ижил. `PAY` нь «гуравдагч системээр гүйцэтгэх» төлбөр — «төлөгдөөгүй»
//    гэсэн утга БИШ тул ХЭРЭГЛЭХГҮЙ. Төлөлт бүр тусдаа `invoiceId`-тай төлбөрийн
//    баримт (invoice-payment.ts). Тохиргоо анхнаасаа УНТРААЛТТАЙ.
//  - Зөвхөн MNT нэхэмжлэх (валютынхыг ил алдаа — зохиохгүй).
//  - Хасах дүнтэй мөр (хөнгөлөлт) eBarimt-ийн мөр болж чадахгүй — ил алдаа.
//  - Байгууллага → ТТД заавал (B2B); хувь хүн → B2C (ТТД-гүй).

import { EBARIMT_ERRORS, MERCHANT_TIN_RE, isKnownEbarimtPaymentCode } from "./constants";
import { EbarimtError } from "./receipt";
import type { EbarimtSaleInput, EbarimtSaleLineInput } from "./types";
import type { VatMode } from "@/lib/pos/constants";

export interface ArapEbarimtItem {
  name: string;
  unit: string | null;
  barcode: string | null;
  barcodeType: string | null;
  vatMode: VatMode;
  /** Барааных, хоосон бол бүлгийнх (ачаалагч өвлүүлнэ). */
  classificationCode: string | null;
  taxProductCode: string | null;
}

export interface ArapEbarimtLine {
  accountNumber: string;
  description: string;
  /** Мөрийн дүн (баримтын валютаар) — АР-д НӨАТ-гүй цэвэр дүн, НӨАТ тусдаа мөр. */
  amount: number;
  quantity: number | null;
  item: ArapEbarimtItem | null;
}

export interface ArapEbarimtDocument {
  id: string;
  documentNo: string;
  documentType: string;
  currency: string;
  description: string;
  lines: ArapEbarimtLine[];
  customer: {
    name: string;
    baseKind: "organization" | "individual";
    /** `effectiveTin`-ээр бодсон (11–14 орон) эсвэл null. */
    tin: string | null;
  };
}

export interface ArapEbarimtConfig {
  isVatPayer: boolean;
  /** Гаралтын НӨАТ-ын үндсэн данс (vat_settings) — эдгээр мөр НӨАТ гэж танигдана. */
  outputVatAccount: string | null;
  /** Нэхэмжлэхийн төлбөрийн АЛБАН код (тохиргоо — ихэвчлэн BANK_TRANSFER). */
  paymentCode: string | null;
  /** Мерчантын ТЕГ-д бүртгэлтэй банкны данс (тохиргоо, `/rest/bankAccounts`). */
  bankAccountNo: string | null;
  iBan: string | null;
  /** Бараагүй мөрийн анхдагч ангиллын код (7 орон). */
  defaultClassificationCode: string | null;
  /** Үндсэн данс (S3) → ангиллын код. */
  accountClassificationCodes: Readonly<Record<string, string>>;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 10 хэсэгтэй кодын үндсэн данс (S3); хуучин 8 оронтой код өөрөө. */
export function mainAccountOf(code: string): string {
  const parts = code.split(".");
  return parts.length === 10 ? parts[2] ?? code : code;
}

/**
 * eBarimt-ийн `billIdSuffix` — АР-ын дугаар (`AR-YYYYMMDD-XXXXXX`) POS-ийн
 * хэлбэрт таарахгүй тул баримтын UUID-аас тогтмол 8 оронтой («8» + 7 орон),
 * дахин илгээлт/засварт `edit`-ийн 2 орон. Нэг баримтад ҮРГЭЛЖ ижил (PosAPI
 * давхардлыг таних), POS-ийн («0…», «9…») хэлбэртэй давхцахгүй.
 */
export function arapBillIdSuffix(documentId: string, edit = 0): string {
  const hex = documentId.replace(/[^0-9a-f]/gi, "").slice(0, 8);
  if (hex.length < 8) throw new EbarimtError(EBARIMT_ERRORS.billId, `Баримтын ID "${documentId}"-аас billIdSuffix гаргах боломжгүй`);
  if (!Number.isInteger(edit) || edit < 0 || edit > 99)
    throw new EbarimtError(EBARIMT_ERRORS.billId, `billIdSuffix-ийн засварын дугаар 0–99 байна (${edit})`);
  const base = `8${String(parseInt(hex, 16) % 10_000_000).padStart(7, "0")}`;
  return edit > 0 ? `${base}${String(edit).padStart(2, "0")}` : base;
}

/**
 * АР нэхэмжлэх → `buildEbarimtReceipt`-ийн оролт. Дүрэм зөрвөл `[EBARIMT_*]`
 * ШИДНЭ (payload зохиогдохгүй; дуудагч submission-ийг failed болгож шалтгааныг ил).
 */
export function arapInvoiceToEbarimtInput(doc: ArapEbarimtDocument, config: ArapEbarimtConfig): EbarimtSaleInput {
  if (doc.documentType !== "ar_invoice")
    throw new EbarimtError(EBARIMT_ERRORS.notSent, "Зөвхөн борлуулалтын нэхэмжлэх eBarimt-д илгээгдэнэ (кредит нэхэмжлэл — docs/pos/05 Q5)");
  if (doc.currency.toUpperCase() !== "MNT")
    throw new EbarimtError(
      EBARIMT_ERRORS.settings,
      `${doc.documentNo}: валютын (${doc.currency}) нэхэмжлэх eBarimt-д одоогоор илгээгдэхгүй — ТЕГ-д гараар бүртгэнэ`
    );

  const paymentCode = config.paymentCode?.trim().toUpperCase() || "";
  if (!isKnownEbarimtPaymentCode(paymentCode))
    throw new EbarimtError(
      EBARIMT_ERRORS.unmappedPayment,
      `АР нэхэмжлэхийн eBarimt төлбөрийн код ${paymentCode ? `«${paymentCode}» албан жагсаалтад алга` : "тохируулаагүй"} — CASH / PAYMENT_CARD / BANK_TRANSFER / BANK_TRANSFER_QPAY (POS тохиргоо → eBarimt → АР нэхэмжлэх)`
    );

  let customerTin: string | null = null;
  if (doc.customer.baseKind === "organization") {
    customerTin = doc.customer.tin?.trim() || null;
    if (!customerTin || !MERCHANT_TIN_RE.test(customerTin))
      throw new EbarimtError(
        EBARIMT_ERRORS.settings,
        `«${doc.customer.name}» байгууллагын ТТД (11–14 орон) харилцагчийн картад бүртгэгдээгүй — B2B нэхэмжлэхэд заавал`
      );
  }

  const vatMain = config.outputVatAccount?.trim() || null;
  const isVatLine = (line: ArapEbarimtLine) => !!vatMain && mainAccountOf(line.accountNumber) === vatMain;
  const vatTotal = round2(doc.lines.filter(isVatLine).reduce((sum, line) => sum + line.amount, 0));
  const itemLines = doc.lines.filter((line) => !isVatLine(line));
  if (itemLines.length === 0)
    throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, `${doc.documentNo}: илгээх мөр байхгүй`);

  const negative = itemLines.find((line) => line.amount <= 0);
  if (negative)
    throw new EbarimtError(
      EBARIMT_ERRORS.totalMismatch,
      `«${negative.description || negative.item?.name || negative.accountNumber}» мөр ${negative.amount} — хасах/0 дүнтэй мөр eBarimt-д илгээгдэхгүй (хөнгөлөлтийг мөрийн дүнд шингээнэ үү)`
    );

  const vatModeOf = (line: ArapEbarimtLine): VatMode => line.item?.vatMode ?? "standard";
  const standard = itemLines.filter((line) => vatModeOf(line) === "standard");
  if (!config.isVatPayer) {
    if (Math.abs(vatTotal) > 0.005)
      throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, `${doc.documentNo}: НӨАТ төлөгч бус байгууллагын нэхэмжлэхэд НӨАТ-ын мөр (${vatTotal}) байна`);
  } else {
    if (standard.length > 0 && vatTotal <= 0.005)
      throw new EbarimtError(
        EBARIMT_ERRORS.totalMismatch,
        `${doc.documentNo}: НӨАТ-тай мөрүүдэд НӨАТ-ын мөр байхгүй — «НӨАТ 10% нэмэх»-ээр нэмнэ үү, эсвэл барааны НӨАТ-ын горимыг засна`
      );
    if (standard.length === 0 && Math.abs(vatTotal) > 0.005)
      throw new EbarimtError(EBARIMT_ERRORS.totalMismatch, `${doc.documentNo}: НӨАТ-ын мөр байгаа ч НӨАТ-тай мөр алга`);
  }

  // НӨАТ-ыг standard мөрүүдэд дүнгийн хувиар; үлдэгдэл сүүлийнх рүү.
  const vatByLine = new Map<ArapEbarimtLine, number>();
  if (config.isVatPayer && standard.length > 0) {
    const base = standard.reduce((sum, line) => sum + line.amount, 0);
    let allocated = 0;
    standard.forEach((line, index) => {
      const share = index === standard.length - 1 ? round2(vatTotal - allocated) : round2((vatTotal * line.amount) / base);
      allocated = round2(allocated + share);
      vatByLine.set(line, share);
    });
  }

  const lines: EbarimtSaleLineInput[] = itemLines.map((line) => {
    const name = line.item?.name?.trim() || line.description.trim() || doc.description.trim();
    if (!name) throw new EbarimtError(EBARIMT_ERRORS.unmappedItem, `${doc.documentNo}: мөрийн нэр/тайлбар хоосон`);
    const vatAmount = vatByLine.get(line) ?? 0;
    const quantity = line.quantity && line.quantity > 0 ? line.quantity : 1;
    const classificationCode =
      line.item?.classificationCode?.trim() ||
      config.accountClassificationCodes[mainAccountOf(line.accountNumber)]?.trim() ||
      config.defaultClassificationCode?.trim() ||
      null;
    return {
      itemName: name,
      barcode: line.item?.barcode ?? null,
      barcodeType: line.item?.barcodeType ?? null,
      unit: line.item?.unit || "ш",
      vatMode: vatModeOf(line),
      classificationCode,
      taxProductCode: line.item?.taxProductCode ?? null,
      quantity,
      lineTotal: round2(line.amount + vatAmount),
      vatAmount,
      cityTaxAmount: 0,
    };
  });
  const total = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  return {
    saleId: doc.id,
    documentNo: doc.documentNo,
    isVatPayer: config.isVatPayer,
    customerTin,
    consumerNo: null,
    total,
    lines,
    // Төрөл ИЛ нэхэмжлэх + данс; төлбөр албан жишээний дагуу PAID бүтэн дүнгээр
    // (`credit`/PAY БИШ — тэр нь гуравдагч системийн төлбөр).
    invoice: { bankAccountNo: config.bankAccountNo ?? "", iBan: config.iBan ?? null },
    payments: [{ kind: "transfer", methodName: "Нэхэмжлэх", ebarimtCode: paymentCode, baseAmount: total, reference: null }],
  };
}
