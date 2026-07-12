import { InventoryItemsView } from "@/components/inventory/inventory-items-view";
import { auth } from "@/lib/auth";
import { loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryItemsPage() {
  const session = await auth();
  const userId = session!.user!.id!;
  const { itemViews, warehouseViews } = await loadInventoryBase(userId);
  return <InventoryItemsView items={itemViews} warehouses={warehouseViews} />;
}
