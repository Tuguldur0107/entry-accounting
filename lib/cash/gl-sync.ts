// Нэг эх сурвалж: үндсэн дансны салгагч. Хуучин нэрээр re-export.
export { extractMainAccount as mainAccountOf } from "@/lib/reports/balances";
import { extractMainAccount } from "@/lib/reports/balances";
// GL → Cash subledger sync.
//
// When a journal voucher is posted in the GL that touches a cash/bank
// account's linked GL account, we surface a DRAFT cash document so the cash
// subledger stays in step with the ledger. The draft references the GL
// voucher via `sourceVoucherId`; confirming it later *adopts* that voucher
// instead of posting a new one (the GL entry already exists — re-posting
// would double-count).
//
// This module is a pure derivation with no DB access so it can be unit
// tested; the server action wires it to the database.

export interface CashAccountRef {
  id: string;
  glAccountNumber: string; // 8-digit main account linked to this cash account
  currency: string;
  isActive: boolean;
}

export interface VoucherLineRef {
  accountNumber: string; // 10-part dotted OR bare 8-digit
  debit: number;
  credit: number;
  description: string | null;
}

export type DerivedDocumentType = "receipt" | "payment" | "transfer";

export interface DerivedCashDocument {
  documentType: DerivedDocumentType;
  fromCashAccountId: string | null;
  toCashAccountId: string | null;
  counterAccountNumber: string | null;
  /** S8 cash-flow classification carried over from the GL cash line. */
  cashFlowCode: string | null;
  amount: number;
  currency: string;
  description: string;
}


// S8 cash-flow classification = segment 8 (parts[7]). Padding defaults
// ("", "0", "0000"…) mean "unclassified" → null.
function cashFlowCodeOf(accountNumber: string): string | null {
  const parts = accountNumber.split(".");
  if (parts.length !== 10) return null;
  const code = parts[7];
  return code && !/^0+$/.test(code) ? code : null;
}

// Returns a draft cash-document spec derived from a voucher, or null when the
// voucher doesn't map cleanly onto a single cash movement.
//
// Rules:
//   0 cash lines            → null (no cash involvement)
//   1 cash line             → receipt (debit) / payment (credit); counter =
//                             the sole opposite line's main account, else null
//   2 cash lines (Dr + Cr)  → transfer between the two cash accounts
//   otherwise               → null (ambiguous — don't guess)
export function deriveCashDocumentFromVoucher(input: {
  voucherDescription: string;
  lines: VoucherLineRef[];
  cashAccounts: CashAccountRef[];
}): DerivedCashDocument | null {
  const byGl = new Map<string, CashAccountRef>();
  for (const a of input.cashAccounts) byGl.set(a.glAccountNumber, a);

  const tagged = input.lines.map((l) => ({
    line: l,
    main: extractMainAccount(l.accountNumber),
    cash: byGl.get(extractMainAccount(l.accountNumber)) ?? null,
  }));

  const cashLines = tagged.filter((t) => t.cash);
  const nonCashLines = tagged.filter((t) => !t.cash);
  const desc = input.voucherDescription.trim() || "GL журналаас";

  if (cashLines.length === 0) return null;

  // Single cash line → receipt or payment.
  if (cashLines.length === 1) {
    const { line, cash } = cashLines[0];
    if (!cash) return null;
    const isReceipt = line.debit > 0;
    const amount = isReceipt ? line.debit : line.credit;
    if (!(amount > 0)) return null;
    // Counter GL account: only if there's exactly one opposite line; a
    // multi-split voucher is left for the user to fill in.
    const counter =
      nonCashLines.length === 1 ? nonCashLines[0].main : null;
    return {
      documentType: isReceipt ? "receipt" : "payment",
      fromCashAccountId: isReceipt ? null : cash.id,
      toCashAccountId: isReceipt ? cash.id : null,
      counterAccountNumber: counter,
      cashFlowCode: cashFlowCodeOf(line.accountNumber),
      amount,
      currency: cash.currency,
      description: desc,
    };
  }

  // Two cash lines → transfer (one debit side, one credit side).
  if (cashLines.length === 2) {
    const debitSide = cashLines.find((t) => t.line.debit > 0 && t.line.credit === 0);
    const creditSide = cashLines.find((t) => t.line.credit > 0 && t.line.debit === 0);
    if (!debitSide || !creditSide || !debitSide.cash || !creditSide.cash) return null;
    if (debitSide.cash.id === creditSide.cash.id) return null;
    // A cross-currency transfer can't be represented by one amount in one
    // currency (each leg moves different units). Mirror createCashDocument's
    // guard and leave it for manual handling instead of corrupting a balance.
    if (debitSide.cash.currency !== creditSide.cash.currency) return null;
    const amount = debitSide.line.debit;
    if (!(amount > 0)) return null;
    return {
      documentType: "transfer",
      fromCashAccountId: creditSide.cash.id, // money leaves the credited cash acct
      toCashAccountId: debitSide.cash.id, // money enters the debited cash acct
      counterAccountNumber: null,
      cashFlowCode: cashFlowCodeOf(debitSide.line.accountNumber),
      amount,
      currency: debitSide.cash.currency,
      description: desc,
    };
  }

  return null;
}
