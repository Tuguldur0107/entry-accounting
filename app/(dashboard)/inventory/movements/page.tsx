import { InventoryMovementsView } from "@/components/inventory/inventory-movements-view";
import { getActiveOrg } from "@/lib/auth";
import { loadIssueTypes } from "@/lib/costing/master-data";
import { loadInventoryBase, loadMovements } from "@/lib/inventory/load-data";

type SearchParams = Promise<{ type?: string; status?: string }>;

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { type, status } = await searchParams;

  const [{ itemViews, warehouseViews }, movements, issueTypes] =
    await Promise.all([
      loadInventoryBase(orgId),
      loadMovements(orgId),
      loadIssueTypes(orgId, { activeOnly: true }),
    ]);

  return (
    <InventoryMovementsView
      movements={movements}
      items={itemViews}
      warehouses={warehouseViews}
      issueTypes={issueTypes.map((entry) => ({
        id: entry.id,
        code: entry.code,
        name: entry.name,
        destinationClass: entry.destinationClass,
      }))}
      initialType={type}
      initialStatus={status}
    />
  );
}
