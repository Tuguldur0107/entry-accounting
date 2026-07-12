import { InventoryMovementsView } from "@/components/inventory/inventory-movements-view";
import { auth } from "@/lib/auth";
import { loadInventoryBase, loadMovements } from "@/lib/inventory/load-data";

type SearchParams = Promise<{ type?: string; status?: string }>;

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { type, status } = await searchParams;

  const [{ itemViews, warehouseViews }, movements] = await Promise.all([
    loadInventoryBase(userId),
    loadMovements(userId),
  ]);

  return (
    <InventoryMovementsView
      movements={movements}
      items={itemViews}
      warehouses={warehouseViews}
      initialType={type}
      initialStatus={status}
    />
  );
}
