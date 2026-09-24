import { InventoryWarehousesView } from "@/components/inventory/inventory-warehouses-view";
import { requireModuleAction } from "@/lib/auth";
import { loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryWarehousesPage() {
  const { orgId } = await requireModuleAction("inv", "read");
  const { warehouseViews } = await loadInventoryBase(orgId);
  return <InventoryWarehousesView warehouses={warehouseViews} />;
}
