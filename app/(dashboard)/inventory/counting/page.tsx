import { and, eq } from "drizzle-orm";

import {
  InventoryCountingView,
  type CountSheetRow,
} from "@/components/inventory/inventory-counting-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { inventoryMovements } from "@/lib/db/schema";
import { balanceKey, calculateQtyBalances } from "@/lib/inventory/balances";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";

type SearchParams = Promise<{ warehouse?: string; date?: string }>;

function today() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function InventoryCountingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const params = await searchParams;
  const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? params.date!
    : today();

  const { itemViews, warehouseViews } = await loadInventoryBase(orgId);
  const activeWarehouses = warehouseViews.filter((w) => w.isActive);
  const selectedWarehouseId =
    activeWarehouses.find((w) => w.id === params.warehouse)?.id ??
    activeWarehouses[0]?.id ??
    "";

  let rows: CountSheetRow[] = [];
  if (selectedWarehouseId) {
    const movements = await db.query.inventoryMovements.findMany({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.status, "confirmed")
      ),
    });
    const balances = calculateQtyBalances(
      toMovementRefs(movements).filter((ref) => ref.date <= asOfDate)
    );
    rows = itemViews
      .filter((item) => item.isActive)
      .map((item) => ({
        itemId: item.id,
        itemLabel: `${item.code} · ${item.name}`,
        unit: item.unit,
        systemQty: balances.get(balanceKey(item.id, selectedWarehouseId)) ?? 0,
      }));
  }

  return (
    <InventoryCountingView
      warehouses={warehouseViews}
      rows={rows}
      selectedWarehouseId={selectedWarehouseId}
      asOfDate={asOfDate}
    />
  );
}
