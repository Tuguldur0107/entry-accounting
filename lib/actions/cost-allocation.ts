"use server";

// Нэмэлт зардлын хуваарилалт — тээвэр, гааль, даатгал зэргийг бараанд
// хуваарилж, барааны Орлогын дүнд нэмнэ (docs/cost §10, §11, FR-ALLOC-*).
//
// Хуваарийн суурийг баримт бүрд хэрэглэгч сонгоно (OD-017, 0.3-д батлагдсан):
// үнийн дүнгээр / тоо хэмжээгээр / гараар. Хуваарилалт бүр `landed_cost`
// төрлийн НООРОГ өртгийн бичилт үүсгэнэ — GL-д бичих нь тусдаа алхам.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  costAllocationLines,
  costAllocations,
  costComponents,
  costEntries,
  inventoryMovements,
} from "@/lib/db/schema";
import {
  allocate,
  type AllocationBase,
  type AllocationTarget,
} from "@/lib/costing/allocation";
import { assertPeriodOpen } from "@/lib/periods/guard";

export interface AllocationTargetOption {
  movementId: string;
  documentNo: string;
  date: string;
  itemLabel: string;
  warehouseLabel: string;
  quantity: number;
  /** Тухайн орлогын одоогийн өртөг (үнийн дүнгээр хуваахад хэрэглэгдэнэ). */
  value: number;
}

export interface AllocationRow {
  id: string;
  documentNo: string;
  date: string;
  componentLabel: string;
  allocationBase: string;
  totalAmount: number;
  lineCount: number;
}

export type AllocationResultAction =
  | { ok: true; documentNo: string; lineCount: number }
  | {
      ok: false;
      code: "unauthenticated" | "validation" | "failed";
      message?: string;
    };

/**
 * Хуваарилах боломжтой орлогын хөдөлгөөнүүд — батлагдсан, бараа/агуулахтай,
 * тухайн огнооны мужид. `value` нь одоогийн үнэлэгдсэн дүн (өртөгтэй
 * бичилтүүдийн нийлбэр).
 */
export async function loadAllocationTargets(range: {
  from: string;
  to: string;
}): Promise<AllocationTargetOption[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];

  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.userId, userId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      gte(inventoryMovements.date, range.from),
      lte(inventoryMovements.date, range.to)
    ),
    with: { item: true, warehouse: true },
    orderBy: (movement, { asc }) => [asc(movement.date)],
  });
  if (movements.length === 0) return [];

  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.userId, userId),
      inArray(costEntries.status, ["draft", "posted"]),
      inArray(
        costEntries.movementId,
        movements.map((movement) => movement.id)
      )
    ),
    columns: { movementId: true, entryType: true, amount: true },
  });
  const valueByMovement = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    if (
      entry.entryType !== "receipt_capitalize" &&
      entry.entryType !== "landed_cost"
    )
      continue;
    valueByMovement.set(
      entry.movementId,
      (valueByMovement.get(entry.movementId) ?? 0) + Number(entry.amount)
    );
  }

  return movements
    .filter((movement) => movement.itemId && movement.warehouseId)
    .map((movement) => ({
      movementId: movement.id,
      documentNo: movement.documentNo,
      date: movement.date,
      itemLabel: movement.item
        ? `${movement.item.code} · ${movement.item.name}`
        : "—",
      warehouseLabel: movement.warehouse
        ? `${movement.warehouse.code} · ${movement.warehouse.name}`
        : "—",
      quantity: Math.abs(Number(movement.quantity)),
      value: valueByMovement.get(movement.id) ?? 0,
    }));
}

/** Бүртгэгдсэн хуваарилалтууд. */
export async function loadAllocations(): Promise<AllocationRow[]> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return [];

  const [rows, components] = await Promise.all([
    db.query.costAllocations.findMany({
      where: eq(costAllocations.userId, userId),
      with: { lines: true },
      orderBy: (allocation, { desc }) => [desc(allocation.date)],
    }),
    db.query.costComponents.findMany({
      where: eq(costComponents.userId, userId),
      columns: { id: true, code: true, name: true },
    }),
  ]);
  const componentLabel = new Map(
    components.map((component) => [
      component.id,
      `${component.code} · ${component.name}`,
    ])
  );

  return rows.map((row) => ({
    id: row.id,
    documentNo: row.documentNo,
    date: row.date,
    componentLabel: componentLabel.get(row.costComponentId) ?? "—",
    allocationBase: row.allocationBase,
    totalAmount: Number(row.totalAmount),
    lineCount: row.lines.length,
  }));
}

export async function createCostAllocation(data: {
  date: string;
  costComponentId: string;
  totalAmount: number;
  allocationBase: AllocationBase;
  description?: string;
  documentNo?: string;
  /** Сонгосон орлогууд + гараар бичсэн дүн. */
  targets: { movementId: string; manualAmount?: number }[];
}): Promise<AllocationResultAction> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "unauthenticated" };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    return { ok: false, code: "validation", message: "Огноо буруу байна" };

  try {
    await assertPeriodOpen(userId, data.date);
  } catch (caught) {
    return {
      ok: false,
      code: "validation",
      message: caught instanceof Error ? caught.message : "Тайлант үе хаагдсан",
    };
  }

  const component = await db.query.costComponents.findFirst({
    where: and(
      eq(costComponents.id, data.costComponentId),
      eq(costComponents.userId, userId),
      eq(costComponents.isActive, true)
    ),
  });
  if (!component)
    return {
      ok: false,
      code: "validation",
      message: "Идэвхтэй өртгийн бүрэлдэхүүн сонгоно уу",
    };

  const movementIds = data.targets.map((target) => target.movementId);
  if (movementIds.length === 0)
    return {
      ok: false,
      code: "validation",
      message: "Хуваарилах орлого сонгоно уу",
    };

  // Сонгосон орлогуудыг эзэмшил, төлөв, төрлөөр шалгана.
  const movements = await db.query.inventoryMovements.findMany({
    where: and(
      eq(inventoryMovements.userId, userId),
      eq(inventoryMovements.status, "confirmed"),
      eq(inventoryMovements.movementType, "receipt"),
      inArray(inventoryMovements.id, movementIds)
    ),
  });
  if (movements.length !== movementIds.length)
    return {
      ok: false,
      code: "validation",
      message: "Сонгосон орлогуудын нэг нь батлагдаагүй эсвэл олдсонгүй",
    };

  const options = await loadAllocationTargets({
    from: movements.reduce(
      (min, movement) => (movement.date < min ? movement.date : min),
      movements[0].date
    ),
    to: movements.reduce(
      (max, movement) => (movement.date > max ? movement.date : max),
      movements[0].date
    ),
  });
  const optionByMovement = new Map(
    options.map((option) => [option.movementId, option])
  );

  const targets: AllocationTarget[] = data.targets.map((target) => {
    const option = optionByMovement.get(target.movementId);
    return {
      movementId: target.movementId,
      quantity: option?.quantity ?? 0,
      value: option?.value ?? 0,
      manualAmount: target.manualAmount,
    };
  });

  const result = allocate({
    totalAmount: data.totalAmount,
    base: data.allocationBase,
    targets,
  });
  if (!result.ok)
    return { ok: false, code: "validation", message: result.error };

  const movementById = new Map(
    movements.map((movement) => [movement.id, movement])
  );
  const documentNo =
    data.documentNo?.trim() ||
    `ALLOC-${data.date.replaceAll("-", "")}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

  try {
    await db.transaction(async (tx) => {
      const [allocation] = await tx
        .insert(costAllocations)
        .values({
          userId,
          documentNo,
          date: data.date,
          costComponentId: component.id,
          totalAmount: String(Math.round(data.totalAmount * 100) / 100),
          allocationBase: data.allocationBase,
          description: data.description?.trim() ?? "",
          createdBy: userId,
        })
        .returning({ id: costAllocations.id });

      for (const line of result.lines) {
        const movement = movementById.get(line.movementId)!;
        // Барааны өртөгт нэмэгдэх ноорог бичилт. quantity = 0 —
        // тоо хэмжээ нэмэгдэхгүй, зөвхөн ДҮН нэмэгдэнэ (IAS 2.11).
        const [entry] = await tx
          .insert(costEntries)
          .values({
            userId,
            movementId: movement.id,
            itemId: movement.itemId,
            warehouseId: movement.warehouseId,
            periodCode: movement.date.slice(0, 7),
            costComponentId: component.id,
            entryType: "landed_cost",
            date: data.date,
            quantity: "0",
            unitCost: "0",
            amount: String(line.amount),
            valuationSource: "manual",
          })
          .returning({ id: costEntries.id });

        await tx.insert(costAllocationLines).values({
          allocationId: allocation.id,
          movementId: movement.id,
          baseValue: String(line.baseValue),
          amount: String(line.amount),
          costEntryId: entry.id,
        });
      }
    });
  } catch (caught) {
    return {
      ok: false,
      code: "failed",
      message: caught instanceof Error ? caught.message : "Хадгалж чадсангүй",
    };
  }

  revalidatePath("/costing");
  revalidatePath("/costing/allocations");
  revalidatePath("/costing/entries");
  revalidatePath("/costing/control");
  return { ok: true, documentNo, lineCount: result.lines.length };
}
