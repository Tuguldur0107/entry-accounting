import { and, eq, inArray } from "drizzle-orm";

import { InventoryDashboard } from "@/components/inventory/inventory-dashboard";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { costEntries, inventoryMovements } from "@/lib/db/schema";
import { calculateQtyBalances, balanceKey } from "@/lib/inventory/balances";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";
import type { QtyBalanceRow } from "@/lib/inventory/types";

export default async function InventoryDashboardPage() {
  const { orgId } = await getActiveOrg();

  const { itemViews, warehouseViews } = await loadInventoryBase(orgId);
  const [movements, activeEntries] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    }),
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
        inArray(costEntries.status, ["draft", "posted"])
      ),
      columns: { movementId: true },
    }),
  ]);

  const confirmed = movements.filter((m) => m.status === "confirmed");
  const balances = calculateQtyBalances(toMovementRefs(confirmed));

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

  const valuedIds = new Set(activeEntries.map((entry) => entry.movementId));
  const unvaluedCount = confirmed.filter(
    (m) => m.movementType !== "transfer" && !valuedIds.has(m.id)
  ).length;

  return (
    <InventoryDashboard
      balances={balanceRows}
      itemCount={itemViews.filter((item) => item.isActive).length}
      warehouseCount={warehouseViews.filter((w) => w.isActive).length}
      draftCount={movements.filter((m) => m.status === "draft").length}
      unvaluedCount={unvaluedCount}
    />
  );
}
