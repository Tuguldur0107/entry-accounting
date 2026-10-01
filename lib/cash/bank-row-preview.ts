// Банкны хуулгын мөр хадгалагдахад ҮҮСЭХ бичилтийн урьдчилсан харагдац ба
// «Авлага үүсгэж борлуулалтад» / «Өглөг үүсгэж зардалд»-ын харьцах дансны
// санал. ЦЭВЭР — DB импортгүй (client component импортолно), тесттэй
// (tests/bank-row-preview.test.ts). Сервер талын бичилт lib/cash/import-statement.ts —
// НӨАТ-ын задаргаа, хяналтын дансны сонголт ЯГ ИЖИЛ дүрмээр (splitInclusiveVat).

import type { ParsedBankStatementRow } from "./bank-statement-types";
import { bankRowActionInvoiceType, isBankRowAction, splitInclusiveVat } from "@/lib/arap/advance-math";

/** Бүтэн 10 сегмент код эсвэл үндсэн данснаас үндсэн (S3) дугаар. */
export function mainAccountOfCode(code: string | null | undefined): string {
  const value = (code ?? "").trim();
  const parts = value.split(".");
  return (parts.length === 10 ? parts[2] : value).trim();
}

// ── Харьцах дансны санал ─────────────────────────────────────────────────

export type InvoiceLineHistory = {
  counterpartyId: string;
  documentType: string;
  accountNumber: string;
};

export type InvoiceAccountHints = {
  /** Харилцагч бүрийн хамгийн сүүлийн борлуулалтын нэхэмжлэхийн орлогын данс. */
  ar: Record<string, string>;
  /** Харилцагч бүрийн хамгийн сүүлийн өглөгийн нэхэмжлэхийн зардлын данс. */
  ap: Record<string, string>;
  /** Байгууллагын борлуулалтын нэхэмжлэхүүдэд хамгийн их хэрэглэсэн орлогын данс. */
  arDefault: string | null;
};

/**
 * Өмнөх нэхэмжлэхийн мөрүүдээс (ШИНЭЭС хуучин руу эрэмбэлсэн) харьцах дансны
 * санал. НӨАТ-ын мөр алгасна. Данс ЗОХИОХГҮЙ — түүх байхгүй бол санал байхгүй,
 * хэрэглэгч өөрөө сонгоно.
 */
export function buildInvoiceAccountHints(
  lines: InvoiceLineHistory[],
  vatAccountMains: (string | null | undefined)[]
): InvoiceAccountHints {
  const vat = new Set(vatAccountMains.map((main) => (main ?? "").trim()).filter(Boolean));
  const hints: InvoiceAccountHints = { ar: {}, ap: {}, arDefault: null };
  const arCounts = new Map<string, number>();
  for (const line of lines) {
    const main = mainAccountOfCode(line.accountNumber);
    if (!main || vat.has(main)) continue;
    const ledger =
      line.documentType === "ar_invoice" ? hints.ar : line.documentType === "ap_bill" ? hints.ap : null;
    if (!ledger) continue;
    if (!(line.counterpartyId in ledger)) ledger[line.counterpartyId] = main;
    if (line.documentType === "ar_invoice") arCounts.set(main, (arCounts.get(main) ?? 0) + 1);
  }
  let best = 0;
  for (const [main, count] of arCounts)
    if (count > best) {
      best = count;
      hints.arDefault = main;
    }
  return hints;
}

/** Мөрийн бүртгэлд тохирох харьцах дансны санал (үндсэн дугаар) эсвэл null. */
export function suggestInvoiceCounterAccount(
  hints: InvoiceAccountHints | null | undefined,
  documentType: "ar_invoice" | "ap_bill",
  counterpartyId: string | null | undefined
): string | null {
  if (!hints) return null;
  const ledger = documentType === "ar_invoice" ? hints.ar : hints.ap;
  if (counterpartyId && ledger[counterpartyId]) return ledger[counterpartyId];
  return documentType === "ar_invoice" ? hints.arDefault : null;
}

// ── Бичилтийн урьдчилсан харагдац ────────────────────────────────────────

export type PreviewVatSettings = {
  isVatPayer: boolean;
  vatRatePercent: number;
  outputVatAccountNumber: string | null;
  inputVatAccountNumber: string | null;
};

export type PreviewCounterparty = {
  id: string;
  name: string;
  defaultReceivableAccountNumber?: string | null;
  defaultPayableAccountNumber?: string | null;
};

export type PreviewContext = {
  vat: PreviewVatSettings | null;
  counterparties: PreviewCounterparty[];
  /** Системийн default хяналтын данс (харилцагчийн картад байхгүй үед). */
  defaultControl: { receivable: string; payable: string } | null;
  /** Нээлттэй нэхэмжлэхийн хяналтын данс (нэхэмжлэх хаах мөрд). */
  invoiceControl?: (invoiceId: string) => string | null;
};

export type PreviewLine = {
  /** Бичилтийн баримт — нэг мөрөөс 1–2 журнал үүснэ. */
  voucher: string;
  account: string;
  debit: number;
  credit: number;
};

export type RowPreview = {
  lines: PreviewLine[];
  /** Урьдчилж бодож чадаагүй хэсэг (данс дутуу г.м.) — UI-д ил. */
  notes: string[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Мөр хадгалагдахад үүсэх журналын мөрүүд (MNT, `baseAmount`-аар). Банкны тал
 * = мөрийн банкны код; нэхэмжлэх үүсгэх мөрд эхлээд нэхэмжлэхийн журнал, дараа
 * нь түүнийг хаах банкны журнал.
 */
export function previewBankRowPostings(row: ParsedBankStatementRow, context: PreviewContext): RowPreview {
  const notes: string[] = [];
  const isIncome = row.income > 0;
  const original = isIncome ? row.income : row.expense;
  const rate = row.exchangeRate ?? null;
  if (row.baseAmount == null) notes.push("Ханш оруулаагүй — ₮ дүн тодорхойгүй");
  const amount = round2(row.baseAmount ?? original);
  const bankCode = isIncome ? row.debitAccountNumber : row.creditAccountNumber;
  const counterCode = isIncome ? row.creditAccountNumber : row.debitAccountNumber;
  const bankMain = mainAccountOfCode(bankCode);
  const counterMain = mainAccountOfCode(counterCode);
  const bankVoucher = "Банкны гүйлгээ";
  const bankLeg = (otherMain: string): PreviewLine[] =>
    isIncome
      ? [
          { voucher: bankVoucher, account: bankMain, debit: amount, credit: 0 },
          { voucher: bankVoucher, account: otherMain, debit: 0, credit: amount },
        ]
      : [
          { voucher: bankVoucher, account: otherMain, debit: amount, credit: 0 },
          { voucher: bankVoucher, account: bankMain, debit: 0, credit: amount },
        ];

  const documentType = isBankRowAction(row.rowAction) ? bankRowActionInvoiceType(row.rowAction) : null;
  if (documentType) {
    const isSale = documentType === "ar_invoice";
    const master = context.counterparties.find((item) => item.id === row.counterpartyId);
    if (!master) notes.push("Харилцагч сонгоогүй — нэхэмжлэх үүсэхгүй");
    if (!counterMain) notes.push(isSale ? "Орлогын данс сонгоогүй" : "Зардлын данс сонгоогүй");
    const controlMain = (
      (isSale ? master?.defaultReceivableAccountNumber : master?.defaultPayableAccountNumber) ||
      (isSale ? context.defaultControl?.receivable : context.defaultControl?.payable) ||
      ""
    ).trim();
    if (!controlMain) notes.push(`${isSale ? "Авлагын" : "Өглөгийн"} хяналтын данс тохируулаагүй`);

    // Сервертэй ИЖИЛ: НӨАТ-ыг эх валютын дүнгээс салгаад ₮ болгоно, цэвэр дүн = ₮ − НӨАТ.
    let net = amount;
    let vat = 0;
    let vatMain = "";
    if (context.vat?.isVatPayer) {
      vatMain = ((isSale ? context.vat.outputVatAccountNumber : context.vat.inputVatAccountNumber) ?? "").trim();
      if (context.vat.vatRatePercent > 0) {
        const split = splitInclusiveVat(original, context.vat.vatRatePercent);
        vat = split.vat > 0 ? round2(split.vat * (rate ?? 1)) : 0;
        net = round2(amount - vat);
      } else notes.push("НӨАТ-ын хувь тохируулаагүй");
    }
    const voucher = isSale ? "Борлуулалтын нэхэмжлэх" : "Өглөгийн нэхэмжлэх";
    const side = (account: string, value: number): PreviewLine =>
      isSale
        ? { voucher, account, debit: 0, credit: value }
        : { voucher, account, debit: value, credit: 0 };
    const control: PreviewLine = isSale
      ? { voucher, account: controlMain, debit: amount, credit: 0 }
      : { voucher, account: controlMain, debit: 0, credit: amount };
    const invoiceLines = [
      ...(isSale ? [control] : []),
      side(counterMain, net),
      ...(vat > 0 ? [side(vatMain, vat)] : []),
      ...(isSale ? [] : [control]),
    ];
    return { lines: [...invoiceLines, ...bankLeg(controlMain)], notes };
  }

  if (row.settleInvoiceId) {
    const control = context.invoiceControl?.(row.settleInvoiceId);
    if (rate !== null && rate !== 1)
      notes.push("Нэхэмжлэхийн ханш зөрвөл ханшийн олз/гарзын мөр нэмэгдэнэ");
    return { lines: bankLeg(control ? mainAccountOfCode(control) : counterMain), notes };
  }
  if (row.ewalletSettlement)
    notes.push("Э-хэтэвчийн шимтгэл тусдаа баримтаар (түр данснаас зарлага) бичигдэнэ");
  if (!counterMain) notes.push("Харьцах данс сонгоогүй");
  return { lines: bankLeg(counterMain), notes };
}

/**
 * «Бүртгэл» нь нэхэмжлэх үүсгэх боловч харьцах тал ХООСОН мөрүүдэд санал
 * болгосон дансыг бөглөнө (сэргээсэн ноорог, саналаас өмнө сонгосон мөр).
 * Гараар сонгосон дансыг хөндөхгүй; өөрчлөлтгүй бол ИЖИЛ массив буцаана.
 */
export function fillInvoiceCounterAccounts(
  rows: ParsedBankStatementRow[],
  hints: InvoiceAccountHints | null | undefined,
  codeOf: (main: string) => string
): ParsedBankStatementRow[] {
  if (!hints) return rows;
  let changed = false;
  const next = rows.map((row) => {
    const documentType = isBankRowAction(row.rowAction) ? bankRowActionInvoiceType(row.rowAction) : null;
    const counterField = row.income > 0 ? "creditAccountNumber" : "debitAccountNumber";
    if (!documentType || mainAccountOfCode(row[counterField])) return row;
    const main = suggestInvoiceCounterAccount(hints, documentType, row.counterpartyId);
    if (!main) return row;
    changed = true;
    return { ...row, [counterField]: codeOf(main) };
  });
  return changed ? next : rows;
}
