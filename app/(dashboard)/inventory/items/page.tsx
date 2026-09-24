import { InventoryItemsView } from "@/components/inventory/inventory-items-view";
import { requireModuleAction } from "@/lib/auth";
import { loadCategoryLevels, loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryItemsPage() {
  const { orgId } = await requireModuleAction("inv", "read");
  const [{ itemViews, categoryViews }, levels] = await Promise.all([
    loadInventoryBase(orgId),
    loadCategoryLevels(orgId),
  ]);
  return <InventoryItemsView items={itemViews} categories={categoryViews} levels={levels} />;
}
