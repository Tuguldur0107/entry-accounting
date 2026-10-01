// «Авлага үүсгэж борлуулалтад» / «Өглөг үүсгэж зардалд»-ын харьцах дансны
// санал (docs/dev/arap.md §5l). ЦЭВЭР — DB импортгүй (client component
// импортолно), тесттэй (tests/bank-row-preview.test.ts). Бичилтийн урьдчилсан
// харагдац энд БИШ — сервер saveBankStatement-ийг rollback-тай ажиллуулна
// (previewBankStatement, lib/cash/statement-preview.ts).

import type { ParsedBankStatementRow } from "./bank-statement-types";
import { bankRowActionInvoiceType, isBankRowAction } from "@/lib/arap/advance-math";

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
