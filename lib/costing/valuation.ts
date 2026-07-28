// Нөөцийн үнэлгээний НЭГ Л суурь — cost_period_results-ийн C2.
//
// docs/cost FR-PR-001: Version 1-д ЗӨВХӨН хугацааны жигнэсэн дундаж.
// RPT-PR-001: тайлангууд Inventory/Cost Ledger-ээс гарна. Тиймээс нөөцийн
// үнэлгээ, NRV-ийн харьцуулах суурь, өртгийн хяналтын тайлан ГУРВУУЛАА
// нэг эх сурвалжтай байх ёстой — эс бөгөөс тайлан хооронд зөрүү үүснэ.

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { costPeriodResults } from "@/lib/db/schema";

export interface ClosingBalance {
  qty: number;
  amount: number;
  /** Аль сарын үр дүнгээс авсан. */
  periodCode: string;
}

/**
 * Бараа тус бүрийн ХАМГИЙН СҮҮЛИЙН тооцоологдсон сарын C2 — агуулахуудыг
 * нэгтгэсэн. Тооцоологдоогүй (blocked) сарыг АВАХГҮЙ — үнэ зохиохгүй.
 */
export async function latestClosingByItem(
  userId: string
): Promise<Map<string, ClosingBalance>> {
  const rows = await db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.userId, userId),
      eq(costPeriodResults.status, "calculated")
    ),
    columns: {
      itemId: true,
      warehouseId: true,
      periodCode: true,
      closingQty: true,
      closingAmount: true,
    },
  });

  // Бараа × агуулах бүрийн хамгийн сүүлийн сарыг сонгоод, дараа нь барааны
  // хэмжээнд нэгтгэнэ (хамрах хүрээ нь бараа × агуулах — OD-001).
  const latestByScope = new Map<
    string,
    { itemId: string; periodCode: string; qty: number; amount: number }
  >();
  for (const row of rows) {
    const key = `${row.itemId}::${row.warehouseId}`;
    const current = latestByScope.get(key);
    if (current && current.periodCode >= row.periodCode) continue;
    latestByScope.set(key, {
      itemId: row.itemId,
      periodCode: row.periodCode,
      qty: Number(row.closingQty),
      amount: Number(row.closingAmount ?? 0),
    });
  }

  const byItem = new Map<string, ClosingBalance>();
  for (const scope of latestByScope.values()) {
    const current = byItem.get(scope.itemId);
    if (current) {
      current.qty += scope.qty;
      current.amount += scope.amount;
      if (scope.periodCode > current.periodCode)
        current.periodCode = scope.periodCode;
    } else
      byItem.set(scope.itemId, {
        qty: scope.qty,
        amount: scope.amount,
        periodCode: scope.periodCode,
      });
  }
  return byItem;
}

/**
 * Нэг бараа-агуулахын хамгийн сүүлийн тооцоологдсон нэгж өртөг (C2 нэгж
 * өртөг). NRV-ийн харьцуулалтад хэрэглэгдэнэ — IAS 2 §9: өртөг ба цэвэр
 * боломжит үнийн аль багыг сонгоно.
 */
export async function latestUnitCost(
  userId: string,
  itemId: string
): Promise<{ qty: number; unitCost: number; periodCode: string } | null> {
  const rows = await db.query.costPeriodResults.findMany({
    where: and(
      eq(costPeriodResults.userId, userId),
      eq(costPeriodResults.itemId, itemId),
      eq(costPeriodResults.status, "calculated")
    ),
    columns: {
      warehouseId: true,
      periodCode: true,
      closingQty: true,
      closingAmount: true,
      averageUnitCost: true,
    },
  });
  if (rows.length === 0) return null;

  // Бараа-агуулах бүрийн сүүлийн сарыг авч, барааны хэмжээнд нэгтгэнэ.
  const latestByWarehouse = new Map<
    string,
    { periodCode: string; qty: number; amount: number }
  >();
  for (const row of rows) {
    const current = latestByWarehouse.get(row.warehouseId);
    if (current && current.periodCode >= row.periodCode) continue;
    latestByWarehouse.set(row.warehouseId, {
      periodCode: row.periodCode,
      qty: Number(row.closingQty),
      amount: Number(row.closingAmount ?? 0),
    });
  }

  let qty = 0;
  let amount = 0;
  let periodCode = "";
  for (const entry of latestByWarehouse.values()) {
    qty += entry.qty;
    amount += entry.amount;
    if (entry.periodCode > periodCode) periodCode = entry.periodCode;
  }
  if (!(qty > 0)) return null;
  return { qty, unitCost: amount / qty, periodCode };
}
