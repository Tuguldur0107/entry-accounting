import {
  InventoryCountingView,
  type CountSheetRow,
} from "@/components/inventory/inventory-counting-view";
import { getActiveOrg } from "@/lib/auth";
import { balanceKey } from "@/lib/inventory/balances";
import { loadInventoryBase } from "@/lib/inventory/load-data";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";

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

  // П2 — үлдэгдлийн query агуулахын сонголтоос хамаардаггүй тул суурь
  // дататай зэрэгцээ татна; snapshot + delta (asOf-оор).
  const [{ itemViews, warehouseViews }, balances] = await Promise.all([
    loadInventoryBase(orgId),
    loadQtyBalancesFast(orgId, asOfDate),
  ]);
  const activeWarehouses = warehouseViews.filter((w) => w.isActive);
  const selectedWarehouseId =
    activeWarehouses.find((w) => w.id === params.warehouse)?.id ??
    activeWarehouses[0]?.id ??
    "";

  let rows: CountSheetRow[] = [];
  if (selectedWarehouseId) {
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
