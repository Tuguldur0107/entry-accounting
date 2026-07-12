import type { CashDocument } from "@/lib/db/schema";

const TOLERANCE = 0.01;

export function cashDocumentEffect(
  document: Pick<
    CashDocument,
    | "status"
    | "documentType"
    | "fromCashAccountId"
    | "toCashAccountId"
    | "amount"
  >,
  accountId: string
) {
  if (document.status !== "posted") return 0;
  const amount = Number(document.amount);
  let effect = 0;
  if (document.toCashAccountId === accountId) effect += amount;
  if (document.fromCashAccountId === accountId) effect -= amount;
  return effect;
}

export function calculateFxRevaluation(
  foreignBalance: number,
  closingRate: number,
  carryingAmount: number
) {
  if (!Number.isFinite(foreignBalance))
    throw new Error("Валютын үлдэгдэл буруу байна");
  if (!Number.isFinite(closingRate) || closingRate <= 0)
    throw new Error("Хаалтын ханш 0-ээс их байна");
  if (!Number.isFinite(carryingAmount))
    throw new Error("GL carrying amount буруу байна");

  const revaluedAmount = Math.round(foreignBalance * closingRate * 100) / 100;
  const adjustmentAmount =
    Math.round((revaluedAmount - carryingAmount) * 100) / 100;
  return { revaluedAmount, adjustmentAmount };
}

export function reconciliationStatus(
  cashToGlDifference: number | null,
  bankToCashDifference: number | null,
  hasRate: boolean,
  isStatementCurrent = true
) {
  if (!hasRate) return "missing-rate" as const;
  if (bankToCashDifference != null && !isStatementCurrent)
    return "stale-statement" as const;
  if (
    (cashToGlDifference != null &&
      Math.abs(cashToGlDifference) > TOLERANCE) ||
    (bankToCashDifference != null &&
      Math.abs(bankToCashDifference) > TOLERANCE)
  )
    return "exception" as const;
  if (bankToCashDifference == null) return "no-statement" as const;
  return "balanced" as const;
}
