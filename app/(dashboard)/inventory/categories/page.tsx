import { InventoryCategoriesView } from "@/components/inventory/inventory-categories-view";
import { requireModuleAction } from "@/lib/auth";
import { loadCategoryLevels, loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryCategoriesPage() {
  const { orgId } = await requireModuleAction("inv", "read");
  const [{ itemViews, categoryViews }, levels] = await Promise.all([
    loadInventoryBase(orgId),
    loadCategoryLevels(orgId),
  ]);
  const itemCounts: Record<string, number> = {};
  for (const item of itemViews)
    if (item.categoryCode) itemCounts[item.categoryCode] = (itemCounts[item.categoryCode] ?? 0) + 1;
  return <InventoryCategoriesView categories={categoryViews} levels={levels} itemCounts={itemCounts} />;
}
