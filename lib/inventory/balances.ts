// Тоо хэмжээний үлдэгдэл — цэвэр тооцоолол (DB хамааралгүй, unit тесттэй).
// Inventory модуль ЗӨВХӨН тоо хэмжээ хөтөлнө; үнэлгээ costing модульд.

export type MovementType =
  | "receipt"
  | "issue"
  | "transfer"
  | "adjustment"
  // Буцаалт: return_in = худалдан авагчаас буцаж ирсэн (+qty),
  // return_out = нийлүүлэгчид буцаасан (−qty).
  | "return_in"
  | "return_out";

export interface MovementRef {
  id: string;
  movementType: MovementType;
  date: string; // YYYY-MM-DD
  itemId: string;
  warehouseId: string;
  toWarehouseId: string | null;
  /** Units. receipt/issue/transfer > 0; adjustment signed (+/−). */
  quantity: number;
  /** Tie-breaker for same-date ordering (ISO timestamp or insertion order). */
  createdAt: string;
}

export function balanceKey(itemId: string, warehouseId: string) {
  return `${itemId}|${warehouseId}`;
}

/** Per-warehouse quantity deltas a movement causes. */
export function movementEffects(
  movement: MovementRef
): { itemId: string; warehouseId: string; delta: number }[] {
  const qty = movement.quantity;
  switch (movement.movementType) {
    case "receipt":
    case "return_in":
      return [{ itemId: movement.itemId, warehouseId: movement.warehouseId, delta: qty }];
    case "issue":
    case "return_out":
      return [{ itemId: movement.itemId, warehouseId: movement.warehouseId, delta: -qty }];
    case "transfer":
      if (!movement.toWarehouseId) return [];
      return [
        { itemId: movement.itemId, warehouseId: movement.warehouseId, delta: -qty },
        { itemId: movement.itemId, warehouseId: movement.toWarehouseId, delta: qty },
      ];
    case "adjustment":
      return [{ itemId: movement.itemId, warehouseId: movement.warehouseId, delta: qty }];
    default:
      return [];
  }
}

export function sortChronologically<T extends MovementRef>(movements: T[]): T[] {
  return [...movements].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    // Same-millisecond ties: id keeps ordering deterministic across calls.
    return a.id.localeCompare(b.id);
  });
}

/** item|warehouse → on-hand quantity (confirmed movements only — caller filters). */
export function calculateQtyBalances(movements: MovementRef[]) {
  const balances = new Map<string, number>();
  for (const movement of movements) {
    for (const effect of movementEffects(movement)) {
      const key = balanceKey(effect.itemId, effect.warehouseId);
      balances.set(
        key,
        Math.round(((balances.get(key) ?? 0) + effect.delta) * 10000) / 10000
      );
    }
  }
  return balances;
}

export interface NegativeStockViolation {
  itemId: string;
  warehouseId: string;
  date: string;
  balanceAfter: number;
}

/**
 * Chronological replay of `existing ∪ candidate`: returns the first point at
 * which any item×warehouse balance would dip below zero, or null when safe.
 * Used when confirming a movement (including backdated ones — later existing
 * movements must stay non-negative too) and when cancelling a receipt.
 */
export function findNegativeStock(
  existing: MovementRef[],
  candidate?: MovementRef | null
): NegativeStockViolation | null {
  const all = sortChronologically(
    candidate ? [...existing, candidate] : existing
  );
  const balances = new Map<string, number>();
  for (const movement of all) {
    for (const effect of movementEffects(movement)) {
      const key = balanceKey(effect.itemId, effect.warehouseId);
      const next =
        Math.round(((balances.get(key) ?? 0) + effect.delta) * 10000) / 10000;
      balances.set(key, next);
      if (next < -0.00005) {
        return {
          itemId: effect.itemId,
          warehouseId: effect.warehouseId,
          date: movement.date,
          balanceAfter: next,
        };
      }
    }
  }
  return null;
}
