import { and, eq } from "drizzle-orm";

import { CostEntriesView } from "@/components/costing/cost-entries-view";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chartOfAccounts, costEntries, segmentConfigs } from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
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

  const [entries, glAccounts, segConfigs] = await Promise.all([
    db.query.costEntries.findMany({
      where: eq(costEntries.userId, userId),
      with: { movement: { with: { item: true } } },
      orderBy: (entry, { desc }) => [desc(entry.date), desc(entry.createdAt)],
    }),
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
  ]);

  const segConfigMap = new Map(segConfigs.map((c) => [c.segmentId, c]));
  const activeSegIds = SEGMENT_DEFS.filter(
    (def) => def.id === 3 || segConfigMap.get(def.id)?.isEnabled === true
  ).map((def) => def.id);

  const views: CostEntryView[] = entries.map((entry) => ({
    id: entry.id,
    movementId: entry.movementId,
    documentNo: entry.movement.documentNo,
    itemLabel: entry.movement.item
      ? `${entry.movement.item.code} · ${entry.movement.item.name}`
      : "⚠ Бараа сонгоогүй",
    unit: entry.movement.item?.unit ?? "",
    entryType: entry.entryType,
    date: entry.date,
    quantity: Number(entry.quantity),
    unitCost: Number(entry.unitCost),
    amount: Number(entry.amount),
    valuationSource: entry.valuationSource,
    status: entry.status,
    voucherId: entry.voucherId,
  }));

  return (
    <CostEntriesView
      entries={views}
      glNames={Object.fromEntries(glAccounts.map((a) => [a.number, a.name]))}
      activeSegIds={activeSegIds}
      initialStatus={status}
    />
  );
}
