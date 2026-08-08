import { eq } from "drizzle-orm";

import {
  InventoryReportView,
  type QtyFlowRow,
} from "@/components/inventory/inventory-report-view";
import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { db } from "@/lib/db";
import { inventoryMovements } from "@/lib/db/schema";
import { movementEffects } from "@/lib/inventory/balances";
import { loadInventoryBase, toMovementRefs } from "@/lib/inventory/load-data";

type SearchParams = Promise<{ start?: string; end?: string }>;

export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { orgId } = await getActiveOrg();
  const params = await searchParams;
  const period = await getPeriodSelection();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.start ?? "")
    ? params.start!
    : period.from;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(params.end ?? "")
    ? params.end!
    : period.to;

  const [{ itemViews, warehouseViews }, movements] = await Promise.all([
    loadInventoryBase(orgId),
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
    }),
  ]);

  const refs = toMovementRefs(
    movements.filter((movement) => movement.status === "confirmed")
  );

  // Эхний үлдэгдэл (< start), тайлант үеийн орлого/зарлага (start..end).
  const opening = new Map<string, number>();
  const inQty = new Map<string, number>();
  const outQty = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, delta: number) =>
    map.set(key, Math.round(((map.get(key) ?? 0) + delta) * 10000) / 10000);

  for (const movement of refs) {
    if (movement.date > end) continue;
    for (const effect of movementEffects(movement)) {
      const key = `${effect.itemId}|${effect.warehouseId}`;
      if (movement.date < start) add(opening, key, effect.delta);
      else if (effect.delta > 0) add(inQty, key, effect.delta);
      else add(outQty, key, -effect.delta);
    }
  }

  const itemById = new Map(itemViews.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouseViews.map((w) => [w.id, w]));
  const keys = new Set([...opening.keys(), ...inQty.keys(), ...outQty.keys()]);
  const rows: QtyFlowRow[] = [];
  for (const key of keys) {
    const [itemId, warehouseId] = key.split("|");
    const item = itemById.get(itemId);
    const warehouse = warehouseById.get(warehouseId);
    if (!item || !warehouse) continue;
    const openingQty = opening.get(key) ?? 0;
    const inTotal = inQty.get(key) ?? 0;
    const outTotal = outQty.get(key) ?? 0;
    rows.push({
      key,
      itemLabel: `${item.code} · ${item.name}`,
      unit: item.unit,
      warehouseName: warehouse.name,
      opening: openingQty,
      inQty: inTotal,
      outQty: outTotal,
      closing: Math.round((openingQty + inTotal - outTotal) * 10000) / 10000,
    });
  }
  rows.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  return <InventoryReportView rows={rows} start={start} end={end} />;
}
