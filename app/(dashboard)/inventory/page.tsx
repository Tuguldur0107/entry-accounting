import { and, count, eq, ne, sql } from "drizzle-orm";

import { InventoryDashboard } from "@/components/inventory/inventory-dashboard";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { costEntries, inventoryMovements } from "@/lib/db/schema";
import { balanceKey } from "@/lib/inventory/balances";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";
import type { QtyBalanceRow } from "@/lib/inventory/types";

export default async function InventoryDashboardPage() {
  const { orgId } = await getActiveOrg();

  // Үлдэгдэл = хаагдсан үеийн snapshot + түүнээс хойшхи хөдөлгөөн; тоолуурууд
  // SQL-д — хөдөлгөөний бүх түүх JS-д ачаалагдахгүй.
  const [{ itemViews, warehouseViews }, balances, [draftRow], [unvaluedRow]] =
    await Promise.all([
      loadInventoryBase(orgId),
      loadQtyBalancesFast(orgId),
      db
        .select({ n: count() })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.organizationId, orgId),
            eq(inventoryMovements.status, "draft")
          )
        ),
      db
        .select({ n: count() })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.organizationId, orgId),
            eq(inventoryMovements.status, "confirmed"),
            ne(inventoryMovements.movementType, "transfer"),
            sql`not exists (
              select 1 from ${costEntries}
              where ${costEntries.movementId} = ${inventoryMovements.id}
                and ${costEntries.status} in ('draft', 'posted')
            )`
          )
        ),
    ]);

  const balanceRows: QtyBalanceRow[] = [];
  for (const item of itemViews) {
    for (const warehouse of warehouseViews) {
      const quantity = balances.get(balanceKey(item.id, warehouse.id)) ?? 0;
      if (quantity === 0) continue;
      balanceRows.push({
        itemId: item.id,
        itemLabel: `${item.code} · ${item.name}`,
        unit: item.unit,
        warehouseName: warehouse.name,
        quantity,
      });
    }
  }
  balanceRows.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  return (
    <InventoryDashboard
      balances={balanceRows}
      itemCount={itemViews.filter((item) => item.isActive).length}
      warehouseCount={warehouseViews.filter((w) => w.isActive).length}
      draftCount={Number(draftRow?.n ?? 0)}
      unvaluedCount={Number(unvaluedRow?.n ?? 0)}
    />
  );
}
