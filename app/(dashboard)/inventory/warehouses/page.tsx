import { and, eq } from "drizzle-orm";

import { InventoryWarehousesView } from "@/components/inventory/inventory-warehouses-view";
import { requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import { cashAccounts } from "@/lib/db/schema";
import { loadInventoryBase } from "@/lib/inventory/load-data";

export default async function InventoryWarehousesPage() {
  const { orgId } = await requireModuleAction("inv", "read");
  const [{ warehouseViews }, qpayAccounts] = await Promise.all([
    loadInventoryBase(orgId),
    // Салбарын QPay данс сонгогч — «QPay төлбөр хүлээн авах» тэмдэглэсэн
    // идэвхтэй банкны данс л (Касс → Данс); хоосон бол сонгогч заавар харуулна.
    db.query.cashAccounts.findMany({
      where: and(
        eq(cashAccounts.organizationId, orgId),
        eq(cashAccounts.accountType, "bank"),
        eq(cashAccounts.qpayPayout, true),
        eq(cashAccounts.isActive, true)
      ),
      columns: { id: true, name: true, bankName: true, accountNumber: true, qpayDefault: true },
      orderBy: (a, { desc, asc }) => [desc(a.qpayDefault), asc(a.name)],
    }),
  ]);
  return (
    <InventoryWarehousesView
      warehouses={warehouseViews}
      qpayAccounts={qpayAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        bankName: a.bankName ?? "",
        accountNumber: a.accountNumber ?? "",
        isDefault: a.qpayDefault,
      }))}
    />
  );
}
