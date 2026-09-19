// Хасах үлдэгдэлтэй бараа × агуулах — ЦЭВЭР (DB хамааралгүй) туслах.
// docs/pos/00-proposal.md §3.9 (D9): POS борлуулалт хасах үлдэгдлээр
// зогсдоггүй тул самбар / сар хаалтын checklist дээр ИЛ харуулна.
// Үлдэгдлийн эх сурвалж нь loadQtyBalancesFast (snapshot + delta) — энд
// зөвхөн сөрөг мөрийг шошготой болгож эрэмбэлнэ.

import { balanceKey } from "./balances";

export interface NegativeStockRow {
  itemId: string;
  warehouseId: string;
  /** "Код · Нэр". */
  itemLabel: string;
  unit: string;
  warehouseName: string;
  /** Сөрөг тоо хэмжээ (< 0). */
  quantity: number;
}

/**
 * balanceKey → тоо хэмжээ Map-аас сөрөг үлдэгдэлтэй мөрүүдийг гаргана —
 * хамгийн их хасах нь эхэнд (өсөх дарааллаар). Бараа / агуулах лавлахад
 * олдохгүй түлхүүр (устгагдсан г.м.) алгасагдана.
 */
export function findNegativeBalances(
  balances: Map<string, number>,
  items: readonly { id: string; code: string; name: string; unit: string }[],
  warehouses: readonly { id: string; name: string }[]
): NegativeStockRow[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));
  const rows: NegativeStockRow[] = [];
  for (const item of items) {
    for (const warehouse of warehouses) {
      const quantity = balances.get(balanceKey(item.id, warehouse.id)) ?? 0;
      if (!(quantity < 0)) continue;
      const known = itemById.get(item.id);
      const wh = warehouseById.get(warehouse.id);
      if (!known || !wh) continue;
      rows.push({
        itemId: item.id,
        warehouseId: warehouse.id,
        itemLabel: `${known.code} · ${known.name}`,
        unit: known.unit,
        warehouseName: wh.name,
        quantity,
      });
    }
  }
  return rows.sort(
    (a, b) => a.quantity - b.quantity || a.itemLabel.localeCompare(b.itemLabel)
  );
}

/** Сөрөг үлдэгдэлтэй бараа×агуулахын ТОО (сар хаалтын checklist-д). */
export function countNegativeScopes(balances: Map<string, number>): number {
  let n = 0;
  for (const quantity of balances.values()) if (quantity < 0) n += 1;
  return n;
}
