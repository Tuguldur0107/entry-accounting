import { and, eq, gte, lte } from "drizzle-orm";

import { CostEntriesView } from "@/components/costing/cost-entries-view";
import { getActiveOrg } from "@/lib/auth";
import { db } from "@/lib/db";
import { costEntries } from "@/lib/db/schema";
import type { CostEntryView } from "@/lib/inventory/types";
import { getPeriodSelection } from "@/lib/periods/selection";

// Тайлант үеийн шүүлтүүр (CLAUDE.md §4 "Системийн хэмжээний периодын
// шүүлтүүр"): URL-ийн ил `start`/`end` сонголтыг ДАРНА, байхгүй бол
// topbar-ийн сонголтын from/to. Урьд нь энэ хуудас огнооны шүүлтгүй БҮХ
// бичилтийг татдаг байсан тул topbar дээр "9-р сар" байхад 7, 8-р сарын
// бичилт хамт харагдаж байв.
type SearchParams = Promise<{ status?: string; start?: string; end?: string }>;

export default async function CostEntriesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const [{ status, start, end }, period] = await Promise.all([
    searchParams,
    getPeriodSelection(),
  ]);
  const rangeStart = start ?? period.from;
  const rangeEnd = end ?? period.to;

  // Дэлгэрэнгүй (GL мөр, дансны нэр, сегмент) нь одоо панель өөрөө
  // getCostEntryPanelData-аар татдаг тул энд зөвхөн жагсаалтын өгөгдөл.
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      gte(costEntries.date, rangeStart),
      lte(costEntries.date, rangeEnd)
    ),
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
