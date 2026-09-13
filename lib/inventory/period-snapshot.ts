// Бараа × агуулахын периодын хаалтын үлдэгдэл — бичих/устгах (П28-ын бараа
// материалын хувилбар). closePeriod-ийн exclusive lock-той транзакц ДОТОР
// дуудагдана тул хаагдсан агшны үнэн төлөв; дахин нээхэд устдаг.
//
// Дүрэм lib/inventory/balances.ts movementEffects-тэй ЯГ ИЖИЛ:
//   receipt|return_in|adjustment(тэмдэгтэй) → +, issue|return_out → −,
//   transfer → warehouse-оос −, toWarehouse руу +; зөвхөн status = confirmed.
// Нэгтгэл Postgres-д — хөдөлгөөн JS-д ачаалагдахгүй; 0 үлдэгдэл хадгалагдахгүй.

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { inventoryPeriodBalances } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function writeInventoryPeriodSnapshot(
  tx: Tx,
  params: { orgId: string; userId: string; code: string; endDate: string }
): Promise<void> {
  const { orgId, userId, code, endDate } = params;
  await tx
    .delete(inventoryPeriodBalances)
    .where(
      and(
        eq(inventoryPeriodBalances.organizationId, orgId),
        eq(inventoryPeriodBalances.periodCode, code)
      )
    );
  await tx.execute(sql`
    INSERT INTO inventory_period_balances
      (user_id, organization_id, period_code, item_id, warehouse_id, quantity)
    SELECT ${userId}, ${orgId}, ${code}, e.item_id, e.warehouse_id, SUM(e.delta)
    FROM (
      SELECT m.item_id, m.warehouse_id,
        CASE m.movement_type
          WHEN 'issue' THEN -m.quantity
          WHEN 'return_out' THEN -m.quantity
          WHEN 'transfer' THEN -m.quantity
          ELSE m.quantity
        END AS delta
      FROM inventory_movements m
      WHERE m.organization_id = ${orgId}
        AND m.status = 'confirmed'
        AND m.date <= ${endDate}
        AND m.item_id IS NOT NULL AND m.warehouse_id IS NOT NULL
        AND (m.movement_type <> 'transfer' OR m.to_warehouse_id IS NOT NULL)
      UNION ALL
      SELECT m.item_id, m.to_warehouse_id, m.quantity
      FROM inventory_movements m
      WHERE m.organization_id = ${orgId}
        AND m.status = 'confirmed'
        AND m.date <= ${endDate}
        AND m.movement_type = 'transfer'
        AND m.item_id IS NOT NULL AND m.to_warehouse_id IS NOT NULL
    ) e
    GROUP BY e.item_id, e.warehouse_id
    HAVING ROUND(SUM(e.delta), 4) <> 0
  `);
}

export async function deleteInventoryPeriodSnapshot(
  tx: Tx,
  params: { orgId: string; code: string }
): Promise<void> {
  await tx
    .delete(inventoryPeriodBalances)
    .where(
      and(
        eq(inventoryPeriodBalances.organizationId, params.orgId),
        eq(inventoryPeriodBalances.periodCode, params.code)
      )
    );
}
