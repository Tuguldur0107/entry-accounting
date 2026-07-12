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

export interface CashDetailRow {
  id: string;
  accountId: string;
  accountName: string;
  accountType: string;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
  date: string;
  documentNo: string;
  documentType: string;
  counterparty: string | null;
  counterAccountNumber: string | null;
  cashFlowCode: string | null;
  description: string;
  receipt: number;
  payment: number;
  baseReceipt: number;
  basePayment: number;
  exchangeRate: number;
  runningBalance: number;
  status: string;
  voucherId: string | null;
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

export function calculateCashDetailRows(
  accounts: CashAccount[],
  documents: CashDocument[],
  periodStart: string,
  periodEnd: string
): CashDetailRow[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const openingBalances = new Map(
    accounts.map((account) => [account.id, Number(account.openingBalance)])
  );

  const postedDocuments = documents
    .filter((document) => document.status === "posted")
    .sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return a.documentNo.localeCompare(b.documentNo);
    });

  for (const document of postedDocuments) {
    if (document.date >= periodStart) continue;
    const amount = Number(document.amount);
    if (
      (document.documentType === "payment" ||
        document.documentType === "transfer") &&
      document.fromCashAccountId
    ) {
      openingBalances.set(
        document.fromCashAccountId,
        (openingBalances.get(document.fromCashAccountId) ?? 0) - amount
      );
    }
    if (
      (document.documentType === "receipt" ||
        document.documentType === "transfer") &&
      document.toCashAccountId
    ) {
      openingBalances.set(
        document.toCashAccountId,
        (openingBalances.get(document.toCashAccountId) ?? 0) + amount
      );
    }
  }

  const runningBalances = new Map(openingBalances);
  const rows: CashDetailRow[] = accounts.map((account) => ({
    id: `opening-${account.id}`,
    accountId: account.id,
    accountName: account.name,
    accountType: account.accountType,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    currency: account.currency,
    date: periodStart,
    documentNo: "Эхний үлдэгдэл",
    documentType: "opening",
    counterparty: null,
    counterAccountNumber: null,
    cashFlowCode: null,
    description: `${periodStart} өдрийн эхний үлдэгдэл`,
    receipt: 0,
    payment: 0,
    baseReceipt: 0,
    basePayment: 0,
    exchangeRate: account.currency === "MNT" ? 1 : 0,
    runningBalance: openingBalances.get(account.id) ?? 0,
    status: "posted",
    voucherId: null,
  }));

  function addMovement(
    document: CashDocument,
    accountId: string,
    direction: "receipt" | "payment"
  ) {
    const account = accountMap.get(accountId);
    if (!account) return;
    const amount = Number(document.amount);
    const baseAmount = Number(document.baseAmount ?? document.amount);
    const nextBalance =
      (runningBalances.get(accountId) ?? 0) +
      (direction === "receipt" ? amount : -amount);
    runningBalances.set(accountId, nextBalance);

    rows.push({
      id: `${document.id}-${accountId}-${direction}`,
      accountId,
      accountName: account.name,
      accountType: account.accountType,
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      currency: account.currency,
      date: document.date,
      documentNo: document.documentNo,
      documentType: document.documentType,
      counterparty: document.counterparty,
      counterAccountNumber: document.counterAccountNumber,
      cashFlowCode: document.cashFlowCode,
      description: document.description,
      receipt: direction === "receipt" ? amount : 0,
      payment: direction === "payment" ? amount : 0,
      baseReceipt: direction === "receipt" ? baseAmount : 0,
      basePayment: direction === "payment" ? baseAmount : 0,
      exchangeRate: Number(document.exchangeRate ?? 1),
      runningBalance: nextBalance,
      status: document.status,
      voucherId: document.voucherId,
    });
  }

  for (const document of postedDocuments) {
    if (document.date < periodStart || document.date > periodEnd) continue;
    if (
      (document.documentType === "receipt" ||
        document.documentType === "transfer") &&
      document.toCashAccountId
    ) {
      addMovement(document, document.toCashAccountId, "receipt");
    }
    if (
      (document.documentType === "payment" ||
        document.documentType === "transfer") &&
      document.fromCashAccountId
    ) {
      addMovement(document, document.fromCashAccountId, "payment");
    }
  }

  return rows.sort((a, b) => {
    const byAccount = a.accountName.localeCompare(b.accountName);
    if (byAccount !== 0) return byAccount;
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    if (a.documentType === "opening") return -1;
    if (b.documentType === "opening") return 1;
    return a.documentNo.localeCompare(b.documentNo);
  });
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
