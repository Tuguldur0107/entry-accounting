// Хуудсуудын нийтлэг өгөгдөл ачаалагч (inv + cost).

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  costEntries,
  inventoryItems,
  inventoryMovements,
  warehouses,
} from "@/lib/db/schema";
import type { MovementRef, MovementType } from "@/lib/inventory/balances";
import type {
  InventoryItemView,
  InventoryMovementView,
  WarehouseView,
} from "@/lib/inventory/types";

export async function loadInventoryBase(userId: string) {
  const [items, warehouseRows] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: eq(inventoryItems.userId, userId),
      orderBy: (item, { asc }) => [asc(item.code)],
    }),
    db.query.warehouses.findMany({
      where: eq(warehouses.userId, userId),
      orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
    }),
  ]);
  const itemViews: InventoryItemView[] = items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    isActive: item.isActive,
  }));
  const warehouseViews: WarehouseView[] = warehouseRows.map((warehouse) => ({
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    isActive: warehouse.isActive,
  }));
  return { itemViews, warehouseViews };
}

export async function loadMovements(userId: string) {
  const [movements, activeEntries] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.userId, userId),
      with: {
        item: true,
        warehouse: true,
        toWarehouse: true,
      },
      orderBy: (movement, { desc }) => [desc(movement.date), desc(movement.createdAt)],
    }),
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.userId, userId),
        inArray(costEntries.status, ["draft", "posted"])
      ),
      columns: { movementId: true },
    }),
  ]);
  const valuedMovementIds = new Set(activeEntries.map((entry) => entry.movementId));
  const views: InventoryMovementView[] = movements.map((movement) => ({
    id: movement.id,
    documentNo: movement.documentNo,
    movementType: movement.movementType,
    date: movement.date,
    itemId: movement.itemId,
    itemLabel: movement.item
      ? `${movement.item.code} · ${movement.item.name}`
      : "⚠ Бараа сонгоогүй",
    unit: movement.item?.unit ?? "",
    warehouseId: movement.warehouseId,
    warehouseName: movement.warehouse?.name ?? "—",
    toWarehouseId: movement.toWarehouseId,
    toWarehouseName: movement.toWarehouse?.name ?? null,
    quantity: Number(movement.quantity),
    description: movement.description,
    status: movement.status,
    sourceType: movement.sourceType,
    hasCostEntry: valuedMovementIds.has(movement.id),
  }));
  return views;
}

export function toMovementRefs(
  rows: {
    id: string;
    movementType: string;
    date: string;
    // Confirmed хөдөлгөөнд null байх боломжгүй (confirm-ийн шалгалт);
    // sentinel draft-ууд энд хэзээ ч орж ирэхгүй.
    itemId: string | null;
    warehouseId: string | null;
    toWarehouseId: string | null;
    quantity: string | number;
    createdAt: Date;
  }[]
): MovementRef[] {
  return rows.map((row) => ({
    id: row.id,
    movementType: row.movementType as MovementType,
    date: row.date,
    itemId: row.itemId ?? "",
    warehouseId: row.warehouseId ?? "",
    toWarehouseId: row.toWarehouseId,
    quantity: Number(row.quantity),
    createdAt: row.createdAt.toISOString(),
  }));
}
