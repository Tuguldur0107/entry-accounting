"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { requireModuleAction } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  costEntries,
  inventoryCategories,
  inventoryCategoryLevels,
  inventoryIssueTypes,
  inventoryItems,
  inventoryMovements,
  itemPriceHistory,
  posDiscountRules,
  purchaseOrderLines,
  warehouses,
} from "@/lib/db/schema";
import {
  categoryDeleteBlocker,
  maxTreeDepth,
  planCategoryLevels,
  resolveCategoryLevels,
  validateCategoryParent,
  type CategoryNode,
} from "@/lib/inventory/category-tree";
import { assertEnabledMainAccount } from "@/lib/costing/posting-helpers";
import {
  ARAP_LINE_SOURCE_TYPE,
  capitalizeArapLineReceipts,
} from "@/lib/costing/arap-receipt-capitalize";
import type { ItemVatMode } from "@/lib/inventory/types";
import { EBARIMT_BARCODE_TYPES } from "@/lib/ebarimt/constants";
import {
  balanceKey,
  findNegativeStock,
  type MovementType,
} from "@/lib/inventory/balances";
import {
  loadQtyBalancesFast,
  loadQtyLedgerFast,
} from "@/lib/inventory/period-balances";
import {
  assertNotFuturePeriod,
  assertPeriodOpen,
  assertPeriodOpenInTx,
} from "@/lib/periods/guard";
import { logAuditEvent } from "@/lib/audit";
import { deleteAttachmentsFor } from "@/lib/attachments/cleanup";
import { actionError, type ActionResult } from "@/lib/action-result";
import { PO_SOURCE_TYPE } from "@/lib/procurement/constants";
import { POS_MOVEMENT_SOURCE_TYPE } from "@/lib/pos/constants";

/**
 * Хангамжийн хүлээн авалтаас үүссэн орлогыг бараа материалын дэлгэцээс
 * УСТГАХ/ЦУЦЛАХ хориотой: хүлээн авсан тоо, капитализаци, түр дансны
 * тэнцвэр гурвуул хүлээн авалтын баримтаар удирдагддаг (contract §9).
 */
function assertNotPoReceipt(sourceType: string) {
  if (sourceType === PO_SOURCE_TYPE)
    throw new Error(
      "Хангамжийн хүлээн авалтаас үүссэн орлого — Хангамж → Хүлээн авалт дээр буцаана уу"
    );
  // POS (docs/pos §3.3): борлуулалтын зарлага/буцаалт нь АР, касс, өртөгтэйгээ
  // нэг атом үйлдэл — зөвхөн POS буцаалтаар өөрчлөгдөнө.
  if (sourceType === POS_MOVEMENT_SOURCE_TYPE)
    throw new Error(
      "[POS_SOURCED] POS борлуулалтаас үүссэн хөдөлгөөн — Бараа материал → Борлуулалт дээр буцаана уу"
    );
}

function revalidateInventory() {
  for (const path of [
    "/inventory",
    "/inventory/movements",
    "/inventory/reports",
    "/inventory/items",
    "/inventory/categories",
    "/inventory/warehouses",
    "/costing",
    "/costing/entries",
    "/costing/reports",
  ])
    revalidatePath(path);
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

// ─── Мастер дата ─────────────────────────────────────────────────────────────

const ITEM_VAT_MODES: ItemVatMode[] = ["standard", "exempt", "zero"];

/** Улаанбаатарын өнөөдөр (YYYY-MM-DD) — үнийн түүхийн effectiveFrom. */
function todayUlaanbaatar() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" })
    .slice(0, 10);
}

/** POS-ийн сонголтот талбарууд (docs/pos §3.2) — create/update хоёулаа. */
export type InventoryItemPosFields = {
  salesPrice?: number | null;
  minSalesPrice?: number | null;
  barcode?: string | null;
  vatMode?: ItemVatMode;
  revenueAccountNumber?: string | null;
  categoryCode?: string | null;
  /** eBarimt ангилалын код (7 орон) / татварын бүтээгдэхүүний код (3 орон). */
  ebarimtClassificationCode?: string | null;
  ebarimtTaxProductCode?: string | null;
  /** Баркодын төрөл — "GS1" | "ISBN" | "UNDEFINED" (PosAPI barCodeType). */
  barcodeType?: string | null;
  // ── Дэлгэрэнгүй мэдээлэл (барааны карт) ──
  description?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  originCountry?: string | null;
};

/** Дэлгэрэнгүй текст талбарын дээд урт (тэмдэгт). */
const ITEM_DETAIL_LIMITS = {
  description: 2000,
  brand: 120,
  manufacturer: 160,
  originCountry: 80,
} as const;

const ITEM_DETAIL_LABELS: Record<keyof typeof ITEM_DETAIL_LIMITS, string> = {
  description: "Тайлбар",
  brand: "Брэнд",
  manufacturer: "Үйлдвэрлэгч",
  originCountry: "Гарал үүслийн улс",
};

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function parseOptionalPrice(
  value: number | null | undefined,
  label: string
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${label} 0-ээс багагүй тоо байна`);
  return parsed;
}

function parseClassificationCode(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const code = cleanText(value);
  if (code && !/^\d{7}$/.test(code)) throw new Error("eBarimt ангилалын код 7 оронтой тоо байна");
  return code;
}

/**
 * POS талбаруудыг шалгаад DB-д бичих утга болгоно. `undefined` = хөндөхгүй.
 * Баркод давхардал, орлогын данс, бүлэг — бүгд байгууллагын хүрээнд.
 */
async function validateItemPosFields(
  orgId: string,
  data: InventoryItemPosFields,
  options: { excludeItemId?: string; currentSalesPrice?: number | null } = {}
): Promise<{
  salesPrice?: string | null;
  minSalesPrice?: string | null;
  barcode?: string | null;
  vatMode?: ItemVatMode;
  revenueAccountNumber?: string | null;
  categoryCode?: string | null;
  ebarimtClassificationCode?: string | null;
  ebarimtTaxProductCode?: string | null;
  barcodeType?: string | null;
  description?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  originCountry?: string | null;
}> {
  const salesPrice = parseOptionalPrice(data.salesPrice, "Борлуулах үнэ");
  const minSalesPrice = parseOptionalPrice(data.minSalesPrice, "Доод үнэ");
  const effectiveSale =
    salesPrice === undefined ? options.currentSalesPrice ?? null : salesPrice;
  if (minSalesPrice != null && effectiveSale != null && minSalesPrice > effectiveSale)
    throw new Error("Доод үнэ борлуулах үнээс их байж болохгүй");

  if (data.vatMode !== undefined && !ITEM_VAT_MODES.includes(data.vatMode))
    throw new Error("НӨАТ-ийн горим standard / exempt / zero байна");

  let barcode: string | null | undefined;
  if (data.barcode !== undefined) {
    barcode = cleanText(data.barcode);
    if (barcode) {
      const conditions = [
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.barcode, barcode),
      ];
      if (options.excludeItemId)
        conditions.push(ne(inventoryItems.id, options.excludeItemId));
      const duplicate = await db.query.inventoryItems.findFirst({
        where: and(...conditions),
        columns: { id: true },
      });
      if (duplicate)
        throw new Error(`"${barcode}" баркод өөр бараанд бүртгэгдсэн байна`);
    }
  }

  let revenueAccountNumber: string | null | undefined;
  if (data.revenueAccountNumber !== undefined) {
    revenueAccountNumber = cleanText(data.revenueAccountNumber);
    if (revenueAccountNumber) {
      if (!/^\d{8}$/.test(revenueAccountNumber))
        throw new Error("Орлогын данс 8 оронтой үндсэн данс байна");
      await assertEnabledMainAccount(orgId, revenueAccountNumber);
    }
  }

  let categoryCode: string | null | undefined;
  if (data.categoryCode !== undefined) {
    categoryCode = cleanText(data.categoryCode);
    if (categoryCode) {
      const category = await db.query.inventoryCategories.findFirst({
        where: and(
          eq(inventoryCategories.organizationId, orgId),
          eq(inventoryCategories.code, categoryCode),
          eq(inventoryCategories.isActive, true)
        ),
        columns: { id: true },
      });
      if (!category)
        throw new Error(`"${categoryCode}" бүлэг идэвхтэй жагсаалтад алга`);
    }
  }

  let ebarimtClassificationCode: string | null | undefined;
  if (data.ebarimtClassificationCode !== undefined) {
    ebarimtClassificationCode = cleanText(data.ebarimtClassificationCode);
    if (ebarimtClassificationCode && !/^\d{7}$/.test(ebarimtClassificationCode))
      throw new Error("eBarimt ангилалын код 7 оронтой тоо байна");
  }
  let ebarimtTaxProductCode: string | null | undefined;
  if (data.ebarimtTaxProductCode !== undefined) {
    ebarimtTaxProductCode = cleanText(data.ebarimtTaxProductCode);
    if (ebarimtTaxProductCode && !/^\d{3}$/.test(ebarimtTaxProductCode))
      throw new Error("Татварын бүтээгдэхүүний код 3 оронтой тоо байна");
  }

  let barcodeType: string | null | undefined;
  if (data.barcodeType !== undefined) {
    barcodeType = cleanText(data.barcodeType)?.toUpperCase() ?? null;
    if (barcodeType && !(EBARIMT_BARCODE_TYPES as readonly string[]).includes(barcodeType))
      throw new Error(`Баркодын төрөл ${EBARIMT_BARCODE_TYPES.join(" / ")} байна`);
  }
  const details: Partial<Record<keyof typeof ITEM_DETAIL_LIMITS, string | null>> = {};
  for (const key of Object.keys(ITEM_DETAIL_LIMITS) as (keyof typeof ITEM_DETAIL_LIMITS)[]) {
    if (data[key] === undefined) continue;
    const value = cleanText(data[key]);
    if (value && value.length > ITEM_DETAIL_LIMITS[key])
      throw new Error(`${ITEM_DETAIL_LABELS[key]} ${ITEM_DETAIL_LIMITS[key]} тэмдэгтээс ихгүй байна`);
    details[key] = value;
  }

  return {
    ...details,
    barcodeType,
    salesPrice: salesPrice === undefined ? undefined : salesPrice == null ? null : String(salesPrice),
    minSalesPrice:
      minSalesPrice === undefined ? undefined : minSalesPrice == null ? null : String(minSalesPrice),
    barcode,
    vatMode: data.vatMode,
    revenueAccountNumber,
    categoryCode,
    ebarimtClassificationCode,
    ebarimtTaxProductCode,
  };
}

/** Борлуулах үнэ өөрчлөгдсөн бол түүхэнд мөр бичнэ (аудит, §3.2). */
async function recordPriceHistory(
  tx: DbOrTx,
  params: {
    orgId: string;
    userId: string;
    itemId: string;
    previous: string | null | undefined;
    next: string | null | undefined;
  }
) {
  if (params.next === undefined) return;
  const prev = params.previous == null ? null : Number(params.previous);
  const next = params.next == null ? null : Number(params.next);
  if (prev === next) return;
  await tx.insert(itemPriceHistory).values({
    organizationId: params.orgId,
    itemId: params.itemId,
    salesPrice: params.next ?? null,
    effectiveFrom: todayUlaanbaatar(),
    createdBy: params.userId,
  });
}

export async function createInventoryItem(
  data: {
    code: string;
    name: string;
    unit: string;
  } & InventoryItemPosFields
): Promise<ActionResult> {
  try {
    return await createInventoryItemCore(data);
  } catch (caught) {
    return actionError("createInventoryItem", caught, "Бараа үүсгэж чадсангүй");
  }
}

async function createInventoryItemCore(
  data: {
    code: string;
    name: string;
    unit: string;
  } & InventoryItemPosFields
) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const code = data.code.trim();
  const name = data.name.trim();
  const unit = data.unit.trim() || "ш";
  if (!code) throw new Error("Барааны код оруулна уу");
  if (!name) throw new Error("Барааны нэр оруулна уу");
  const duplicate = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.code, code)),
    columns: { id: true },
  });
  if (duplicate) throw new Error(`"${code}" кодтой бараа бүртгэгдсэн байна`);
  const pos = await validateItemPosFields(orgId, data);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryItems)
      .values({
        userId,
        organizationId: orgId,
        code,
        name,
        unit,
        salesPrice: pos.salesPrice ?? null,
        minSalesPrice: pos.minSalesPrice ?? null,
        barcode: pos.barcode ?? null,
        vatMode: pos.vatMode ?? "standard",
        revenueAccountNumber: pos.revenueAccountNumber ?? null,
        categoryCode: pos.categoryCode ?? null,
        ebarimtClassificationCode: pos.ebarimtClassificationCode ?? null,
        ebarimtTaxProductCode: pos.ebarimtTaxProductCode ?? null,
        barcodeType: pos.barcodeType ?? null,
        description: pos.description ?? null,
        brand: pos.brand ?? null,
        manufacturer: pos.manufacturer ?? null,
        originCountry: pos.originCountry ?? null,
      })
      .returning({ id: inventoryItems.id });
    await recordPriceHistory(tx, {
      orgId,
      userId,
      itemId: row.id,
      previous: null,
      next: pos.salesPrice ?? null,
    });
  });
  revalidateInventory();
  return {};
}

export async function updateInventoryItem(
  id: string,
  data: { name: string; unit: string } & InventoryItemPosFields
): Promise<ActionResult> {
  try {
    return await updateInventoryItemCore(id, data);
  } catch (caught) {
    return actionError("updateInventoryItem", caught, "Бараа шинэчлэгдсэнгүй");
  }
}

async function updateInventoryItemCore(
  id: string,
  data: { name: string; unit: string } & InventoryItemPosFields
) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const name = data.name.trim();
  if (!name) throw new Error("Барааны нэр оруулна уу");
  const existing = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)),
    columns: { id: true, salesPrice: true, minSalesPrice: true },
  });
  if (!existing) throw new Error("Бараа олдсонгүй");
  const pos = await validateItemPosFields(orgId, data, {
    excludeItemId: id,
    currentSalesPrice: existing.salesPrice == null ? null : Number(existing.salesPrice),
  });
  // Үнэ шинээр өгөгдөж, доод үнэ хөндөгдөөгүй бол хуучин доод үнэтэй тулгана.
  if (
    pos.salesPrice != null &&
    pos.minSalesPrice === undefined &&
    existing.minSalesPrice != null &&
    Number(existing.minSalesPrice) > Number(pos.salesPrice)
  )
    throw new Error("Доод үнэ борлуулах үнээс их байж болохгүй");

  await db.transaction(async (tx) => {
    await tx
      .update(inventoryItems)
      .set({
        name,
        unit: data.unit.trim() || "ш",
        ...(pos.salesPrice !== undefined ? { salesPrice: pos.salesPrice } : {}),
        ...(pos.minSalesPrice !== undefined ? { minSalesPrice: pos.minSalesPrice } : {}),
        ...(pos.barcode !== undefined ? { barcode: pos.barcode } : {}),
        ...(pos.vatMode !== undefined ? { vatMode: pos.vatMode } : {}),
        ...(pos.revenueAccountNumber !== undefined
          ? { revenueAccountNumber: pos.revenueAccountNumber }
          : {}),
        ...(pos.categoryCode !== undefined ? { categoryCode: pos.categoryCode } : {}),
        ...(pos.ebarimtClassificationCode !== undefined
          ? { ebarimtClassificationCode: pos.ebarimtClassificationCode }
          : {}),
        ...(pos.ebarimtTaxProductCode !== undefined
          ? { ebarimtTaxProductCode: pos.ebarimtTaxProductCode }
          : {}),
        ...(pos.barcodeType !== undefined ? { barcodeType: pos.barcodeType } : {}),
        ...(pos.description !== undefined ? { description: pos.description } : {}),
        ...(pos.brand !== undefined ? { brand: pos.brand } : {}),
        ...(pos.manufacturer !== undefined ? { manufacturer: pos.manufacturer } : {}),
        ...(pos.originCountry !== undefined ? { originCountry: pos.originCountry } : {}),
      })
      .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)));
    await recordPriceHistory(tx, {
      orgId,
      userId,
      itemId: id,
      previous: existing.salesPrice,
      next: pos.salesPrice,
    });
  });
  revalidateInventory();
  return {};
}

/** Барааны борлуулах үнийн түүх — шинэ нь эхэнд. */
export async function listItemPriceHistory(
  itemId: string
): Promise<{ salesPrice: number | null; effectiveFrom: string; createdAt: string }[]> {
  const { orgId } = await requireModuleAction("inv", "read");
  const rows = await db.query.itemPriceHistory.findMany({
    where: and(
      eq(itemPriceHistory.organizationId, orgId),
      eq(itemPriceHistory.itemId, itemId)
    ),
    orderBy: [desc(itemPriceHistory.createdAt)],
  });
  return rows.map((row) => ({
    salesPrice: row.salesPrice == null ? null : Number(row.salesPrice),
    effectiveFrom: row.effectiveFrom,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function toggleInventoryItem(id: string, isActive: boolean) {
  const { orgId } = await requireModuleAction("inv", "write");
  await db
    .update(inventoryItems)
    .set({ isActive })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)));
  revalidateInventory();
}

/**
 * Барааг устгана — ЗӨВХӨН түүхгүй бараа (хөдөлгөөн, АР/АП мөр, PO мөр,
 * өртгийн бичилтгүй). Түүхтэй барааг идэвхгүй болгоно (toggleInventoryItem) —
 * delete_counterparty-тэй ИЖИЛ дүрэм. Cascade-аар зөвхөн тохиргоо
 * (costing_item_settings) устана; үлдэгдлийн snapshot/өртгийн үр дүн нь
 * хөдөлгөөнгүйгээр үүсэх боломжгүй тул шалгалт хамгаална.
 */
export async function deleteInventoryItem(
  id: string
): Promise<ActionResult<{ code: string; name: string }>> {
  try {
    return await deleteInventoryItemCore(id);
  } catch (caught) {
    return actionError("deleteInventoryItem", caught, "Бараа устгагдсангүй");
  }
}

async function deleteInventoryItemCore(id: string) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const item = await db.query.inventoryItems.findFirst({
    where: and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)),
    columns: { id: true, code: true, name: true },
  });
  if (!item) throw new Error("Бараа олдсонгүй");

  const countOf = async (query: Promise<{ count: number }[]>) =>
    Number((await query)[0]?.count ?? 0);
  const [movements, arapLines, poLines, costs] = await Promise.all([
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.itemId, id))
    ),
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(arApDocumentLines)
        .where(eq(arApDocumentLines.itemId, id))
    ),
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.itemId, id))
    ),
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(costEntries)
        .where(eq(costEntries.itemId, id))
    ),
  ]);
  const usage = [
    movements > 0 ? `${movements} хөдөлгөөн` : null,
    arapLines > 0 ? `${arapLines} АР/АП мөр` : null,
    poLines > 0 ? `${poLines} захиалгын мөр` : null,
    costs > 0 ? `${costs} өртгийн бичилт` : null,
  ].filter(Boolean);
  if (usage.length > 0)
    throw new Error(
      `${item.code} — ${usage.join(", ")}-тэй тул устгах боломжгүй. Түүхтэй барааг идэвхгүй болгоно уу.`
    );

  await db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.organizationId, orgId)));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "inventory",
    entityId: id,
    summary: `Бараа устгагдав — ${item.code} · ${item.name}`,
  });
  revalidateInventory();
  return { code: item.code, name: item.name };
}

export async function createWarehouse(data: { code: string; name: string }): Promise<ActionResult> {
  try {
    return await createWarehouseCore(data);
  } catch (caught) {
    return actionError("createWarehouse", caught, "Агуулах үүсгэж чадсангүй");
  }
}

async function createWarehouseCore(data: { code: string; name: string }) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) throw new Error("Агуулахын код оруулна уу");
  if (!name) throw new Error("Агуулахын нэр оруулна уу");
  const duplicate = await db.query.warehouses.findFirst({
    where: and(eq(warehouses.organizationId, orgId), eq(warehouses.code, code)),
    columns: { id: true },
  });
  if (duplicate) throw new Error(`"${code}" кодтой агуулах бүртгэгдсэн байна`);
  await db.insert(warehouses).values({ userId, organizationId: orgId, code, name });
  revalidateInventory();
  return {};
}

export async function updateWarehouse(id: string, data: { name: string }): Promise<ActionResult> {
  try {
    const { orgId } = await requireModuleAction("inv", "write");
    const name = data.name.trim();
    if (!name) throw new Error("Агуулахын нэр оруулна уу");
    const updated = await db
      .update(warehouses)
      .set({ name })
      .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, orgId)))
      .returning({ id: warehouses.id });
    if (updated.length === 0) throw new Error("Агуулах олдсонгүй");
    revalidateInventory();
    return {};
  } catch (caught) {
    return actionError("updateWarehouse", caught, "Агуулах шинэчлэгдсэнгүй");
  }
}

export async function toggleWarehouse(id: string, isActive: boolean) {
  const { orgId } = await requireModuleAction("inv", "write");
  await db
    .update(warehouses)
    .set({ isActive })
    .where(and(eq(warehouses.id, id), eq(warehouses.organizationId, orgId)));
  revalidateInventory();
}

// ── Барааны АНГИЛАЛ — олон түвшинтэй мод (lib/inventory/category-tree.ts) ─────
// POS: хөнгөлөлтийн дүрэм, шүүлт, тайлан — удамшлаар; eBarimt код өвөг рүү.

type InventoryCategoryInput = {
  code: string;
  name: string;
  /** Эцэг ангилал (id) — null/хоосон бол эхний түвшин. */
  parentId?: string | null;
  ebarimtClassificationCode?: string | null;
};

/** Байгууллагын бүх ангилал (мод шалгахад) + түвшний нэрс. */
async function loadCategoryContext(orgId: string) {
  const [rows, levelRows] = await Promise.all([
    db.query.inventoryCategories.findMany({
      where: eq(inventoryCategories.organizationId, orgId),
      columns: { id: true, code: true, name: true, parentId: true, isActive: true },
    }),
    db.query.inventoryCategoryLevels.findMany({
      where: eq(inventoryCategoryLevels.organizationId, orgId),
      columns: { depth: true, name: true },
    }),
  ]);
  const nodes: CategoryNode[] = rows.map((row) => ({ ...row, parentId: row.parentId ?? null }));
  return { nodes, levels: resolveCategoryLevels(levelRows) };
}

function cleanParentId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createInventoryCategory(
  data: InventoryCategoryInput
): Promise<ActionResult> {
  try {
    return await createInventoryCategoryCore(data);
  } catch (caught) {
    return actionError("createInventoryCategory", caught, "Ангилал үүсгэж чадсангүй");
  }
}

async function createInventoryCategoryCore(data: InventoryCategoryInput) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const code = data.code.trim();
  const name = data.name.trim();
  if (!code) throw new Error("Ангиллын код оруулна уу");
  if (!name) throw new Error("Ангиллын нэр оруулна уу");
  const ebarimtClassificationCode = parseClassificationCode(data.ebarimtClassificationCode) ?? null;
  const parentId = cleanParentId(data.parentId) ?? null;
  const { nodes, levels } = await loadCategoryContext(orgId);
  if (nodes.some((node) => node.code === code))
    throw new Error(`"${code}" кодтой ангилал бүртгэгдсэн байна`);
  const treeError = validateCategoryParent({ parentId, nodes, levelCount: levels.length });
  if (treeError) throw new Error(treeError);
  const [row] = await db
    .insert(inventoryCategories)
    .values({ userId, organizationId: orgId, code, name, parentId, ebarimtClassificationCode })
    .returning({ id: inventoryCategories.id });
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "create",
    entityType: "inventory",
    entityId: row.id,
    summary: `Барааны ангилал нэмэгдэв — ${code} · ${name}`,
  });
  revalidateInventory();
  return {};
}

type InventoryCategoryUpdateInput = {
  name: string;
  /** undefined = хөндөхгүй, null = эхний түвшин рүү. */
  parentId?: string | null;
  ebarimtClassificationCode?: string | null;
};

export async function updateInventoryCategory(
  id: string,
  data: InventoryCategoryUpdateInput
): Promise<ActionResult> {
  try {
    return await updateInventoryCategoryCore(id, data);
  } catch (caught) {
    return actionError("updateInventoryCategory", caught, "Ангилал шинэчлэгдсэнгүй");
  }
}

async function updateInventoryCategoryCore(id: string, data: InventoryCategoryUpdateInput) {
  const { orgId } = await requireModuleAction("inv", "write");
  const name = data.name.trim();
  if (!name) throw new Error("Ангиллын нэр оруулна уу");
  const ebarimtClassificationCode = parseClassificationCode(data.ebarimtClassificationCode);
  const parentId = cleanParentId(data.parentId);
  const { nodes, levels } = await loadCategoryContext(orgId);
  const current = nodes.find((node) => node.id === id);
  if (!current) throw new Error("Ангилал олдсонгүй");
  if (parentId !== undefined && parentId !== current.parentId) {
    const treeError = validateCategoryParent({ id, parentId, nodes, levelCount: levels.length });
    if (treeError) throw new Error(treeError);
  }
  await db
    .update(inventoryCategories)
    .set({
      name,
      ...(parentId !== undefined ? { parentId } : {}),
      ...(ebarimtClassificationCode !== undefined ? { ebarimtClassificationCode } : {}),
    })
    .where(
      and(eq(inventoryCategories.id, id), eq(inventoryCategories.organizationId, orgId))
    );
  revalidateInventory();
  return {};
}

export async function toggleInventoryCategory(id: string, isActive: boolean): Promise<ActionResult> {
  try {
    return await toggleInventoryCategoryCore(id, isActive);
  } catch (caught) {
    return actionError("toggleInventoryCategory", caught, "Төлөв солигдсонгүй");
  }
}

async function toggleInventoryCategoryCore(id: string, isActive: boolean) {
  const { orgId } = await requireModuleAction("inv", "write");
  await db
    .update(inventoryCategories)
    .set({ isActive })
    .where(
      and(eq(inventoryCategories.id, id), eq(inventoryCategories.organizationId, orgId))
    );
  revalidateInventory();
  return {};
}

/**
 * Ангилал устгах — ЗӨВХӨН дэд ангилал, бараа, хөнгөлөлтийн дүрэм холбоогүй
 * үед (categoryDeleteBlocker). Холбоотойг идэвхгүй болгоно.
 */
export async function deleteInventoryCategory(id: string): Promise<ActionResult> {
  try {
    return await deleteInventoryCategoryCore(id);
  } catch (caught) {
    return actionError("deleteInventoryCategory", caught, "Ангилал устгагдсангүй");
  }
}

async function deleteInventoryCategoryCore(id: string) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const category = await db.query.inventoryCategories.findFirst({
    where: and(eq(inventoryCategories.id, id), eq(inventoryCategories.organizationId, orgId)),
    columns: { id: true, code: true, name: true },
  });
  if (!category) throw new Error("Ангилал олдсонгүй");
  const countOf = async (query: Promise<{ count: number }[]>) =>
    Number((await query)[0]?.count ?? 0);
  const [childCount, itemCount, ruleCount] = await Promise.all([
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryCategories)
        .where(
          and(eq(inventoryCategories.organizationId, orgId), eq(inventoryCategories.parentId, id))
        )
    ),
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.organizationId, orgId),
            eq(inventoryItems.categoryCode, category.code)
          )
        )
    ),
    countOf(
      db
        .select({ count: sql<number>`count(*)` })
        .from(posDiscountRules)
        .where(
          and(
            eq(posDiscountRules.organizationId, orgId),
            eq(posDiscountRules.scope, "category"),
            eq(posDiscountRules.scopeRef, category.code)
          )
        )
    ),
  ]);
  const blocker = categoryDeleteBlocker({ childCount, itemCount, ruleCount });
  if (blocker) throw new Error(blocker);
  await db
    .delete(inventoryCategories)
    .where(and(eq(inventoryCategories.id, id), eq(inventoryCategories.organizationId, orgId)));
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "inventory",
    entityId: id,
    summary: `Барааны ангилал устгагдав — ${category.code} · ${category.name}`,
  });
  revalidateInventory();
  return {};
}

/**
 * Ангиллын ТҮВШНИЙ нэрсийг хадгална (дээрээс доош). Хамгийн багадаа 1;
 * модонд ашиглагдаж буй гүнээс доош хасахгүй (planCategoryLevels).
 */
export async function saveInventoryCategoryLevels(names: string[]): Promise<ActionResult> {
  try {
    return await saveInventoryCategoryLevelsCore(names);
  } catch (caught) {
    return actionError("saveInventoryCategoryLevels", caught, "Түвшин хадгалагдсангүй");
  }
}

async function saveInventoryCategoryLevelsCore(names: string[]) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  if (!Array.isArray(names)) throw new Error("Түвшний жагсаалт буруу");
  const { nodes } = await loadCategoryContext(orgId);
  const plan = planCategoryLevels(names, maxTreeDepth(nodes));
  if ("error" in plan) throw new Error(plan.error);
  await db.transaction(async (tx) => {
    await tx
      .delete(inventoryCategoryLevels)
      .where(eq(inventoryCategoryLevels.organizationId, orgId));
    await tx.insert(inventoryCategoryLevels).values(
      plan.names.map((name, index) => ({ organizationId: orgId, depth: index + 1, name }))
    );
  });
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "update",
    entityType: "inventory",
    entityId: orgId,
    summary: `Барааны ангиллын түвшин: ${plan.names.join(" › ")}`,
  });
  revalidateInventory();
  return {};
}

// ─── Хөдөлгөөн (зөвхөн тоо хэмжээ) ───────────────────────────────────────────

const MOVEMENT_TYPES: MovementType[] = [
  "receipt",
  "issue",
  "transfer",
  "adjustment",
  "return_in",
  "return_out",
];

// Үлдэгдлийн replay нь хаагдсан үеийн snapshot-оос эхэлнэ
// (lib/inventory/period-balances.ts) — бүх түүхийг JS-д ачаалахгүй. Тиймээс
// хаагдсан период руу батлах/цуцлах/устгах ХОРИОТОЙ (assertPeriodOpenInTx):
// snapshot хуучирдаггүй, бусад дэд дэвтэртэй ижил дүрэм.

// ── Хөдөлгөөний мутацууд ─────────────────────────────────────────────────────
// *Core функцүүд алдааг ШИДДЭГ (транзакц rollback, дотоод дуудлагад хэрэгтэй);
// гадаад wrapper-ууд нь { error } УТГААР буцаана — Next.js production дээр
// шидсэн алдааны мессежийг нуудаг (React #441) тул client компонент зөвхөн
// wrapper-ыг дуудна. Server-талын дуудагч unwrapAction-аар шидэлтээ сэргээнэ.

async function createInventoryMovementCore(data: {
  movementType: MovementType;
  date: string;
  itemId: string;
  warehouseId: string;
  toWarehouseId?: string;
  quantity: number;
  description?: string;
  documentNo?: string;
  /** Зарлагын төрөл — өртгийн дебет чиглэлийг шийднэ (FR-ISSUE-001). */
  issueTypeId?: string;
  confirmNow?: boolean;
}) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  if (!MOVEMENT_TYPES.includes(data.movementType))
    throw new Error("Хөдөлгөөний төрөл буруу байна");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");

  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity === 0)
    throw new Error("Тоо хэмжээ 0 байж болохгүй");
  if (data.movementType !== "adjustment" && quantity <= 0)
    throw new Error("Тоо хэмжээ 0-ээс их байна");

  const [item, warehouse, toWarehouse] = await Promise.all([
    db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, data.itemId),
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.isActive, true)
      ),
    }),
    db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.id, data.warehouseId),
        eq(warehouses.organizationId, orgId),
        eq(warehouses.isActive, true)
      ),
    }),
    data.toWarehouseId
      ? db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, data.toWarehouseId),
            eq(warehouses.organizationId, orgId),
            eq(warehouses.isActive, true)
          ),
        })
      : Promise.resolve(null),
  ]);
  if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
  if (data.movementType === "transfer") {
    if (!toWarehouse) throw new Error("Хүлээн авах агуулах сонгоно уу");
    if (data.toWarehouseId === data.warehouseId)
      throw new Error("Шилжүүлгийн агуулахууд ижил байж болохгүй");
  }

  const manualNo = cleanText(data.documentNo);
  if (manualNo && manualNo.length > 40)
    throw new Error("Баримтын дугаар 40 тэмдэгтээс хэтрэхгүй");
  if (manualNo) {
    const duplicate = await db.query.inventoryMovements.findFirst({
      where: and(
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.documentNo, manualNo)
      ),
      columns: { id: true },
    });
    if (duplicate)
      throw new Error(`"${manualNo}" дугаартай хөдөлгөөн бүртгэгдсэн байна`);
  }
  const documentNo =
    manualNo ??
    `INV-${data.date.replaceAll("-", "")}-${crypto
      .randomUUID()
      .slice(0, 6)
      .toUpperCase()}`;

  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      userId,
      organizationId: orgId,
      documentNo,
      movementType: data.movementType,
      date: data.date,
      itemId: data.itemId,
      warehouseId: data.warehouseId,
      toWarehouseId: data.movementType === "transfer" ? data.toWarehouseId : null,
      quantity: String(quantity),
      description: data.description?.trim() ?? "",
      issueTypeId: await resolveIssueTypeId(
        orgId,
        data.movementType,
        data.issueTypeId
      ),
    })
    .returning({ id: inventoryMovements.id });

  if (data.confirmNow) {
    try {
      await confirmInventoryMovementCore(movement.id);
    } catch (caught) {
      // «Үүсгээд шууд батлах» нь НЭГ үйлдэл: батлалт унавал (үлдэгдэл хасах
      // г.м.) ноорог ҮЛДЭЭХГҮЙ — эс бөгөөс давтах бүрд нууц ноорог нэмэгдэж
      // сар хаалтыг «ноорог үлдсэн» гэж блоклодог байв (ENT-036).
      await db
        .delete(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.id, movement.id),
            eq(inventoryMovements.organizationId, orgId),
            eq(inventoryMovements.status, "draft")
          )
        );
      throw caught;
    }
  } else revalidateInventory();
  return { id: movement.id };
}

export async function createInventoryMovement(
  data: Parameters<typeof createInventoryMovementCore>[0]
): Promise<ActionResult<{ id: string }>> {
  try {
    return await createInventoryMovementCore(data);
  } catch (caught) {
    return actionError(
      "createInventoryMovement",
      caught,
      "Хөдөлгөөн хадгалагдсангүй"
    );
  }
}


/**
 * Зарлагын төрлийг шалгана. Зөвхөн ЗАРЛАГЫН чиглэлийн хөдөлгөөнд утгатай
 * (FR-ISSUE-001); бусад төрөлд null болгоно. Идэвхтэй байх ёстой.
 */
async function resolveIssueTypeId(
  orgId: string,
  movementType: MovementType,
  issueTypeId: string | undefined
): Promise<string | null> {
  const bearsIssueCost =
    movementType === "issue" || movementType === "return_out";
  if (!bearsIssueCost) return null;
  if (!issueTypeId) return null;
  const type = await db.query.inventoryIssueTypes.findFirst({
    where: and(
      eq(inventoryIssueTypes.id, issueTypeId),
      eq(inventoryIssueTypes.organizationId, orgId),
      eq(inventoryIssueTypes.isActive, true)
    ),
    columns: { id: true },
  });
  if (!type) throw new Error("Идэвхтэй зарлагын төрөл олдсонгүй");
  return type.id;
}

// Ноорог хөдөлгөөнийг засах — sentinel (GL/касс) draft-ыг бөглөх гол зам.
async function updateInventoryMovementCore(
  id: string,
  data: {
    movementType: MovementType;
    date: string;
    itemId: string;
    warehouseId: string;
    toWarehouseId?: string;
    quantity: number;
    description?: string;
    issueTypeId?: string;
  }
) {
  const { orgId } = await requireModuleAction("inv", "write");
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.organizationId, orgId)
    ),
    columns: { status: true },
  });
  if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
  if (movement.status !== "draft")
    throw new Error("Зөвхөн ноорог хөдөлгөөнийг засна");
  if (!MOVEMENT_TYPES.includes(data.movementType))
    throw new Error("Хөдөлгөөний төрөл буруу байна");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  const quantity = Number(data.quantity);
  if (!Number.isFinite(quantity) || quantity === 0)
    throw new Error("Тоо хэмжээ 0 байж болохгүй");
  if (data.movementType !== "adjustment" && quantity <= 0)
    throw new Error("Тоо хэмжээ 0-ээс их байна");

  const [item, warehouse, toWarehouse] = await Promise.all([
    db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, data.itemId),
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.isActive, true)
      ),
    }),
    db.query.warehouses.findFirst({
      where: and(
        eq(warehouses.id, data.warehouseId),
        eq(warehouses.organizationId, orgId),
        eq(warehouses.isActive, true)
      ),
    }),
    data.toWarehouseId
      ? db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, data.toWarehouseId),
            eq(warehouses.organizationId, orgId),
            eq(warehouses.isActive, true)
          ),
        })
      : Promise.resolve(null),
  ]);
  if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
  if (data.movementType === "transfer") {
    if (!toWarehouse) throw new Error("Хүлээн авах агуулах сонгоно уу");
    if (data.toWarehouseId === data.warehouseId)
      throw new Error("Шилжүүлгийн агуулахууд ижил байж болохгүй");
  }

  await db
    .update(inventoryMovements)
    .set({
      movementType: data.movementType,
      date: data.date,
      itemId: data.itemId,
      warehouseId: data.warehouseId,
      toWarehouseId: data.movementType === "transfer" ? data.toWarehouseId : null,
      quantity: String(quantity),
      description: data.description?.trim() ?? "",
      issueTypeId: await resolveIssueTypeId(
        orgId,
        data.movementType,
        data.issueTypeId
      ),
    })
    .where(
      and(
        eq(inventoryMovements.id, id),
        eq(inventoryMovements.organizationId, orgId),
        eq(inventoryMovements.status, "draft")
      )
    );
  revalidateInventory();
}

export async function updateInventoryMovement(
  id: string,
  data: Parameters<typeof updateInventoryMovementCore>[1]
): Promise<ActionResult> {
  try {
    await updateInventoryMovementCore(id, data);
    return {};
  } catch (caught) {
    return actionError(
      "updateInventoryMovement",
      caught,
      "Хөдөлгөөн засварлагдсангүй"
    );
  }
}

async function confirmInventoryMovementCore(id: string) {
  const { orgId, userId } = await requireModuleAction("inv", "post");

  // Шалгалт + claim нэг транзакцад, хэрэглэгч бүрийн advisory lock дор —
  // хоёр ӨӨР ноорогийг зэрэг батлахад хоёулаа шалгалтыг давж үлдэгдлийг
  // хасах болгох race-ээс сэргийлнэ.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);

    const movement = await tx.query.inventoryMovements.findFirst({
      where: and(
        eq(inventoryMovements.id, id),
        eq(inventoryMovements.organizationId, orgId)
      ),
    });
    if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
    if (movement.status !== "draft")
      throw new Error("Зөвхөн ноорог хөдөлгөөнийг батална");
    // GL/кассаас үүссэн sentinel: бараа, агуулах, тоо бөглөгдөөгүй бол
    // батлахгүй — засварлаад дахин оролдоно.
    if (!movement.itemId || !movement.warehouseId)
      throw new Error("Бараа, агуулах сонгоогүй байна — засаад батална уу");
    const movementQty = Number(movement.quantity);
    if (!Number.isFinite(movementQty) || movementQty === 0)
      throw new Error("Тоо хэмжээ бөглөөгүй байна — засаад батална уу");
    if (movement.movementType !== "adjustment" && movementQty <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");

    await assertPeriodOpenInTx(tx, orgId, movement.date);
    assertNotFuturePeriod(movement.date);

    // Хасах үлдэгдлийн шалгалт: он цагийн бүх цэг дээр ≥ 0 (энэ хөдөлгөөнийг
    // оруулаад, өмнөх огноогоор бичихэд дараагийн үлдэгдлүүд ч эвдрэхгүй).
    // Replay нь хаагдсан үеийн snapshot-оос — хаагдсан үе дотор өөрчлөлт байхгүй.
    const ledger = await loadQtyLedgerFast(orgId, undefined, tx);
    const violation = findNegativeStock(
      ledger.movements,
      {
        id: movement.id,
        movementType: movement.movementType as MovementType,
        date: movement.date,
        itemId: movement.itemId,
        warehouseId: movement.warehouseId,
        toWarehouseId: movement.toWarehouseId,
        quantity: movementQty,
        createdAt: movement.createdAt.toISOString(),
      },
      ledger.opening
    );
    if (violation)
      throw new Error(
        `Үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter}) — батлах боломжгүй`
      );

    const [claimed] = await tx
      .update(inventoryMovements)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(inventoryMovements.id, id),
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "draft")
        )
      )
      .returning({ id: inventoryMovements.id });
    if (!claimed) throw new Error("Хөдөлгөөний төлөв өөрчлөгдсөн байна");
    // PO-гүй АП нэхэмжлэхийн орлого — нэхэмжлэхийн мөрийн дүнгээр
    // капитализацийн НООРОГ (ENT-018); гараар өгсөн үнэ байвал хөндөхгүй.
    if (movement.movementType === "receipt" && movement.sourceType === ARAP_LINE_SOURCE_TYPE)
      await capitalizeArapLineReceipts(tx, orgId, userId, [id]);
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "confirm",
        entityType: "inventory",
        entityId: id,
        summary: `Бараа хөдөлгөөн батлагдав — ${movement.documentNo}, ${movement.date}, тоо ${movementQty}`,
      },
      tx
    );
  });
  revalidateInventory();
}

export async function confirmInventoryMovement(
  id: string
): Promise<ActionResult> {
  try {
    await confirmInventoryMovementCore(id);
    return {};
  } catch (caught) {
    return actionError(
      "confirmInventoryMovement",
      caught,
      "Хөдөлгөөн батлагдсангүй"
    );
  }
}

// Олноор батлах — алдаатай нь алгасагдаж тайлан буцна.
export async function confirmInventoryMovements(ids: string[]): Promise<ActionResult<Awaited<ReturnType<typeof confirmInventoryMovementsCore>>>> {
  try {
    return await confirmInventoryMovementsCore(ids);
  } catch (caught) {
    return actionError("confirmInventoryMovements", caught, "Хөдөлгөөн батлагдсангүй");
  }
}

async function confirmInventoryMovementsCore(ids: string[]) {
  const failures: { id: string; error: string }[] = [];
  let confirmed = 0;
  for (const id of ids) {
    try {
      await confirmInventoryMovementCore(id);
      confirmed += 1;
    } catch (caught) {
      failures.push({
        id,
        error: actionError("confirmInventoryMovements", caught, "Батлагдсангүй")
          .error,
      });
    }
  }
  return { confirmed, failures };
}

/**
 * Хөдөлгөөн устгах. Ноорог/цуцлагдсан — шууд. БАТАЛГААЖСАН хөдөлгөөнийг
 * мөн устгаж болно — цуцлахтай ижил хамгаалалттай: идэвхтэй өртгийн
 * бичилттэй бол блок (эхлээд өртгийг буцаана), устгаснаар аль нэг
 * бараа-агуулахын үлдэгдэл хасах болохоор бол блок.
 */
async function deleteInventoryMovementCore(id: string) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.organizationId, orgId)
    ),
    columns: { status: true, documentNo: true, date: true, sourceType: true },
  });
  if (!movement) return;
  assertNotPoReceipt(movement.sourceType);
  if (movement.status !== "draft")
    await requireModuleAction("inv", "post");

  await db.transaction(async (tx) => {
    if (movement.status === "confirmed") {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);

      const activeEntry = await tx.query.costEntries.findFirst({
        where: and(
          eq(costEntries.organizationId, orgId),
          eq(costEntries.movementId, id),
          inArray(costEntries.status, ["draft", "posted"])
        ),
        columns: { id: true },
      });
      if (activeEntry)
        throw new Error(
          "Энэ хөдөлгөөн үнэлэгдсэн байна — эхлээд өртгийн бичилтийг нь буцааж/устгана уу"
        );

      await assertPeriodOpenInTx(tx, orgId, movement.date);

      // Устгаснаар бусад баталсан хөдөлгөөний үлдэгдэл эвдрэхгүй байх ёстой.
      const ledger = await loadQtyLedgerFast(orgId, undefined, tx);
      const violation = findNegativeStock(
        ledger.movements.filter((ref) => ref.id !== id),
        null,
        ledger.opening
      );
      if (violation)
        throw new Error(
          `Устгавал үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter})`
        );
    }

    // Буцаагдсан өртгийн бичилтийн лавлагааг салгана (FK restrict).
    await tx
      .update(costEntries)
      .set({ movementId: null })
      .where(
        and(eq(costEntries.organizationId, orgId), eq(costEntries.movementId, id))
      );

    await tx
      .delete(inventoryMovements)
      .where(
        and(eq(inventoryMovements.id, id), eq(inventoryMovements.organizationId, orgId))
      );
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "delete",
        entityType: "inventory",
        entityId: id,
        summary: `Бараа хөдөлгөөн устгагдав — ${movement.documentNo}, ${movement.date} (өмнөх төлөв: ${movement.status})`,
      },
      tx
    );
  });
  // Хавсралт FK-гүй тул хөдөлгөөнийхийг өөрсдөө цэвэрлэнэ.
  await deleteAttachmentsFor(orgId, "inventory", id);
  revalidateInventory();
}

export async function deleteInventoryMovement(
  id: string
): Promise<ActionResult> {
  try {
    await deleteInventoryMovementCore(id);
    return {};
  } catch (caught) {
    return actionError(
      "deleteInventoryMovement",
      caught,
      "Хөдөлгөөн устгагдсангүй"
    );
  }
}

// Баталсан хөдөлгөөнийг цуцлах — зөвхөн идэвхтэй cost entry-гүй үед
// (үнэлэгдсэн бол эхлээд costing талд буцаалт хийнэ — уялдааны гэрээ).
async function cancelInventoryMovementCore(id: string) {
  const { orgId, userId } = await requireModuleAction("inv", "post");
  const movement = await db.query.inventoryMovements.findFirst({
    where: and(
      eq(inventoryMovements.id, id),
      eq(inventoryMovements.organizationId, orgId)
    ),
  });
  if (!movement) throw new Error("Хөдөлгөөн олдсонгүй");
  assertNotPoReceipt(movement.sourceType);
  if (movement.status !== "confirmed")
    throw new Error("Зөвхөн баталсан хөдөлгөөнийг цуцална");

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);

    const activeEntry = await tx.query.costEntries.findFirst({
      where: and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.movementId, id),
        inArray(costEntries.status, ["draft", "posted"])
      ),
      columns: { id: true, status: true },
    });
    if (activeEntry)
      throw new Error(
        "Энэ хөдөлгөөн үнэлэгдсэн байна — эхлээд өртгийн бичилтийг нь буцааж/устгана уу"
      );

    await assertPeriodOpenInTx(tx, orgId, movement.date);

    // Цуцлахад бусад баталсан хөдөлгөөний үлдэгдэл эвдрэхгүй байх ёстой
    // (ж: орлогыг цуцлахад түүнээс хойшхи зарлага хасах болж болзошгүй).
    const ledger = await loadQtyLedgerFast(orgId, undefined, tx);
    const violation = findNegativeStock(
      ledger.movements.filter((ref) => ref.id !== id),
      null,
      ledger.opening
    );
    if (violation)
      throw new Error(
        `Цуцалбал үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter})`
      );

    const [claimed] = await tx
      .update(inventoryMovements)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(inventoryMovements.id, id),
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "confirmed")
        )
      )
      .returning({ id: inventoryMovements.id });
    if (!claimed) throw new Error("Хөдөлгөөний төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "cancel",
        entityType: "inventory",
        entityId: id,
        summary: `Бараа хөдөлгөөн цуцлагдав — ${movement.documentNo}, ${movement.date}, тоо ${Number(movement.quantity)}`,
      },
      tx
    );
  });
  revalidateInventory();
}

export async function cancelInventoryMovement(
  id: string
): Promise<ActionResult> {
  try {
    await cancelInventoryMovementCore(id);
    return {};
  } catch (caught) {
    return actionError(
      "cancelInventoryMovement",
      caught,
      "Хөдөлгөөн цуцлагдсангүй"
    );
  }
}

// ─── Тооллого ────────────────────────────────────────────────────────────────

// Тооллогын хуудас: агуулах, огноо, бараа бүрийн тоолсон тоог хүлээж авч
// системийн үлдэгдэлтэй (тухайн огнооны байдлаар, сервер талд дахин тооцно)
// харьцуулаад зөрүү бүрд ТОХИРУУЛГЫН НООРОГ хөдөлгөөн үүсгэнэ. Ноорог нь
// ердийн замаараа батлагдаж, costing run илүүдэл/дутагдлыг
// costing_account_settings-д тохируулсан тохируулгын ашиг/алдагдлын
// дансаар журналдана (JPR-006 — данс кодод хатуу бичигдэхгүй).
// Advisory lock — батлах/цуцлахтай нэг цуваанд.
async function recordInventoryCountCore(data: {
  date: string;
  warehouseId: string;
  counts: { itemId: string; countedQty: number }[];
}) {
  const { orgId, userId } = await requireModuleAction("inv", "write");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
    throw new Error("Огноо буруу байна");
  // Тохируулгын ноорог хаагдсан сард батлагдахгүй — эрт, ойлгомжтой зогсооно.
  await assertPeriodOpen(orgId, data.date);
  if (data.counts.length === 0)
    throw new Error("Тоолсон бараа алга");

  const warehouse = await db.query.warehouses.findFirst({
    where: and(
      eq(warehouses.id, data.warehouseId),
      eq(warehouses.organizationId, orgId),
      eq(warehouses.isActive, true)
    ),
    columns: { id: true },
  });
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");

  const itemIds = data.counts.map((count) => count.itemId);
  const items = await db.query.inventoryItems.findMany({
    where: and(
      eq(inventoryItems.organizationId, orgId),
      eq(inventoryItems.isActive, true),
      inArray(inventoryItems.id, itemIds)
    ),
    columns: { id: true },
  });
  const ownedItems = new Set(items.map((item) => item.id));

  return await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);

    // Системийн үлдэгдэл тооллогын огнооны байдлаар (snapshot + replay).
    const balances = await loadQtyBalancesFast(orgId, data.date, tx);

    const inserts: (typeof inventoryMovements.$inferInsert)[] = [];
    for (const count of data.counts) {
      if (!ownedItems.has(count.itemId))
        throw new Error("Идэвхтэй бараа олдсонгүй");
      const countedQty = Number(count.countedQty);
      if (!Number.isFinite(countedQty) || countedQty < 0)
        throw new Error("Тоолсон тоо 0 буюу түүнээс их байна");
      const systemQty =
        balances.get(balanceKey(count.itemId, data.warehouseId)) ?? 0;
      const difference = Math.round((countedQty - systemQty) * 10000) / 10000;
      if (difference === 0) continue;
      inserts.push({
        userId,
        organizationId: orgId,
        documentNo: `CNT-${data.date.replaceAll("-", "")}-${crypto
          .randomUUID()
          .slice(0, 6)
          .toUpperCase()}`,
        movementType: "adjustment",
        date: data.date,
        itemId: count.itemId,
        warehouseId: data.warehouseId,
        toWarehouseId: null,
        quantity: String(difference),
        description: `Тооллого ${data.date}: систем ${systemQty}, тоолсон ${countedQty}`,
        status: "draft",
        sourceType: "manual",
        sourceId: null,
      });
    }

    if (inserts.length > 0) await tx.insert(inventoryMovements).values(inserts);
    return { created: inserts.length };
  }).then((result) => {
    revalidateInventory();
    return result;
  });
}

export async function recordInventoryCount(
  data: Parameters<typeof recordInventoryCountCore>[0]
): Promise<ActionResult<{ created: number }>> {
  try {
    return await recordInventoryCountCore(data);
  } catch (caught) {
    return actionError(
      "recordInventoryCount",
      caught,
      "Тооллого бүртгэгдсэнгүй"
    );
  }
}
