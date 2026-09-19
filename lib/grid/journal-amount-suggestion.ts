export interface JournalAmountRow {
  id: string;
  debit: number;
  credit: number;
  /** Гадаад валютын дүн — валютын журналд энэ хосыг засварладаг. */
  debitFc?: number;
  creditFc?: number;
}

export type JournalAmountField = "debit" | "credit" | "debitFc" | "creditFc";

/** Дебет ↔ кредит талбарын ХОС — MNT эсвэл гадаад валютын. */
const OPPOSITE: Record<JournalAmountField, JournalAmountField> = {
  debit: "credit",
  credit: "debit",
  debitFc: "creditFc",
  creditFc: "debitFc",
};

/**
 * Commits a debit/credit edit and proposes the same amount on the opposite
 * side of the following row. Existing amounts on that row are never replaced.
 *
 * Валютын журналд ЯГ ИЖИЛ логик гадаад валютын хос дээр ажиллана —
 * хэрэглэгчийн дадал (нэг тал бичихэд дараагийн мөр саналаар бөглөгдөх)
 * валют сольсноор өөрчлөгдөхгүй.
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
  const oppositeField = OPPOSITE[field];

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
    (followingRow[field] ?? 0) === 0 &&
    (followingRow[oppositeField] ?? 0) === 0
  ) {
    nextRows[rowIndex + 1] = {
      ...followingRow,
      [oppositeField]: amount,
    } as T;
  }

  return nextRows;
}
