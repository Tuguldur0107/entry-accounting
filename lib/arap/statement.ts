// Тооцоо нийлсэн акт (docs/dev/arap.md §5i) — ЦЭВЭР логик (DB импортгүй,
// client-safe): нэг харилцагчийн авлага + өглөгийг НЭГ тэмдэгтээр нэгтгэнэ.
// Тэмдэг: + = харилцагч бидэнд өртэй (авлага), − = бид харилцагчид өртэй (өглөг).
// Тест: tests/ar-statement.test.ts.

import { arapLedger, isCreditDocument } from "./document-kind";

/** Баримтын тэмдэг: АР нэхэмжлэх +, кредит нэхэмжлэл −, АП нэхэмжлэх −, дебит нэхэмжлэх +. */
export function statementDocumentSign(documentType: string): 1 | -1 {
  const ledger = arapLedger(documentType) === "ar" ? 1 : -1;
  return (isCreditDocument(documentType) ? -ledger : ledger) as 1 | -1;
}

export interface StatementEntry {
  date: string;
  reference: string;
  description: string;
  /** Тэмдэгтэй MNT дүн (+ дебит / − кредит). */
  amount: number;
  /** Нэг өдрийн доторх дараалал: баримт эхэлж, дараа нь төлбөр. */
  order: number;
}

export interface StatementRow {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

/** Акт + талуудын мэдээлэл (lib/arap/statement-db.ts ачаална) — client-safe төрөл. */
export interface CounterpartyStatement extends Statement {
  counterparty: { id: string; name: string; registerNo: string | null; email: string | null };
  company: { name: string; registerNo: string | null; address: string | null; phone: string | null };
  conclusion: string;
}

export interface Statement {
  from: string;
  to: string;
  opening: number;
  rows: StatementRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Эхний үлдэгдэл = `from`-оос өмнөх бүх гүйлгээ; мөрүүд = [from, to]. */
export function buildStatement(entries: StatementEntry[], from: string, to: string): Statement {
  const sorted = [...entries]
    .filter((entry) => entry.date <= to && Math.abs(entry.amount) > 0.004)
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference));
  let opening = 0;
  const rows: StatementRow[] = [];
  let balance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of sorted) {
    if (entry.date < from) {
      opening = round(opening + entry.amount);
      continue;
    }
    if (rows.length === 0) balance = opening;
    balance = round(balance + entry.amount);
    const debit = entry.amount > 0 ? round(entry.amount) : 0;
    const credit = entry.amount < 0 ? round(-entry.amount) : 0;
    totalDebit = round(totalDebit + debit);
    totalCredit = round(totalCredit + credit);
    rows.push({ date: entry.date, reference: entry.reference, description: entry.description, debit, credit, balance });
  }
  return { from, to, opening, rows, totalDebit, totalCredit, closing: round(opening + totalDebit - totalCredit) };
}

const money = (value: number) =>
  Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Актын дүгнэлт: «2026-09-30-ны байдлаар Бат ХХК нь Entry ХХК-д 1,250,000.00₮ төлөх». */
export function statementConclusion(closing: number, to: string, companyName: string, counterpartyName: string): string {
  if (Math.abs(closing) < 0.005) return `${to}-ны байдлаар талуудын хооронд авлага, өглөг байхгүй (тооцоо дууссан).`;
  return closing > 0
    ? `${to}-ны байдлаар ${counterpartyName} нь ${companyName}-д ${money(closing)}₮ төлөх үлдэгдэлтэй.`
    : `${to}-ны байдлаар ${companyName} нь ${counterpartyName}-д ${money(closing)}₮ төлөх үлдэгдэлтэй.`;
}
