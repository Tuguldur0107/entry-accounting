import type { CashAccount, CashDocument } from "@/lib/db/schema";

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

