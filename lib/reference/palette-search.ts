// Палитрын лавлах хайлт — цэвэр логик (DB/UI-гүй, тесттэй).
//
// П5/П10: лавлах дата (данс, харилцагч, бараа) клиент кэшээс network-гүй
// шүүгдэнэ; эхэлж таарсан (startsWith) илэрц агуулж таарснаас түрүүлнэ.

export type ReferenceData = {
  accounts: { number: string; name: string }[];
  counterparties: { id: string; name: string; counterpartyType: string }[];
  items: { id: string; code: string; name: string }[];
};

export type ReferenceHit = {
  kind: "account" | "counterparty" | "item";
  /** account → дансны дугаар, бусад нь uuid. */
  id: string;
  label: string;
  /** Хажууд нь муутгаж үзүүлэх нэмэлт (дугаар/код/төрөл). */
  sub: string;
  /** counterparty routing: customer | supplier | both. */
  counterpartyType?: string;
};

/** Үүнээс богино query-д лавлах/баримтын хайлт хийхгүй. */
export const REFERENCE_MIN_QUERY = 2;

const GROUP_LIMIT = 5;

/** 2 = эхэлж таарсан, 1 = агуулж таарсан, 0 = таараагүй. */
function rank(haystack: string, query: string): number {
  if (haystack.startsWith(query)) return 2;
  if (haystack.includes(query)) return 1;
  return 0;
}

function top<T>(
  hits: { item: T; score: number }[],
  limit = GROUP_LIMIT
): T[] {
  return hits
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => hit.item);
}

export function searchReference(
  data: ReferenceData,
  query: string
): ReferenceHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < REFERENCE_MIN_QUERY) return [];

  const accounts = top(
    data.accounts.map((account) => ({
      item: {
        kind: "account" as const,
        id: account.number,
        label: account.name,
        sub: account.number,
      },
      score: Math.max(
        rank(account.number.toLowerCase(), q),
        rank(account.name.toLowerCase(), q)
      ),
    }))
  );

  const counterparties = top(
    data.counterparties.map((counterparty) => ({
      item: {
        kind: "counterparty" as const,
        id: counterparty.id,
        label: counterparty.name,
        sub:
          counterparty.counterpartyType === "customer"
            ? "худалдан авагч"
            : counterparty.counterpartyType === "supplier"
              ? "нийлүүлэгч"
              : "харилцагч",
        counterpartyType: counterparty.counterpartyType,
      },
      score: rank(counterparty.name.toLowerCase(), q),
    }))
  );

  const items = top(
    data.items.map((item) => ({
      item: {
        kind: "item" as const,
        id: item.id,
        label: item.name,
        sub: item.code,
      },
      score: Math.max(
        rank(item.code.toLowerCase(), q),
        rank(item.name.toLowerCase(), q)
      ),
    }))
  );

  return [...accounts, ...counterparties, ...items];
}
