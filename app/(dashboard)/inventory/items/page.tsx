import { eq } from "drizzle-orm";

import { InventoryItemsView } from "@/components/inventory/inventory-items-view";
import { requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { vatSettings } from "@/lib/db/schema";
import { loadCategoryLevels, loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryItemsPage() {
  const { orgId } = await requireModuleAction("inv", "read");
  const [{ itemViews, categoryViews }, levels, vat] = await Promise.all([
    loadInventoryBase(orgId),
    loadCategoryLevels(orgId),
    // SIM2-030: НӨАТ төлөгч биш бол барааны формд НӨАТ-ын хэсэг хураагдана.
    db.query.vatSettings.findFirst({
      where: eq(vatSettings.organizationId, orgId),
      columns: { isVatPayer: true },
    }),
  ]);
  return (
    <InventoryItemsView
      items={itemViews}
      categories={categoryViews}
      levels={levels}
      isVatPayer={vat?.isVatPayer ?? true}
    />
  );
}
