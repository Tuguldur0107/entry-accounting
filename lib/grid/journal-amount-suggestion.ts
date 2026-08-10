export interface JournalAmountRow {
  id: string;
  debit: number;
  credit: number;
}

export type JournalAmountField = "debit" | "credit";

/**
 * Commits a debit/credit edit and proposes the same amount on the opposite
 * side of the following row. Existing amounts on that row are never replaced.
 */
export function applyJournalAmountSuggestion<T extends JournalAmountRow>(
  rows: T[],
  rowId: string,
  field: JournalAmountField,
  rawAmount: unknown
): T[] {
  const rowIndex = rows.findIndex((row) => row.id === rowId);
  if (rowIndex < 0) return rows;

  const parsedAmount = Number(rawAmount);
  const amount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  const oppositeField: JournalAmountField =
    field === "debit" ? "credit" : "debit";

  const nextRows = [...rows];
  nextRows[rowIndex] = {
    ...rows[rowIndex],
    [field]: amount,
    ...(amount > 0 ? { [oppositeField]: 0 } : {}),
  } as T;

  const followingRow = rows[rowIndex + 1];
  if (
    amount > 0 &&
    followingRow &&
    followingRow.debit === 0 &&
    followingRow.credit === 0
  ) {
    nextRows[rowIndex + 1] = {
      ...followingRow,
      [oppositeField]: amount,
    } as T;
  }

  return nextRows;
}
