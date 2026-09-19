// Хуудсуудын нийтлэг өгөгдөл ачаалагч (inv + cost).

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  costEntries,
  inventoryCategories,
  inventoryItems,
  inventoryMovements,
  warehouses,
} from "@/lib/db/schema";
import type { MovementRef, MovementType } from "@/lib/inventory/balances";
import type {
  InventoryCategoryView,
  InventoryItemView,
  InventoryMovementView,
  ItemVatMode,
  WarehouseView,
} from "@/lib/inventory/types";

const ITEM_VAT_MODES: ItemVatMode[] = ["standard", "exempt", "zero"];

/** DB-ийн vat_mode текстийг хаалттай төрөлд буулгана (гажиг утга → standard). */
export function toItemVatMode(value: string | null | undefined): ItemVatMode {
  return ITEM_VAT_MODES.includes(value as ItemVatMode)
    ? (value as ItemVatMode)
    : "standard";
}

const numberOrNull = (value: string | null) =>
  value == null ? null : Number(value);

export async function loadInventoryBase(orgId: string) {
  const [items, warehouseRows, categoryRows] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: eq(inventoryItems.organizationId, orgId),
      orderBy: (item, { asc }) => [asc(item.code)],
    }),
    db.query.warehouses.findMany({
      where: eq(warehouses.organizationId, orgId),
      orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
    }),
    db.query.inventoryCategories.findMany({
      where: eq(inventoryCategories.organizationId, orgId),
      orderBy: (category, { asc }) => [asc(category.code)],
    }),
  ]);
  const itemViews: InventoryItemView[] = items.map((item) => ({
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    isActive: item.isActive,
    salesPrice: numberOrNull(item.salesPrice),
    minSalesPrice: numberOrNull(item.minSalesPrice),
    barcode: item.barcode ?? null,
    vatMode: toItemVatMode(item.vatMode),
    revenueAccountNumber: item.revenueAccountNumber ?? null,
    categoryCode: item.categoryCode ?? null,
  }));
  const warehouseViews: WarehouseView[] = warehouseRows.map((warehouse) => ({
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    isActive: warehouse.isActive,
  }));
  const categoryViews: InventoryCategoryView[] = categoryRows.map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    isActive: category.isActive,
  }));
  return { itemViews, warehouseViews, categoryViews };
}

export async function loadMovements(orgId: string) {
  const [movements, activeEntries] = await Promise.all([
    db.query.inventoryMovements.findMany({
      where: eq(inventoryMovements.organizationId, orgId),
      with: {
        item: true,
        warehouse: true,
        toWarehouse: true,
      },
      orderBy: (movement, { desc }) => [desc(movement.date), desc(movement.createdAt)],
    }),
    db.query.costEntries.findMany({
      where: and(
        eq(costEntries.organizationId, orgId),
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
    issueTypeId: movement.issueTypeId ?? null,
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
