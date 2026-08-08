import { eq } from "drizzle-orm";

import { CostEntriesView } from "@/components/costing/cost-entries-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { costEntries } from "@/lib/db/schema";
import type { CostEntryView } from "@/lib/inventory/types";

type SearchParams = Promise<{ status?: string }>;

export default async function CostEntriesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const userId = session!.user!.id!;
  const { status } = await searchParams;

  // Дэлгэрэнгүй (GL мөр, дансны нэр, сегмент) нь одоо панель өөрөө
  // getCostEntryPanelData-аар татдаг тул энд зөвхөн жагсаалтын өгөгдөл.
  const entries = await db.query.costEntries.findMany({
    where: eq(costEntries.userId, userId),
    with: { movement: { with: { item: true } }, item: true },
    orderBy: (entry, { desc }) => [desc(entry.date), desc(entry.createdAt)],
  });

  const views: CostEntryView[] = entries.map((entry) => {
    const item = entry.movement?.item ?? entry.item;
    return {
    id: entry.id,
    movementId: entry.movementId,
    // NRV нь entryType-аар тодорхойлогдоно — movement нь устсан reversed
    // бичилтийг NRV гэж андуурахгүй.
    documentNo:
      entry.movement?.documentNo ??
      (entry.entryType === "nrv_writedown" || entry.entryType === "nrv_reversal"
        ? "NRV"
        : "—"),
    itemLabel: item ? `${item.code} · ${item.name}` : "⚠ Бараа сонгоогүй",
    unit: item?.unit ?? "",
    entryType: entry.entryType,
    date: entry.date,
    quantity: Number(entry.quantity),
    unitCost: Number(entry.unitCost),
    amount: Number(entry.amount),
    valuationSource: entry.valuationSource,
    status: entry.status,
    voucherId: entry.voucherId,
    };
  });

  return <CostEntriesView entries={views} initialStatus={status} />;
}
