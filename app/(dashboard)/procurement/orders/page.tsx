// Худалдан авалтын захиалгын жагсаалт (Server Component).
//
// Шүүлтүүр нь URL параметрээр (`?status=`, `?supplier=`) — deep link хэвээр
// ажиллана. Next 16-д searchParams нь Promise тул await хийнэ.

import { PurchaseOrdersView } from "@/components/procurement/purchase-orders-view";
import { getActiveOrg } from "@/lib/auth";
import { loadPurchaseOrders } from "@/lib/procurement/load-data";

type SearchParams = Promise<{ status?: string; supplier?: string }>;

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const { status, supplier } = await searchParams;

  // Шүүлтүүр нь client талд (тоолуур бүх статусаар харагдах ёстой) — сервер
  // нь бүх захиалгыг НЭГ удаа уншина.
  const orders = await loadPurchaseOrders(orgId);

  return (
    <PurchaseOrdersView
      orders={orders}
      initialStatus={status}
      initialSupplier={supplier}
    />
  );
}
