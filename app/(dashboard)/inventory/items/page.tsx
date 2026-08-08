import { InventoryItemsView } from "@/components/inventory/inventory-items-view";
import { getActiveOrg } from "@/lib/auth";
import { loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryItemsPage() {
  const { orgId } = await getActiveOrg();
  const { itemViews, warehouseViews } = await loadInventoryBase(orgId);
  return <InventoryItemsView items={itemViews} warehouses={warehouseViews} />;
}
