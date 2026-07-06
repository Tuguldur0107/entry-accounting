import type { CashAccount, CashDocument } from "@/lib/db/schema";

export interface CashMovementRow {
  accountId: string;
  accountName: string;
  currency: string;
  opening: number;
  receipts: number;
  payments: number;
  closing: number;
}

// Per-account cash movement for a period: opening balance carried from
// before `periodStart`, plus receipts / payments / transfers within the
// [periodStart, periodEnd] window. Only posted documents count. Transfers
// move money between two cash accounts, so they appear as a payment on the
// source and a receipt on the destination.
export function calculateCashMovement(
  accounts: CashAccount[],
  documents: CashDocument[],
  periodStart: string,
  periodEnd: string
): CashMovementRow[] {
  const rows = new Map<string, CashMovementRow>(
    accounts.map((a) => [
      a.id,
      {
        accountId: a.id,
        accountName: a.name,
        currency: a.currency,
        opening: Number(a.openingBalance),
        receipts: 0,
        payments: 0,
        closing: 0,
      },
    ])
  );

  for (const doc of documents) {
    if (doc.status !== "posted") continue;
    const amount = Number(doc.amount);
    const before = doc.date < periodStart;
    const inPeriod = doc.date >= periodStart && doc.date <= periodEnd;
    if (!before && !inPeriod) continue;

    const outAcc =
      (doc.documentType === "payment" || doc.documentType === "transfer") &&
      doc.fromCashAccountId
        ? rows.get(doc.fromCashAccountId)
        : undefined;
    const inAcc =
      (doc.documentType === "receipt" || doc.documentType === "transfer") &&
      doc.toCashAccountId
        ? rows.get(doc.toCashAccountId)
        : undefined;

    if (before) {
      if (outAcc) outAcc.opening -= amount;
      if (inAcc) inAcc.opening += amount;
    } else {
      if (outAcc) outAcc.payments += amount;
      if (inAcc) inAcc.receipts += amount;
    }
  }

  const out = [...rows.values()];
  for (const r of out) r.closing = r.opening + r.receipts - r.payments;
  return out.sort((a, b) => a.accountName.localeCompare(b.accountName));
}

export function calculateCashBalances(
  accounts: CashAccount[],
  documents: CashDocument[]
) {
  const balances = new Map(
    accounts.map((account) => [account.id, Number(account.openingBalance)])
  );

  for (const document of documents) {
    if (document.status !== "posted") continue;
    const amount = Number(document.amount);

    if (
      (document.documentType === "payment" ||
        document.documentType === "transfer") &&
      document.fromCashAccountId
    ) {
      balances.set(
        document.fromCashAccountId,
        (balances.get(document.fromCashAccountId) ?? 0) - amount
      );
    }

    if (
      (document.documentType === "receipt" ||
        document.documentType === "transfer") &&
      document.toCashAccountId
    ) {
      balances.set(
        document.toCashAccountId,
        (balances.get(document.toCashAccountId) ?? 0) + amount
      );
    }
  }

  return balances;
}

