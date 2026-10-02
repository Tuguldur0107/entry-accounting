// «Авлага үүсгэж борлуулалтад» / «Өглөг үүсгэж зардалд»-ын харьцах дансны
// санал (docs/dev/arap.md §5l). ЦЭВЭР — DB импортгүй (client component
// импортолно), тесттэй (tests/bank-row-preview.test.ts). Бичилтийн урьдчилсан
// харагдац энд БИШ — сервер saveBankStatement-ийг rollback-тай ажиллуулна
// (previewBankStatement, lib/cash/statement-preview.ts).

import type { ParsedBankStatementRow } from "./bank-statement-types";
import { bankRowActionInvoiceType, isBankRowAction } from "@/lib/arap/advance-math";
import { normalizeCounterpartyName } from "./list-columns";

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
  /** Тоолохдоо нэхэмжлэх бүрд нэг дансыг НЭГ л удаа (олон мөртэй нэхэмжлэх давамгайлахгүй). */
  documentId?: string;
  /**
   * PO-той нэхэмжлэх эсвэл бараатай мөр — данс нь түр / бараа материалын данс,
   * «Өглөг үүсгэж зардалд»-д зардал биш тул өглөгийн саналд ОРОХГҮЙ.
   */
  notExpense?: boolean;
};

export type InvoiceAccountHints = {
  /** Харилцагч бүрийн хамгийн сүүлийн борлуулалтын нэхэмжлэхийн орлогын данс. */
  ar: Record<string, string>;
  /** Харилцагч бүрийн хамгийн сүүлийн өглөгийн нэхэмжлэхийн зардлын данс. */
  ap: Record<string, string>;
  /** Байгууллагын борлуулалтын нэхэмжлэхүүдэд хамгийн их хэрэглэсэн орлогын данс. */
  arDefault: string | null;
  /**
   * Байгууллагын өглөгийн нэхэмжлэхүүдэд хамгийн их хэрэглэсэн зардлын данс —
   * түүхгүй ШИНЭ ханган нийлүүлэгчид (product owner 2026-10-02). Хэрэглэгч
   * бичилтийн урьдчилсан харагдацаар шалгаж засна.
   */
  apDefault: string | null;
};

/** Хамгийн олон удаа хэрэглэсэн данс; тэнцвэл эхэлж (шинээр) таарсан нь. */
function mostUsed(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [main, count] of counts)
    if (count > bestCount) {
      best = main;
      bestCount = count;
    }
  return best;
}

/**
 * Өмнөх нэхэмжлэхийн мөрүүдээс (ШИНЭЭС хуучин руу эрэмбэлсэн) харьцах дансны
 * санал. НӨАТ-ын мөр, өглөгт PO / бараатай мөр алгасна; давамгай дансыг
 * НЭХЭМЖЛЭХЭЭР тоолно. Данс ЗОХИОХГҮЙ — түүх байхгүй бол санал байхгүй,
 * хэрэглэгч өөрөө сонгоно.
 */
export function buildInvoiceAccountHints(
  lines: InvoiceLineHistory[],
  vatAccountMains: (string | null | undefined)[]
): InvoiceAccountHints {
  const vat = new Set(vatAccountMains.map((main) => (main ?? "").trim()).filter(Boolean));
  const hints: InvoiceAccountHints = { ar: {}, ap: {}, arDefault: null, apDefault: null };
  const arCounts = new Map<string, number>();
  const apCounts = new Map<string, number>();
  const counted = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const main = mainAccountOfCode(line.accountNumber);
    if (!main || vat.has(main)) continue;
    const ledger =
      line.documentType === "ar_invoice" ? hints.ar : line.documentType === "ap_bill" ? hints.ap : null;
    if (!ledger) continue;
    if (line.documentType === "ap_bill" && line.notExpense) continue;
    if (!(line.counterpartyId in ledger)) ledger[line.counterpartyId] = main;
    const key = `${line.documentId ?? `line-${index}`}|${main}`;
    if (counted.has(key)) continue;
    counted.add(key);
    const counts = line.documentType === "ar_invoice" ? arCounts : apCounts;
    counts.set(main, (counts.get(main) ?? 0) + 1);
  }
  hints.arDefault = mostUsed(arCounts);
  hints.apDefault = mostUsed(apCounts);
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
  return documentType === "ar_invoice" ? hints.arDefault : hints.apDefault;
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

// ── Харилцагчийн автомат холбоос ─────────────────────────────────────────

export type CounterpartyLinkCandidate = {
  id: string;
  name: string;
  /** "customer" | "supplier" | "both" — мөрийн чиглэлтэй тулгана. */
  counterpartyType?: string | null;
  bankAccountNo?: string | null;
};

/** Дансны дугаарын цифрүүд (зай, зураас, IBAN-ий «MN» хасна). */
function accountDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Монголын банкны данс 10+ оронтой; IBAN (MN + 18 цифр) нь дансаар төгсдөг. */
const MIN_ACCOUNT_DIGITS = 10;
const MIN_IBAN_DIGITS = 16;

/**
 * Хоёр дансны дугаар нэг данс мөн эсэх: ЯГ тэнцүү, эсвэл урт нь IBAN (≥ 16
 * цифр) бөгөөд богино (≥ 10 цифр) нь түүний төгсгөл. Утас, гүйлгээний 8
 * оронтой дугаар (тайлбараас уншсан) хэзээ ч таарахгүй.
 */
function sameAccount(a: string, b: string): boolean {
  if (a.length < MIN_ACCOUNT_DIGITS || b.length < MIN_ACCOUNT_DIGITS) return false;
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.length >= MIN_IBAN_DIGITS && long.endsWith(short);
}

/**
 * Хуулгын «харьцсан данс» ↔ харилцагчийн бүртгэлтэй данс. ГАНЦ харилцагч
 * таарвал л — олон бол таамаглахгүй.
 */
export function matchCounterpartyByAccount<T extends CounterpartyLinkCandidate>(
  counterAccount: string | null | undefined,
  candidates: readonly T[]
): T | null {
  const digits = accountDigits(counterAccount);
  if (digits.length < MIN_ACCOUNT_DIGITS) return null;
  const hits = candidates.filter((item) => sameAccount(accountDigits(item.bankAccountNo), digits));
  return hits.length === 1 ? hits[0] : null;
}

/** Мөрийн чиглэлд тохирох харилцагч: орлого → customer|both, зарлага → supplier|both. */
function fitsDirection(candidate: CounterpartyLinkCandidate, income: boolean): boolean {
  const type = candidate.counterpartyType ?? "both";
  return income ? type !== "supplier" : type !== "customer";
}

/**
 * Хуулга АЧААЛАХ үед (НЭГ удаа — дахин ачаалалт хэрэглэгчийн цэвэрлэсэн
 * холбоосыг сэргээхгүй) харилцагч сонгоогүй мөрийг бүртгэлтэй ИДЭВХТЭЙ
 * харилцагчтай холбоно: эхлээд харьцсан дансаар, дараа нь нэрээр ЯГ
 * (`matchCounterpartyByName` — том/жижиг үсэг, зай ялгахгүй). Нэхэмжлэх /
 * e-wallet settlement-тэй мөр, чиглэл зөрсөн харилцагч, олон таарсныг
 * алгасна. Таараагүй бол хуулгын нэр текстээрээ үлдэнэ (ХОЛБООС ЗОХИОХГҮЙ).
 * Өөрчлөлтгүй бол ИЖИЛ массив.
 */
export function linkStatementCounterparties<T extends CounterpartyLinkCandidate>(
  rows: ParsedBankStatementRow[],
  candidates: readonly T[] | null | undefined
): ParsedBankStatementRow[] {
  if (!candidates?.length) return rows;
  // Чиглэл бүрийн индексийг НЭГ удаа (мөр × харилцагч бүрд дахин нормчлохгүй):
  // нэр → харилцагчид, дансны цифр (дансаа бүртгэсэн цөөн харилцагч).
  const index = (income: boolean) => {
    const byName = new Map<string, T[]>();
    const withAccount: { digits: string; item: T }[] = [];
    for (const item of candidates) {
      if (!fitsDirection(item, income)) continue;
      const key = normalizeCounterpartyName(item.name);
      if (key) byName.set(key, [...(byName.get(key) ?? []), item]);
      const digits = accountDigits(item.bankAccountNo);
      if (digits.length >= MIN_ACCOUNT_DIGITS) withAccount.push({ digits, item });
    }
    return { byName, withAccount };
  };
  const sides = { income: index(true), expense: index(false) };
  let changed = false;
  const next = rows.map((row) => {
    if (row.counterpartyId || row.settleInvoiceId || row.ewalletSettlement) return row;
    const side = row.income > 0 ? sides.income : sides.expense;
    const digits = accountDigits(row.counterAccount);
    const byAccount =
      digits.length >= MIN_ACCOUNT_DIGITS
        ? side.withAccount.filter((entry) => sameAccount(entry.digits, digits))
        : [];
    // ЯГ нэр — matchCounterpartyByName-тэй ижил дүрэм (олон таарвал null).
    const byName = side.byName.get(normalizeCounterpartyName(row.counterparty)) ?? [];
    const master =
      byAccount.length === 1 ? byAccount[0].item : byName.length === 1 ? byName[0] : null;
    if (!master) return row;
    changed = true;
    return { ...row, counterpartyId: master.id, counterparty: master.name };
  });
  return changed ? next : rows;
}
