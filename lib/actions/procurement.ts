"use server";

// Хангамжийн модулийн SERVER ACTION-ууд (docs/procurement §3.3, гэрээ §5).
//
// ⚠️ Энэ файл ЗӨВХӨН async функц export хийнэ — const/type export нь dev
// серверийг унагадаг. Бүх type нь lib/procurement/types.ts-д.
//
// Хэв маяг (бүх модультай ижил): Core функц алдааг ШИДДЭГ (транзакц
// rollback), гадаад wrapper нь ActionResult буцаана (Next.js production дээр
// шидсэн алдааны мессежийг нуудаг). Бичилтийн зам бүрд
// assertPeriodOpen(orgId, date) транзакцийн ГАДНА + assertPeriodOpenInTx
// транзакцийн ДОТОР ПЕРВЫЙ. Дансны дугаар кодод хатуу бичигдэхгүй —
// loadCostingAccountSettings / itemAccountsFor-оос.

import { revalidatePath } from "next/cache";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";

import { actionError, type ActionResult, unwrapAction } from "@/lib/action-result";
import { roundMoney } from "@/lib/arap/accounting";
import {
  loadArApCounterparties,
  loadArApInventoryOptions,
  loadArApSegmentData,
} from "@/lib/arap/load-data";
import { createArApDocument } from "@/lib/actions/arap";
import { listAttachments } from "@/lib/actions/attachments";
import { logAuditEvent } from "@/lib/audit";
import { getActiveOrg, requireModuleAction } from "@/lib/auth";
import { getOfficialRateForDate } from "@/lib/cash/exchange-rates";
import { entryPostingAccounts } from "@/lib/costing/costing";
import {
  loadCostComponents,
  loadCostingAccountSettings,
} from "@/lib/costing/master-data";
import {
  assertEnabledMainAccount,
  costingPostingCodeBuilder,
  itemAccountsFor,
} from "@/lib/costing/posting-helpers";
import { db } from "@/lib/db";
import {
  arApDocuments,
  costEntries,
  counterparties,
  documentAttachments,
  goodsReceiptLines,
  goodsReceipts,
  inventoryItems,
  inventoryMovements,
  journalLines,
  journalVouchers,
  purchaseOrderLines,
  purchaseOrders,
  warehouses,
} from "@/lib/db/schema";
import { findNegativeStock, type MovementRef } from "@/lib/inventory/balances";
import { toMovementRefs } from "@/lib/inventory/load-data";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { buildPoCloseLines } from "@/lib/procurement/close-lines";
import {
  PO_BUSINESS_OBJECT,
  PO_SOURCE_TYPE,
  PROCUREMENT_MODULE_KEY,
} from "@/lib/procurement/constants";
import {
  loadGoodsReceiptDetail,
  loadPurchaseOrderDetail,
} from "@/lib/procurement/load-data";
import { extractMainAccount } from "@/lib/reports/balances";
import type {
  GoodsReceiptPanelData,
  GoodsReceiptRemainingLine,
  PurchaseOrderDetail,
  PurchaseOrderPanelData,
} from "@/lib/procurement/types";

// ── Тогтмол/туслах (export БИШ) ─────────────────────────────────────────────

const QTY_EPSILON = 0.00005;
const MONEY_EPSILON = 0.005;

function revalidateProcurement() {
  for (const path of [
    "/procurement",
    "/procurement/orders",
    "/procurement/receipts",
    "/procurement/costs",
    "/inventory",
    "/inventory/movements",
    "/costing",
    "/costing/entries",
    "/gl/journal",
    "/gl/reports",
  ])
    revalidatePath(path);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} буруу байна`);
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function fmtMnt(value: number): string {
  return roundMoney(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function pgErrorText(caught: unknown): string {
  const parts: string[] = [];
  if (caught instanceof Error) parts.push(caught.message);
  const cause = (caught as { cause?: unknown } | null)?.cause;
  if (cause)
    parts.push(String((cause as { message?: string }).message ?? cause));
  return parts.join(" | ");
}

function isDocumentNoConflict(caught: unknown): boolean {
  const code = (caught as { code?: unknown } | null)?.code;
  const causeCode = (caught as { cause?: { code?: unknown } } | null)?.cause
    ?.code;
  const text = pgErrorText(caught);
  const unique =
    code === "23505" || causeCode === "23505" || /duplicate key/i.test(text);
  return unique && /document_no/i.test(text);
}

/**
 * Баримтын дугаар: "PO-YYMM-NNN" / "GR-YYMM-NNN" (сар дотор дараалсан,
 * байгууллага дотор давхардахгүй). Гараар өгсөн дугаар автоматыг ДАРНА
 * (arap.ts-ийн хэв маяг: ≤40 тэмдэгт + org дотор давхардлын шалгалт).
 */
function monthStem(prefix: "PO" | "GR", date: string): string {
  return `${prefix}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
}

function nextNoFrom(stem: string, existing: string[]): string {
  let max = 0;
  for (const documentNo of existing) {
    if (!documentNo.startsWith(stem)) continue;
    const suffix = documentNo.slice(stem.length);
    if (!/^\d+$/.test(suffix)) continue;
    max = Math.max(max, Number(suffix));
  }
  return `${stem}${String(max + 1).padStart(3, "0")}`;
}

async function nextPurchaseOrderNo(
  orgId: string,
  date: string
): Promise<string> {
  const stem = monthStem("PO", date);
  const rows = await db
    .select({ documentNo: purchaseOrders.documentNo })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.organizationId, orgId),
        like(purchaseOrders.documentNo, `${stem}%`)
      )
    );
  return nextNoFrom(
    stem,
    rows.map((row) => row.documentNo)
  );
}

async function nextGoodsReceiptNo(
  orgId: string,
  date: string
): Promise<string> {
  const stem = monthStem("GR", date);
  const rows = await db
    .select({ documentNo: goodsReceipts.documentNo })
    .from(goodsReceipts)
    .where(
      and(
        eq(goodsReceipts.organizationId, orgId),
        like(goodsReceipts.documentNo, `${stem}%`)
      )
    );
  return nextNoFrom(
    stem,
    rows.map((row) => row.documentNo)
  );
}

async function assertManualDocumentNoFree(
  orgId: string,
  kind: "po" | "gr",
  documentNo: string
) {
  if (documentNo.length > 40)
    throw new Error("Баримтын дугаар 40 тэмдэгтээс хэтрэхгүй");
  const duplicate =
    kind === "po"
      ? await db.query.purchaseOrders.findFirst({
          where: and(
            eq(purchaseOrders.organizationId, orgId),
            eq(purchaseOrders.documentNo, documentNo)
          ),
          columns: { id: true },
        })
      : await db.query.goodsReceipts.findFirst({
          where: and(
            eq(goodsReceipts.organizationId, orgId),
            eq(goodsReceipts.documentNo, documentNo)
          ),
          columns: { id: true },
        });
  if (duplicate)
    throw new Error(`"${documentNo}" дугаартай баримт аль хэдийн бүртгэгдсэн`);
}

/**
 * Дугаарыг дараалуулж үүсгэх нь зэрэгцээ дуудлагад давхцаж болно — unique
 * зөрчил дээр дахин тооцоолж 4 хүртэл оролдоно (гараар өгсөн дугаарт 1).
 */
async function withDocumentNo<T>(
  next: () => Promise<string>,
  manual: string | null,
  run: (documentNo: string) => Promise<T>
): Promise<T> {
  const attempts = manual ? 1 : 4;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const documentNo = manual ?? (await next());
    try {
      return await run(documentNo);
    } catch (caught) {
      if (!isDocumentNoConflict(caught) || attempt === attempts - 1)
        throw caught;
    }
  }
  throw new Error("Баримтын дугаар үүсгэж чадсангүй — дахин оролдоно уу");
}

async function loadSupplier(orgId: string, counterpartyId: string) {
  const counterparty = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, counterpartyId),
      eq(counterparties.organizationId, orgId),
      eq(counterparties.isActive, true)
    ),
  });
  if (!counterparty) throw new Error("Идэвхтэй харилцагч олдсонгүй");
  if (!["supplier", "both"].includes(counterparty.counterpartyType))
    throw new Error(
      `${counterparty.name} нь ханган нийлүүлэгч биш — харилцагчийн төрлийг шалгана уу`
    );
  return counterparty;
}

async function assertActiveWarehouse(orgId: string, warehouseId: string) {
  const warehouse = await db.query.warehouses.findFirst({
    where: and(
      eq(warehouses.id, warehouseId),
      eq(warehouses.organizationId, orgId),
      eq(warehouses.isActive, true)
    ),
    columns: { id: true },
  });
  if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
}

async function assertActiveItem(orgId: string, itemId: string) {
  const item = await db.query.inventoryItems.findFirst({
    where: and(
      eq(inventoryItems.id, itemId),
      eq(inventoryItems.organizationId, orgId),
      eq(inventoryItems.isActive, true)
    ),
    columns: { id: true, code: true, name: true },
  });
  if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
  return item;
}

/** PO-г org scope-оор уншина; олдохгүй бол [PO_NOT_FOUND]. */
async function requirePurchaseOrder(orgId: string, id: string) {
  const row = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.id, id), eq(purchaseOrders.organizationId, orgId)),
  });
  if (!row) throw new Error("[PO_NOT_FOUND] Захиалга олдсонгүй");
  return row;
}

async function requirePurchaseOrderDetail(
  orgId: string,
  id: string
): Promise<PurchaseOrderDetail> {
  const detail = await loadPurchaseOrderDetail(orgId, id);
  if (!detail) throw new Error("[PO_NOT_FOUND] Захиалга олдсонгүй");
  return detail;
}

/**
 * Валютын ханш: ил өгөгдвөл түүнийг, эс бөгөөс тухайн өдрийн Монголбанкны
 * АЛБАН ханшийг (MNT → 1). Олдохгүй бол ШИДНЭ — ханш зохиохгүй (§3.5).
 */
async function resolveOfficialRate(
  currency: string,
  date: string,
  manualRate?: number
): Promise<{ rate: number; rateDate: string | null; rateSource: string }> {
  if (manualRate != null) {
    if (!Number.isFinite(manualRate) || manualRate <= 0)
      throw new Error("Ханш 0-ээс их байна");
    return { rate: manualRate, rateDate: date, rateSource: "manual" };
  }
  if (currency.toUpperCase() === "MNT")
    return { rate: 1, rateDate: date, rateSource: "mongolbank" };
  const lookup = await getOfficialRateForDate(currency, date);
  return {
    rate: lookup.rate,
    rateDate: lookup.rateDate,
    rateSource: lookup.source,
  };
}

// ── Худалдан авалтын захиалга (PO) ───────────────────────────────────────────

async function createPurchaseOrderCore(data: {
  counterpartyId: string;
  date: string;
  expectedDate?: string;
  currency?: string;
  warehouseId?: string;
  description: string;
  documentNo?: string;
  externalRef?: string;
  lines: {
    itemId: string;
    quantity: number;
    unitPrice: number;
    warehouseId?: string;
    description?: string;
  }[];
  approveNow?: boolean;
}): Promise<{ id: string; documentNo: string; dedup?: boolean }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  assertDate(data.date, "Огноо");
  if (data.expectedDate) assertDate(data.expectedDate, "Хүргэх огноо");
  if (data.expectedDate && data.expectedDate < data.date)
    throw new Error("Хүргэх огноо захиалгын огнооноос өмнө байж болохгүй");
  // Хаагдсан периодын хамгаалалт — ноорог ч энэ огноогоор бүртгэгдэнэ.
  await assertPeriodOpen(orgId, data.date);

  const description = data.description.trim();
  if (!description) throw new Error("Захиалгын утга оруулна уу");

  // Idempotency (externalRef): ижил ref-тэй хоёр дахь дуудлага ШИНЭ баримт
  // үүсгэхгүй, байгааг нь буцаана.
  const externalRef = cleanText(data.externalRef);
  if (externalRef) {
    const existing = await db.query.purchaseOrders.findFirst({
      where: and(
        eq(purchaseOrders.organizationId, orgId),
        eq(purchaseOrders.externalRef, externalRef)
      ),
      columns: { id: true, documentNo: true },
    });
    if (existing)
      return { id: existing.id, documentNo: existing.documentNo, dedup: true };
  }

  const counterparty = await loadSupplier(orgId, data.counterpartyId);
  const currency =
    data.currency?.trim().toUpperCase() || counterparty.defaultCurrency;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Валютын код буруу байна");

  const headerWarehouseId = data.warehouseId || null;
  if (headerWarehouseId) await assertActiveWarehouse(orgId, headerWarehouseId);

  if (data.lines.length === 0) throw new Error("Дор хаяж нэг мөр оруулна уу");
  const lines: {
    itemId: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    warehouseId: string | null;
    description: string;
  }[] = [];
  for (const line of data.lines) {
    const quantity = round4(Number(line.quantity));
    const unitPrice = round4(Number(line.unitPrice));
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");
    // Нэгж үнэ нь орлогдох өртгийн СУУРЬ тул 0 байж болохгүй (үнэ зохиохгүй).
    if (!Number.isFinite(unitPrice) || unitPrice <= 0)
      throw new Error("Нэгж үнэ 0-ээс их байна");
    await assertActiveItem(orgId, line.itemId);
    const lineWarehouseId = line.warehouseId || headerWarehouseId;
    if (line.warehouseId) await assertActiveWarehouse(orgId, line.warehouseId);
    lines.push({
      itemId: line.itemId,
      quantity,
      unitPrice,
      amount: roundMoney(quantity * unitPrice),
      warehouseId: lineWarehouseId,
      description: line.description?.trim() ?? "",
    });
  }
  const totalAmount = roundMoney(
    lines.reduce((sum, line) => sum + line.amount, 0)
  );

  const manualNo = cleanText(data.documentNo);
  if (manualNo) await assertManualDocumentNoFree(orgId, "po", manualNo);

  const created = await withDocumentNo(
    () => nextPurchaseOrderNo(orgId, data.date),
    manualNo,
    async (documentNo) =>
      await db.transaction(async (tx) => {
        await assertPeriodOpenInTx(tx, orgId, data.date);
        const [order] = await tx
          .insert(purchaseOrders)
          .values({
            userId,
            organizationId: orgId,
            documentNo,
            counterpartyId: counterparty.id,
            date: data.date,
            expectedDate: cleanText(data.expectedDate),
            currency,
            warehouseId: headerWarehouseId,
            description,
            status: data.approveNow ? "open" : "draft",
            totalAmount: String(totalAmount),
            externalRef,
            approvedAt: data.approveNow ? new Date() : null,
          })
          .returning({ id: purchaseOrders.id });
        await tx.insert(purchaseOrderLines).values(
          lines.map((line, index) => ({
            purchaseOrderId: order.id,
            itemId: line.itemId,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            amount: String(line.amount),
            warehouseId: line.warehouseId,
            description: line.description,
            sortOrder: index,
          }))
        );
        await logAuditEvent(
          {
            userId,
            organizationId: orgId,
            action: data.approveNow ? "create_approved" : "create",
            entityType: "purchase_order",
            entityId: order.id,
            summary: `Худалдан авалтын захиалга ${data.approveNow ? "батлагдав" : "үүслээ"} — ${documentNo}, ${data.date}, ${counterparty.name}, ${fmtMnt(totalAmount)} ${currency}`,
          },
          tx
        );
        return { id: order.id, documentNo };
      })
  );

  revalidateProcurement();
  return created;
}

export async function createPurchaseOrder(
  data: Parameters<typeof createPurchaseOrderCore>[0]
): Promise<ActionResult<{ id: string; documentNo: string; dedup?: boolean }>> {
  try {
    return await createPurchaseOrderCore(data);
  } catch (caught) {
    return actionError(
      "createPurchaseOrder",
      caught,
      "Захиалга хадгалагдсангүй"
    );
  }
}

async function updatePurchaseOrderCore(data: {
  id: string;
  date?: string;
  expectedDate?: string;
  warehouseId?: string;
  description?: string;
  lines?: {
    id?: string;
    itemId: string;
    quantity: number;
    unitPrice: number;
    warehouseId?: string;
    description?: string;
  }[];
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const order = await requirePurchaseOrder(orgId, data.id);
  if (order.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгыг засах боломжгүй");
  if (order.status === "cancelled")
    throw new Error("Цуцлагдсан захиалгыг засах боломжгүй");

  const date = data.date ?? order.date;
  if (data.date) assertDate(data.date, "Огноо");
  if (data.expectedDate) assertDate(data.expectedDate, "Хүргэх огноо");
  await assertPeriodOpen(orgId, date);
  if (data.date && data.date !== order.date)
    await assertPeriodOpen(orgId, order.date);

  const headerWarehouseId =
    data.warehouseId === undefined ? order.warehouseId : data.warehouseId || null;
  if (headerWarehouseId && headerWarehouseId !== order.warehouseId)
    await assertActiveWarehouse(orgId, headerWarehouseId);

  const description =
    data.description === undefined ? order.description : data.description.trim();
  if (!description) throw new Error("Захиалгын утга оруулна уу");

  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const existingById = new Map(detail.lines.map((line) => [line.id, line]));

  type PreparedLine = {
    id: string | null;
    itemId: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    warehouseId: string | null;
    description: string;
  };
  let prepared: PreparedLine[] | null = null;
  const removedIds: string[] = [];

  if (data.lines) {
    if (data.lines.length === 0) throw new Error("Дор хаяж нэг мөр оруулна уу");
    const keptIds = new Set(
      data.lines
        .map((line) => line.id)
        .filter((id): id is string => Boolean(id))
    );
    for (const line of detail.lines) {
      if (keptIds.has(line.id)) continue;
      if (line.receivedQuantity > QTY_EPSILON)
        throw new Error(
          `[OVER_RECEIVED] ${line.itemCode}: хүлээн авсан мөрийг хасах боломжгүй (${line.receivedQuantity})`
        );
      if (line.invoicedQuantity > QTY_EPSILON)
        throw new Error(
          `[OVER_INVOICED] ${line.itemCode}: нэхэмжилсэн мөрийг хасах боломжгүй (${line.invoicedQuantity})`
        );
      removedIds.push(line.id);
    }

    prepared = [];
    for (const line of data.lines) {
      const quantity = round4(Number(line.quantity));
      const unitPrice = round4(Number(line.unitPrice));
      if (!Number.isFinite(quantity) || quantity <= 0)
        throw new Error("Тоо хэмжээ 0-ээс их байна");
      if (!Number.isFinite(unitPrice) || unitPrice <= 0)
        throw new Error("Нэгж үнэ 0-ээс их байна");
      const item = await assertActiveItem(orgId, line.itemId);
      if (line.warehouseId) await assertActiveWarehouse(orgId, line.warehouseId);
      const amount = roundMoney(quantity * unitPrice);

      if (line.id) {
        const current = existingById.get(line.id);
        if (!current) throw new Error("Захиалгын мөр олдсонгүй");
        // Хүлээн авсан/нэхэмжилсэн доогуур болгож болохгүй (§5).
        if (quantity < current.receivedQuantity - QTY_EPSILON)
          throw new Error(
            `[OVER_RECEIVED] ${item.code}: хүлээн авсан ${current.receivedQuantity} — тоог түүнээс доогуур болгож болохгүй`
          );
        if (quantity < current.invoicedQuantity - QTY_EPSILON)
          throw new Error(
            `[OVER_INVOICED] ${item.code}: нэхэмжилсэн ${current.invoicedQuantity} — тоог түүнээс доогуур болгож болохгүй`
          );
        if (amount < current.invoicedAmount - MONEY_EPSILON)
          throw new Error(
            `[OVER_INVOICED] ${item.code}: нэхэмжилсэн дүн ${fmtMnt(current.invoicedAmount)} — мөрийн дүнг түүнээс доогуур болгож болохгүй`
          );
      }
      prepared.push({
        id: line.id ?? null,
        itemId: line.itemId,
        quantity,
        unitPrice,
        amount,
        warehouseId: line.warehouseId || headerWarehouseId,
        description: line.description?.trim() ?? "",
      });
    }
  }

  const totalAmount = prepared
    ? roundMoney(prepared.reduce((sum, line) => sum + line.amount, 0))
    : Number(order.totalAmount);

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    if (prepared) {
      if (removedIds.length > 0)
        await tx
          .delete(purchaseOrderLines)
          .where(
            and(
              eq(purchaseOrderLines.purchaseOrderId, order.id),
              inArray(purchaseOrderLines.id, removedIds)
            )
          );
      for (const [index, line] of prepared.entries()) {
        if (line.id) {
          await tx
            .update(purchaseOrderLines)
            .set({
              itemId: line.itemId,
              quantity: String(line.quantity),
              unitPrice: String(line.unitPrice),
              amount: String(line.amount),
              warehouseId: line.warehouseId,
              description: line.description,
              sortOrder: index,
            })
            .where(
              and(
                eq(purchaseOrderLines.id, line.id),
                eq(purchaseOrderLines.purchaseOrderId, order.id)
              )
            );
        } else {
          await tx.insert(purchaseOrderLines).values({
            purchaseOrderId: order.id,
            itemId: line.itemId,
            quantity: String(line.quantity),
            unitPrice: String(line.unitPrice),
            amount: String(line.amount),
            warehouseId: line.warehouseId,
            description: line.description,
            sortOrder: index,
          });
        }
      }
    }
    const [claimed] = await tx
      .update(purchaseOrders)
      .set({
        date,
        expectedDate:
          data.expectedDate === undefined
            ? order.expectedDate
            : cleanText(data.expectedDate),
        warehouseId: headerWarehouseId,
        description,
        totalAmount: String(totalAmount),
      })
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          inArray(purchaseOrders.status, ["draft", "open"])
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "update",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалга засагдав — ${order.documentNo}, ${date}, ${fmtMnt(totalAmount)} ${order.currency}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: order.id };
}

export async function updatePurchaseOrder(
  data: Parameters<typeof updatePurchaseOrderCore>[0]
): Promise<ActionResult<{ id: string }>> {
  try {
    return await updatePurchaseOrderCore(data);
  } catch (caught) {
    return actionError("updatePurchaseOrder", caught, "Захиалга засагдсангүй");
  }
}

async function approvePurchaseOrderCore(input: {
  id: string;
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const order = await requirePurchaseOrder(orgId, input.id);
  if (order.status !== "draft")
    throw new Error("Зөвхөн ноорог захиалгыг батална");
  await assertPeriodOpen(orgId, order.date);
  const [line] = await db
    .select({ id: purchaseOrderLines.id })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, order.id))
    .limit(1);
  if (!line) throw new Error("Захиалгад мөр алга — мөр нэмээд батлана уу");

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, order.date);
    const [claimed] = await tx
      .update(purchaseOrders)
      .set({ status: "open", approvedAt: new Date() })
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.status, "draft")
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "approve",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалга батлагдав — ${order.documentNo}, ${order.date}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: order.id };
}

export async function approvePurchaseOrder(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    return await approvePurchaseOrderCore(input);
  } catch (caught) {
    return actionError("approvePurchaseOrder", caught, "Захиалга батлагдсангүй");
  }
}

/** Захиалгад хамаарах хүлээн авалт / нэхэмжлэх байгаа эсэх (буцаагдсаныг тооцохгүй). */
async function assertNoProcurementActivity(
  orgId: string,
  purchaseOrderId: string,
  documentNo: string
) {
  const receipt = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.organizationId, orgId),
      eq(goodsReceipts.purchaseOrderId, purchaseOrderId),
      ne(goodsReceipts.status, "reversed")
    ),
    columns: { documentNo: true },
  });
  if (receipt)
    throw new Error(
      `${documentNo}: ${receipt.documentNo} хүлээн авалттай тул үйлдэл хийх боломжгүй — эхлээд хүлээн авалтыг буцаана уу`
    );
  const invoice = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.organizationId, orgId),
      eq(arApDocuments.purchaseOrderId, purchaseOrderId),
      ne(arApDocuments.status, "reversed")
    ),
    columns: { documentNo: true },
  });
  if (invoice)
    throw new Error(
      `${documentNo}: ${invoice.documentNo} нэхэмжлэхтэй тул үйлдэл хийх боломжгүй — эхлээд нэхэмжлэхийг буцаана/устгана уу`
    );
}

async function cancelPurchaseOrderCore(input: {
  id: string;
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const order = await requirePurchaseOrder(orgId, input.id);
  if (order.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгыг цуцлах боломжгүй");
  if (order.status === "cancelled")
    throw new Error("Захиалга аль хэдийн цуцлагдсан");
  await assertNoProcurementActivity(orgId, order.id, order.documentNo);

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(purchaseOrders)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          inArray(purchaseOrders.status, ["draft", "open"])
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "cancel",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалга цуцлагдав — ${order.documentNo}, ${order.date}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: order.id };
}

export async function cancelPurchaseOrder(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    return await cancelPurchaseOrderCore(input);
  } catch (caught) {
    return actionError("cancelPurchaseOrder", caught, "Захиалга цуцлагдсангүй");
  }
}

async function deletePurchaseOrderCore(input: { id: string }): Promise<void> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const order = await requirePurchaseOrder(orgId, input.id);
  if (order.status !== "draft")
    throw new Error("Зөвхөн ноорог захиалгыг устгана");
  await assertNoProcurementActivity(orgId, order.id, order.documentNo);

  await db.transaction(async (tx) => {
    // Хавсралт нь polymorphic (FK-гүй) тул модуль өөрөө цэвэрлэнэ (§7).
    await tx
      .delete(documentAttachments)
      .where(
        and(
          eq(documentAttachments.organizationId, orgId),
          eq(documentAttachments.entityType, PO_BUSINESS_OBJECT),
          eq(documentAttachments.entityId, order.id)
        )
      );
    const [claimed] = await tx
      .delete(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.status, "draft")
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "delete",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалга устгагдав — ${order.documentNo}, ${order.date}`,
      },
      tx
    );
  });

  revalidateProcurement();
}

export async function deletePurchaseOrder(input: {
  id: string;
}): Promise<ActionResult> {
  try {
    await deletePurchaseOrderCore(input);
    return {};
  } catch (caught) {
    return actionError("deletePurchaseOrder", caught, "Захиалга устгагдсангүй");
  }
}

// ── PO хаалт / дахин нээх ────────────────────────────────────────────────────

async function closePurchaseOrderCore(input: {
  id: string;
  closeDate: string;
}): Promise<{ voucherId: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "post"
  );
  assertDate(input.closeDate, "Хаах огноо");
  await assertPeriodOpen(orgId, input.closeDate);

  const order = await requirePurchaseOrder(orgId, input.id);
  if (order.status !== "open")
    throw new Error("[PO_NOT_OPEN] Зөвхөн нээлттэй захиалгыг хаана");

  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  if (detail.blockers.length > 0)
    throw new Error(`[PO_NOT_READY] ${detail.blockers.join("; ")}`);

  // Дансны рольууд тохиргооноос (JPR-006) — кодод дугаар байхгүй.
  const roles = await loadCostingAccountSettings(orgId, userId);
  for (const main of [
    roles.clearingAccountNumber,
    roles.apClearingAccountNumber,
    roles.fxGainAccountNumber,
    roles.fxLossAccountNumber,
  ])
    await assertEnabledMainAccount(orgId, main);
  const buildCode = await costingPostingCodeBuilder(orgId);

  // Хаасан өдрийн МБ ханш нь ЗӨВХӨН мэдээллийн зорилготой (§3.2) — зөрүүг
  // түр дансдын үлдэгдлээс тооцдог тул ханш татагдахгүй байхад хаалт
  // зогсохгүй.
  let closeExchangeRate: number | null = null;
  if (order.currency.toUpperCase() !== "MNT")
    closeExchangeRate = await getOfficialRateForDate(
      order.currency,
      input.closeDate
    )
      .then((lookup) => lookup.rate)
      .catch(() => null);

  const description = `[${order.documentNo}] Захиалгын хаалт — түр дансдын тэгшитгэл`;

  const result = await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, input.closeDate);
    // Түр дансдын PO-гийн үлдэгдэл: posted + reversed (буцаалт нь эсрэг
    // мөрөөр шинэ журналд бичигддэг тул хоёуланг нийлбэрлэнэ).
    const rows = await tx
      .select({
        accountNumber: journalLines.accountNumber,
        debit: journalLines.debit,
        credit: journalLines.credit,
      })
      .from(journalLines)
      .innerJoin(
        journalVouchers,
        eq(journalVouchers.id, journalLines.voucherId)
      )
      .where(
        and(
          eq(journalVouchers.organizationId, orgId),
          inArray(journalVouchers.status, ["posted", "reversed"]),
          eq(journalLines.businessObjectType, PO_BUSINESS_OBJECT),
          eq(journalLines.businessObjectId, order.id)
        )
      );
    let invClearingBalance = 0;
    let apClearingBalance = 0;
    for (const row of rows) {
      const main = extractMainAccount(row.accountNumber);
      const delta = Number(row.debit) - Number(row.credit);
      if (main === roles.clearingAccountNumber) invClearingBalance += delta;
      else if (main === roles.apClearingAccountNumber)
        apClearingBalance += delta;
    }

    const lines = buildPoCloseLines({
      purchaseOrderId: order.id,
      invClearingBalance,
      apClearingBalance,
      accounts: {
        invClearing: roles.clearingAccountNumber,
        apClearing: roles.apClearingAccountNumber,
        fxGain: roles.fxGainAccountNumber,
        fxLoss: roles.fxLossAccountNumber,
      },
      buildCode,
      description,
    });

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: input.closeDate,
        description,
        status: "posted",
        // Нэг захиалгад нэг ИДЭВХТЭЙ хаалтын журнал (partial unique index);
        // дахин нээхэд ref нь тайлагдана (reopenPurchaseOrderCore).
        externalRef: `po-close:${order.id}`,
      })
      .returning({ id: journalVouchers.id });
    await tx
      .insert(journalLines)
      .values(lines.map((line) => ({ voucherId: voucher.id, ...line })));

    const [claimed] = await tx
      .update(purchaseOrders)
      .set({
        status: "closed",
        closedAt: new Date(),
        closeVoucherId: voucher.id,
        closeExchangeRate:
          closeExchangeRate != null ? String(closeExchangeRate) : null,
      })
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.status, "open")
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "close",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалга хаагдав — ${order.documentNo}, ${input.closeDate}, журнал ${voucher.id}`,
      },
      tx
    );
    return { voucherId: voucher.id };
  });

  revalidateProcurement();
  return result;
}

export async function closePurchaseOrder(input: {
  id: string;
  closeDate: string;
}): Promise<ActionResult<{ voucherId: string }>> {
  try {
    return await closePurchaseOrderCore(input);
  } catch (caught) {
    return actionError("closePurchaseOrder", caught, "Захиалга хаагдсангүй");
  }
}

async function reopenPurchaseOrderCore(input: {
  id: string;
  reversalDate?: string;
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "post"
  );
  const order = await requirePurchaseOrder(orgId, input.id);
  if (order.status !== "closed")
    throw new Error("Зөвхөн хаагдсан захиалгыг дахин нээнэ");
  if (!order.closeVoucherId)
    throw new Error("Хаалтын журнал олдсонгүй — дахин нээх боломжгүй");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, order.closeVoucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Хаалтын GL журнал олдсонгүй");

  // Буцаалт нь ЭХ огноогоор бичигдэнэ (CLAUDE.md §4) — ил огноо өгвөл түүнийг.
  const reversalDate = input.reversalDate ?? voucher.date;
  if (input.reversalDate) assertDate(input.reversalDate, "Буцаах огноо");
  await assertPeriodOpen(orgId, reversalDate);

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, reversalDate);
    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: reversalDate,
        description: `Буцаалт [${order.documentNo}] ${voucher.description}`,
        status: "posted",
        reversalOfVoucherId: voucher.id,
      })
      .returning({ id: journalVouchers.id });
    // Мөрүүд толин тусгал; businessObject түлхүүрээ ХАДГАЛНА — түр дансууд
    // хаалтын өмнөх үлдэгдэлдээ буцна.
    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        costEntryId: line.costEntryId,
        inventoryMovementId: line.inventoryMovementId,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description ?? "",
        sortOrder: index,
        businessObjectType: line.businessObjectType,
        businessObjectId: line.businessObjectId,
      }))
    );
    const [voucherClaimed] = await tx
      .update(journalVouchers)
      // externalRef-ийг тайлж дараагийн хаалтад `po-close:<id>`-ийг чөлөөлнө.
      .set({ status: "reversed", externalRef: null })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.status, "posted")
        )
      )
      .returning({ id: journalVouchers.id });
    if (!voucherClaimed)
      throw new Error("Хаалтын журнал аль хэдийн буцаагдсан байна");

    const [claimed] = await tx
      .update(purchaseOrders)
      .set({
        status: "open",
        closedAt: null,
        closeVoucherId: null,
        closeExchangeRate: null,
      })
      .where(
        and(
          eq(purchaseOrders.id, order.id),
          eq(purchaseOrders.organizationId, orgId),
          eq(purchaseOrders.status, "closed")
        )
      )
      .returning({ id: purchaseOrders.id });
    if (!claimed) throw new Error("Захиалгын төлөв өөрчлөгдсөн байна");

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reopen",
        entityType: "purchase_order",
        entityId: order.id,
        summary: `Захиалгын хаалт буцаагдав — ${order.documentNo}, ${reversalDate}, журнал ${reversal.id}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: order.id };
}

export async function reopenPurchaseOrder(input: {
  id: string;
  reversalDate?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    return await reopenPurchaseOrderCore(input);
  } catch (caught) {
    return actionError(
      "reopenPurchaseOrder",
      caught,
      "Захиалгын хаалт буцаагдсангүй"
    );
  }
}

// ── Хүлээн авалт (goods receipt) ─────────────────────────────────────────────

/** Ноорог хүлээн авалтын мөрүүдийг бэлдэнэ (хоосон бол хүлээн аваагүй үлдэгдэл). */
function prepareReceiptLines(
  detail: PurchaseOrderDetail,
  requested?: { purchaseOrderLineId: string; quantity: number }[]
): { purchaseOrderLineId: string; quantity: number }[] {
  const byId = new Map(detail.lines.map((line) => [line.id, line]));
  if (!requested || requested.length === 0) {
    const lines = detail.lines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        quantity: round4(line.quantity - line.receivedQuantity),
      }))
      .filter((line) => line.quantity > QTY_EPSILON);
    if (lines.length === 0)
      throw new Error(
        "Хүлээн авах үлдэгдэл алга — захиалга бүхэлдээ хүлээн авагдсан"
      );
    return lines;
  }

  const merged = new Map<string, number>();
  for (const line of requested) {
    const poLine = byId.get(line.purchaseOrderLineId);
    if (!poLine) throw new Error("Захиалгын мөр олдсонгүй");
    const quantity = round4(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");
    merged.set(
      line.purchaseOrderLineId,
      round4((merged.get(line.purchaseOrderLineId) ?? 0) + quantity)
    );
  }
  const lines: { purchaseOrderLineId: string; quantity: number }[] = [];
  for (const [purchaseOrderLineId, quantity] of merged) {
    const poLine = byId.get(purchaseOrderLineId)!;
    const remaining = round4(poLine.quantity - poLine.receivedQuantity);
    if (quantity > remaining + QTY_EPSILON)
      throw new Error(
        `[OVER_RECEIVED] ${poLine.itemCode}: хүлээн авах үлдэгдэл ${remaining}, оруулсан ${quantity}`
      );
    lines.push({ purchaseOrderLineId, quantity });
  }
  return lines;
}

async function createGoodsReceiptCore(data: {
  purchaseOrderId: string;
  date: string;
  warehouseId?: string;
  exchangeRate?: number;
  documentNo?: string;
  description?: string;
  lines?: { purchaseOrderLineId: string; quantity: number }[];
  confirmNow?: boolean;
}): Promise<{ id: string; documentNo: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    data.confirmNow ? "post" : "write"
  );
  assertDate(data.date, "Огноо");
  await assertPeriodOpen(orgId, data.date);

  const order = await requirePurchaseOrder(orgId, data.purchaseOrderId);
  if (order.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгад хүлээн авалт нэмэгдэхгүй");
  if (order.status !== "open")
    throw new Error("[PO_NOT_OPEN] Зөвхөн нээлттэй захиалгад хүлээн авна");

  const warehouseId = data.warehouseId || order.warehouseId;
  if (!warehouseId)
    throw new Error("Агуулах сонгоно уу — захиалгад default агуулах алга");
  await assertActiveWarehouse(orgId, warehouseId);

  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const lines = prepareReceiptLines(detail, data.lines);
  const rate = await resolveOfficialRate(
    order.currency,
    data.date,
    data.exchangeRate
  );

  const manualNo = cleanText(data.documentNo);
  if (manualNo) await assertManualDocumentNoFree(orgId, "gr", manualNo);

  const created = await withDocumentNo(
    () => nextGoodsReceiptNo(orgId, data.date),
    manualNo,
    async (documentNo) =>
      await db.transaction(async (tx) => {
        await assertPeriodOpenInTx(tx, orgId, data.date);
        const [receipt] = await tx
          .insert(goodsReceipts)
          .values({
            userId,
            organizationId: orgId,
            purchaseOrderId: order.id,
            documentNo,
            date: data.date,
            warehouseId,
            exchangeRate: String(rate.rate),
            rateSource: rate.rateSource,
            rateDate: rate.rateDate,
            description: data.description?.trim() ?? "",
            status: "draft",
          })
          .returning({ id: goodsReceipts.id });
        await tx.insert(goodsReceiptLines).values(
          lines.map((line, index) => ({
            receiptId: receipt.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: String(line.quantity),
            sortOrder: index,
          }))
        );
        await logAuditEvent(
          {
            userId,
            organizationId: orgId,
            action: "create",
            entityType: "goods_receipt",
            entityId: receipt.id,
            summary: `Хүлээн авалт үүслээ — ${documentNo}, ${data.date}, ${order.documentNo}, ${lines.length} мөр, ханш ${rate.rate}`,
          },
          tx
        );
        return { id: receipt.id, documentNo };
      })
  );

  revalidateProcurement();
  if (data.confirmNow) await confirmGoodsReceiptCore({ id: created.id });
  return created;
}

export async function createGoodsReceipt(
  data: Parameters<typeof createGoodsReceiptCore>[0]
): Promise<ActionResult<{ id: string; documentNo: string }>> {
  try {
    return await createGoodsReceiptCore(data);
  } catch (caught) {
    return actionError(
      "createGoodsReceipt",
      caught,
      "Хүлээн авалт хадгалагдсангүй"
    );
  }
}

async function updateGoodsReceiptCore(data: {
  id: string;
  date?: string;
  warehouseId?: string;
  exchangeRate?: number;
  description?: string;
  lines?: { purchaseOrderLineId: string; quantity: number }[];
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const receipt = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.id, data.id),
      eq(goodsReceipts.organizationId, orgId)
    ),
  });
  if (!receipt) throw new Error("Хүлээн авалт олдсонгүй");
  if (receipt.status !== "draft")
    throw new Error("[GR_NOT_DRAFT] Зөвхөн ноорог хүлээн авалтыг засна");

  const order = await requirePurchaseOrder(orgId, receipt.purchaseOrderId);
  if (order.status !== "open")
    throw new Error("[PO_NOT_OPEN] Зөвхөн нээлттэй захиалгын хүлээн авалтыг засна");

  const date = data.date ?? receipt.date;
  if (data.date) assertDate(data.date, "Огноо");
  await assertPeriodOpen(orgId, date);
  if (data.date && data.date !== receipt.date)
    await assertPeriodOpen(orgId, receipt.date);

  const warehouseId = data.warehouseId || receipt.warehouseId;
  if (warehouseId !== receipt.warehouseId)
    await assertActiveWarehouse(orgId, warehouseId);

  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  // Одоогийн ноорог мөрүүд нь `receivedQuantity`-д тоологдоогүй (зөвхөн
  // батлагдсан хүлээн авалт тоологдоно) тул үлдэгдлийн шалгалт шууд ажиллана.
  const lines = data.lines ? prepareReceiptLines(detail, data.lines) : null;
  const rate =
    data.exchangeRate != null || (data.date && data.date !== receipt.date)
      ? await resolveOfficialRate(order.currency, date, data.exchangeRate)
      : {
          rate: Number(receipt.exchangeRate),
          rateDate: receipt.rateDate,
          rateSource: receipt.rateSource,
        };

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, date);
    if (lines) {
      await tx
        .delete(goodsReceiptLines)
        .where(eq(goodsReceiptLines.receiptId, receipt.id));
      await tx.insert(goodsReceiptLines).values(
        lines.map((line, index) => ({
          receiptId: receipt.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          quantity: String(line.quantity),
          sortOrder: index,
        }))
      );
    }
    const [claimed] = await tx
      .update(goodsReceipts)
      .set({
        date,
        warehouseId,
        exchangeRate: String(rate.rate),
        rateDate: rate.rateDate,
        rateSource: rate.rateSource,
        description:
          data.description === undefined
            ? receipt.description
            : data.description.trim(),
      })
      .where(
        and(
          eq(goodsReceipts.id, receipt.id),
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "draft")
        )
      )
      .returning({ id: goodsReceipts.id });
    if (!claimed) throw new Error("Хүлээн авалтын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "update",
        entityType: "goods_receipt",
        entityId: receipt.id,
        summary: `Хүлээн авалт засагдав — ${receipt.documentNo}, ${date}, ханш ${rate.rate}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: receipt.id };
}

export async function updateGoodsReceipt(
  data: Parameters<typeof updateGoodsReceiptCore>[0]
): Promise<ActionResult<{ id: string }>> {
  try {
    return await updateGoodsReceiptCore(data);
  } catch (caught) {
    return actionError(
      "updateGoodsReceipt",
      caught,
      "Хүлээн авалт засагдсангүй"
    );
  }
}

/**
 * Хүлээн авалт батлах (гэрээ §5.1, docs/procurement §3.3 ②).
 *
 * Нэг транзакцид: орлого confirmed + `receipt_capitalize` (posted) +
 * НЭГ POSTED журнал (Dr бараа / Cr бараа материалын түр данс). Дүн нь
 * `тоо × PO нэгж үнэ × хүлээн авсан өдрийн МБ ханш` — бараа ЭНЭ ханшаар
 * үнэлэгдэнэ (product owner #4). Клирингийн түлхүүр = PO.
 */
async function confirmGoodsReceiptCore(input: { id: string }): Promise<{
  id: string;
  voucherId: string | null;
  amountMnt: number;
}> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "post"
  );

  const receipt = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.id, input.id),
      eq(goodsReceipts.organizationId, orgId)
    ),
    with: {
      lines: {
        with: { purchaseOrderLine: { with: { item: true } } },
        orderBy: (line, { asc }) => [asc(line.sortOrder)],
      },
      purchaseOrder: true,
      warehouse: true,
    },
  });
  if (!receipt) throw new Error("Хүлээн авалт олдсонгүй");
  if (receipt.status !== "draft")
    throw new Error("[GR_NOT_DRAFT] Зөвхөн ноорог хүлээн авалтыг батална");
  if (receipt.purchaseOrder.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгад хүлээн авалт батлагдахгүй");
  if (receipt.purchaseOrder.status !== "open")
    throw new Error("[PO_NOT_OPEN] Захиалга нээлттэй биш");
  assertDate(receipt.date, "Огноо");
  if (receipt.lines.length === 0) throw new Error("Хүлээн авалтад мөр алга");
  if (!receipt.warehouse?.isActive)
    throw new Error("Идэвхтэй агуулах олдсонгүй");
  const exchangeRate = Number(receipt.exchangeRate);
  if (!(exchangeRate > 0)) throw new Error("Ханш 0-ээс их байна");
  await assertPeriodOpen(orgId, receipt.date);

  // Бичих МӨЧИД шийдэгдэх дансууд (JPR-005/006) — тохиргооноос.
  const roles = await loadCostingAccountSettings(orgId, userId);
  const buildCode = await costingPostingCodeBuilder(orgId);
  const planned: {
    lineId: string;
    purchaseOrderLineId: string;
    orderedQuantity: number;
    itemId: string;
    itemCode: string;
    itemName: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    unitCost: number;
    debit: string;
    credit: string;
  }[] = [];

  for (const line of receipt.lines) {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");
    const poLine = line.purchaseOrderLine;
    const item = poLine?.item;
    if (!poLine || !item) throw new Error("Захиалгын мөр олдсонгүй");
    if (!item.isActive) throw new Error("Идэвхтэй бараа олдсонгүй");
    const unitPrice = Number(poLine.unitPrice);
    if (!(unitPrice > 0))
      throw new Error(
        `${item.code}: захиалгын нэгж үнэ 0 — үнэ зохиохгүй, захиалгыг засна уу`
      );
    const amount = roundMoney(quantity * unitPrice * exchangeRate);
    const accounts = await itemAccountsFor(orgId, userId, item.id);
    const { debit, credit } = entryPostingAccounts(
      "receipt_capitalize",
      {
        inventoryAccountNumber: accounts.inventoryAccountNumber,
        issueDebitAccountNumber: accounts.cogsAccountNumber,
      },
      {
        clearing: roles.clearingAccountNumber,
        adjustmentGain: roles.adjustmentGainAccountNumber,
        adjustmentLoss: roles.adjustmentLossAccountNumber,
        nrvExpense: roles.nrvExpenseAccountNumber,
        nrvReserve: roles.nrvReserveAccountNumber,
      }
    );
    await assertEnabledMainAccount(orgId, debit);
    await assertEnabledMainAccount(orgId, credit);
    planned.push({
      lineId: line.id,
      purchaseOrderLineId: poLine.id,
      orderedQuantity: Number(poLine.quantity),
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      quantity,
      unitPrice,
      amount,
      unitCost: round4(amount / quantity),
      debit,
      credit,
    });
  }

  const amountMnt = roundMoney(
    planned.reduce((sum, line) => sum + line.amount, 0)
  );
  const description = `[${receipt.documentNo}] ${receipt.purchaseOrder.documentNo} — хүлээн авалтын капитализаци`;
  const warehouseId = receipt.warehouseId;

  const voucherId = await db.transaction(async (tx) => {
    // Түгжээний дараалал: период (5, shared) → бараа үлдэгдэл (1) →
    // өртгийн run (2) — өсөх дарааллаар, deadlock-гүй (guard.ts).
    await assertPeriodOpenInTx(tx, orgId, receipt.date);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 2)`);

    const [claimed] = await tx
      .update(goodsReceipts)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(goodsReceipts.id, receipt.id),
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "draft")
        )
      )
      .returning({ id: goodsReceipts.id });
    if (!claimed) throw new Error("Хүлээн авалтын төлөв өөрчлөгдсөн байна");

    // OVER_RECEIVED: PO мөр бүрд Σ батлагдсан хүлээн авалт ≤ захиалсан.
    for (const line of planned) {
      await tx
        .select({ id: purchaseOrderLines.id })
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.id, line.purchaseOrderLineId))
        .for("update");
      const [received] = await tx
        .select({
          quantity: sql<string>`coalesce(sum(${goodsReceiptLines.quantity}), 0)`,
        })
        .from(goodsReceiptLines)
        .innerJoin(
          goodsReceipts,
          eq(goodsReceipts.id, goodsReceiptLines.receiptId)
        )
        .where(
          and(
            eq(goodsReceiptLines.purchaseOrderLineId, line.purchaseOrderLineId),
            eq(goodsReceipts.status, "confirmed"),
            ne(goodsReceipts.id, receipt.id)
          )
        );
      const already = Number(received?.quantity ?? 0);
      if (round4(already + line.quantity) > line.orderedQuantity + QTY_EPSILON)
        throw new Error(
          `[OVER_RECEIVED] ${line.itemCode}: захиалсан ${line.orderedQuantity}, өмнө хүлээн авсан ${already}, одоо ${line.quantity}`
        );
    }

    // Хасах үлдэгдлийн replay — confirmInventoryMovementCore-той ИЖИЛ гэрээ.
    const existing = toMovementRefs(
      await tx.query.inventoryMovements.findMany({
        where: and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "confirmed")
        ),
      })
    );
    const nowIso = new Date().toISOString();
    const pending: MovementRef[] = planned.map((line, index) => ({
      id: `pending-gr-${index}`,
      movementType: "receipt",
      date: receipt.date,
      itemId: line.itemId,
      warehouseId,
      toWarehouseId: null,
      quantity: line.quantity,
      createdAt: nowIso,
    }));
    const violation = findNegativeStock([...existing, ...pending]);
    if (violation)
      throw new Error(
        `Үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter}) — батлах боломжгүй`
      );

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: receipt.date,
        description,
        status: "posted",
        externalRef: `gr-capitalize:${receipt.id}`,
      })
      .returning({ id: journalVouchers.id });

    let sortOrder = 0;
    for (const [index, line] of planned.entries()) {
      const [movement] = await tx
        .insert(inventoryMovements)
        .values({
          userId,
          organizationId: orgId,
          documentNo: `${receipt.documentNo}-${String(index + 1).padStart(2, "0")}`,
          movementType: "receipt",
          date: receipt.date,
          itemId: line.itemId,
          warehouseId,
          toWarehouseId: null,
          quantity: String(line.quantity),
          description: `[${receipt.documentNo}] ${receipt.purchaseOrder.documentNo} — ${line.itemName}`,
          status: "confirmed",
          confirmedAt: new Date(),
          sourceType: PO_SOURCE_TYPE,
          sourceId: line.lineId,
        })
        .returning({ id: inventoryMovements.id });

      const lineDescription = `[${receipt.documentNo}] ${line.itemName} — ${line.quantity} × ${line.unitPrice} × ${exchangeRate}`;
      const [entry] = await tx
        .insert(costEntries)
        .values({
          userId,
          organizationId: orgId,
          movementId: movement.id,
          itemId: line.itemId,
          warehouseId,
          periodCode: receipt.date.slice(0, 7),
          entryType: "receipt_capitalize",
          date: receipt.date,
          quantity: String(line.quantity),
          unitCost: String(line.unitCost),
          amount: String(line.amount),
          valuationSource: PO_SOURCE_TYPE,
          sourceLineId: null,
          businessObjectType: PO_BUSINESS_OBJECT,
          businessObjectId: receipt.purchaseOrderId,
          debitAccountNumber: line.debit,
          creditAccountNumber: line.credit,
          status: "posted",
          postedAt: new Date(),
          voucherId: voucher.id,
        })
        .returning({ id: costEntries.id });

      await tx.insert(journalLines).values([
        {
          voucherId: voucher.id,
          costEntryId: entry.id,
          inventoryMovementId: movement.id,
          accountNumber: buildCode(line.debit),
          debit: String(line.amount),
          credit: "0",
          description: lineDescription,
          sortOrder: sortOrder++,
          businessObjectType: PO_BUSINESS_OBJECT,
          businessObjectId: receipt.purchaseOrderId,
        },
        {
          voucherId: voucher.id,
          costEntryId: entry.id,
          inventoryMovementId: movement.id,
          accountNumber: buildCode(line.credit),
          debit: "0",
          credit: String(line.amount),
          description: lineDescription,
          sortOrder: sortOrder++,
          businessObjectType: PO_BUSINESS_OBJECT,
          businessObjectId: receipt.purchaseOrderId,
        },
      ]);

      await tx
        .update(goodsReceiptLines)
        .set({ movementId: movement.id })
        .where(eq(goodsReceiptLines.id, line.lineId));
    }

    await tx
      .update(goodsReceipts)
      .set({ voucherId: voucher.id })
      .where(eq(goodsReceipts.id, receipt.id));

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "confirm",
        entityType: "goods_receipt",
        entityId: receipt.id,
        summary: `Хүлээн авалт батлагдав — ${receipt.documentNo}, ${receipt.date}, ${planned.length} мөр, ${fmtMnt(amountMnt)}₮`,
      },
      tx
    );
    return voucher.id;
  });

  revalidateProcurement();
  return { id: receipt.id, voucherId, amountMnt };
}

export async function confirmGoodsReceipt(input: { id: string }): Promise<
  ActionResult<{ id: string; voucherId: string | null; amountMnt: number }>
> {
  try {
    return await confirmGoodsReceiptCore(input);
  } catch (caught) {
    return actionError(
      "confirmGoodsReceipt",
      caught,
      "Хүлээн авалт батлагдсангүй"
    );
  }
}

async function reverseGoodsReceiptCore(input: {
  id: string;
}): Promise<{ id: string }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "post"
  );
  const receipt = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.id, input.id),
      eq(goodsReceipts.organizationId, orgId)
    ),
    with: {
      lines: true,
      purchaseOrder: { columns: { status: true, documentNo: true } },
    },
  });
  if (!receipt) throw new Error("Хүлээн авалт олдсонгүй");
  if (receipt.status !== "confirmed" || !receipt.voucherId)
    throw new Error("[GR_NOT_CONFIRMED] Зөвхөн батлагдсан хүлээн авалтыг буцаана");
  if (receipt.purchaseOrder.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгын хүлээн авалтыг буцаахгүй");
  // Буцаалт нь ЭХ огноогоор бичигдэнэ — тэр периодыг шалгана.
  await assertPeriodOpen(orgId, receipt.date);

  const movementIds = receipt.lines
    .map((line) => line.movementId)
    .filter((value): value is string => Boolean(value));
  // Нэмэлт зардал хуваарилагдсан бол эхлээд хуваарилалтыг буцаана.
  const landed =
    movementIds.length > 0
      ? await db.query.costEntries.findFirst({
          where: and(
            eq(costEntries.organizationId, orgId),
            inArray(costEntries.movementId, movementIds),
            eq(costEntries.entryType, "landed_cost"),
            inArray(costEntries.status, ["draft", "posted"])
          ),
          columns: { id: true },
        })
      : null;
  if (landed)
    throw new Error(
      "Энэ хүлээн авалтад нэмэлт зардал хуваарилагдсан байна — эхлээд хуваарилалтыг буцаана уу"
    );

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, receipt.voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, receipt.date);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 1)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}), 2)`);

    const [claimed] = await tx
      .update(goodsReceipts)
      .set({ status: "reversed" })
      .where(
        and(
          eq(goodsReceipts.id, receipt.id),
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "confirmed")
        )
      )
      .returning({ id: goodsReceipts.id });
    if (!claimed) throw new Error("Хүлээн авалтын төлөв өөрчлөгдсөн байна");

    // Цуцалснаар хожмын зарлагууд хасах болохгүй.
    const remaining = toMovementRefs(
      await tx.query.inventoryMovements.findMany({
        where: and(
          eq(inventoryMovements.organizationId, orgId),
          eq(inventoryMovements.status, "confirmed")
        ),
      })
    ).filter((ref) => !movementIds.includes(ref.id));
    const violation = findNegativeStock(remaining);
    if (violation)
      throw new Error(
        `Буцаавал үлдэгдэл хасах болно (${violation.date}: ${violation.balanceAfter})`
      );

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: receipt.date,
        description: `Буцаалт [${receipt.documentNo}] ${voucher.description}`,
        status: "posted",
        reversalOfVoucherId: voucher.id,
      })
      .returning({ id: journalVouchers.id });
    // Мөрүүд толин тусгал; дэд дэвтрийн болон businessObject түлхүүрүүд
    // ХЭВЭЭР — клирингийн объект PO дээр 0-өөр тулна.
    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        costEntryId: line.costEntryId,
        inventoryMovementId: line.inventoryMovementId,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description ?? "",
        sortOrder: index,
        businessObjectType: line.businessObjectType,
        businessObjectId: line.businessObjectId,
      }))
    );
    const [voucherClaimed] = await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.status, "posted")
        )
      )
      .returning({ id: journalVouchers.id });
    if (!voucherClaimed)
      throw new Error("GL журнал аль хэдийн буцаагдсан байна — төлвийг шалгана уу");

    await tx
      .update(costEntries)
      .set({ status: "reversed", reversalVoucherId: reversal.id })
      .where(
        and(
          eq(costEntries.organizationId, orgId),
          eq(costEntries.voucherId, voucher.id),
          eq(costEntries.status, "posted")
        )
      );
    if (movementIds.length > 0)
      await tx
        .update(inventoryMovements)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(inventoryMovements.organizationId, orgId),
            inArray(inventoryMovements.id, movementIds),
            eq(inventoryMovements.status, "confirmed")
          )
        );
    await tx
      .update(goodsReceipts)
      .set({ reversalVoucherId: reversal.id })
      .where(eq(goodsReceipts.id, receipt.id));

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "goods_receipt",
        entityId: receipt.id,
        summary: `Хүлээн авалт буцаагдав — ${receipt.documentNo}, ${receipt.date}`,
      },
      tx
    );
  });

  revalidateProcurement();
  return { id: receipt.id };
}

export async function reverseGoodsReceipt(input: {
  id: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    return await reverseGoodsReceiptCore(input);
  } catch (caught) {
    return actionError(
      "reverseGoodsReceipt",
      caught,
      "Хүлээн авалт буцаагдсангүй"
    );
  }
}

async function deleteGoodsReceiptCore(input: { id: string }): Promise<void> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    "write"
  );
  const receipt = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.id, input.id),
      eq(goodsReceipts.organizationId, orgId)
    ),
    columns: { id: true, documentNo: true, date: true, status: true },
  });
  if (!receipt) throw new Error("Хүлээн авалт олдсонгүй");
  if (receipt.status !== "draft")
    throw new Error("[GR_NOT_DRAFT] Зөвхөн ноорог хүлээн авалтыг устгана");

  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .delete(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.id, receipt.id),
          eq(goodsReceipts.organizationId, orgId),
          eq(goodsReceipts.status, "draft")
        )
      )
      .returning({ id: goodsReceipts.id });
    if (!claimed) throw new Error("Хүлээн авалтын төлөв өөрчлөгдсөн байна");
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "delete",
        entityType: "goods_receipt",
        entityId: receipt.id,
        summary: `Хүлээн авалт устгагдав — ${receipt.documentNo}, ${receipt.date}`,
      },
      tx
    );
  });

  revalidateProcurement();
}

export async function deleteGoodsReceipt(input: {
  id: string;
}): Promise<ActionResult> {
  try {
    await deleteGoodsReceiptCore(input);
    return {};
  } catch (caught) {
    return actionError(
      "deleteGoodsReceipt",
      caught,
      "Хүлээн авалт устгагдсангүй"
    );
  }
}

// ── PO-гоос АП нэхэмжлэх ────────────────────────────────────────────────────

/**
 * PO-гийн нэхэмжлээгүй үлдэгдлээр АП нэхэмжлэх (docs/procurement §3.3 ③④).
 * Бичилтийг АР/АП модуль өөрөө хийнэ (`createArApDocument`) — PO-той баримтын
 * бараа/бүрэлдэхүүн мөр нь ӨГЛӨГИЙН ТҮР ДАНС руу бичигдэнэ (§8).
 */
async function createApInvoiceFromPoCore(data: {
  purchaseOrderId: string;
  date: string;
  dueDate?: string;
  exchangeRate?: number;
  description?: string;
  documentNo?: string;
  externalRef?: string;
  postNow?: boolean;
  lines?: {
    purchaseOrderLineId: string;
    quantity: number;
    unitPrice?: number;
  }[];
  costLines?: { costComponentId: string; amount: number; description?: string }[];
  otherLines?: { account: string; amount: number; description?: string }[];
}): Promise<{ id: string; documentNo: string; dedup?: boolean }> {
  const { orgId, userId } = await requireModuleAction(
    PROCUREMENT_MODULE_KEY,
    data.postNow ? "post" : "write"
  );
  assertDate(data.date, "Огноо");
  if (data.dueDate) assertDate(data.dueDate, "Төлөх огноо");

  const externalRef = cleanText(data.externalRef);
  if (externalRef) {
    const existing = await db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.externalRef, externalRef)
      ),
      columns: { id: true, documentNo: true },
    });
    if (existing)
      return { id: existing.id, documentNo: existing.documentNo, dedup: true };
  }

  const order = await requirePurchaseOrder(orgId, data.purchaseOrderId);
  if (order.status === "closed")
    throw new Error("[PO_CLOSED] Хаагдсан захиалгад нэхэмжлэх нэмэгдэхгүй");
  if (order.status !== "open")
    throw new Error("[PO_NOT_OPEN] Зөвхөн нээлттэй захиалгад нэхэмжлэх үүсгэнэ");

  const counterparty = await loadSupplier(orgId, order.counterpartyId);
  const detail = await requirePurchaseOrderDetail(orgId, order.id);
  const roles = await loadCostingAccountSettings(orgId, userId);
  const apClearing = roles.apClearingAccountNumber;
  await assertEnabledMainAccount(orgId, apClearing);

  const rate = await resolveOfficialRate(
    order.currency,
    data.date,
    data.exchangeRate
  );

  type InvoiceLine = {
    account: string;
    description: string;
    amount: number;
    itemId?: string;
    quantity?: number;
    warehouseId?: string;
    purchaseOrderLineId?: string;
    unitPrice?: number;
    costComponentId?: string;
  };
  const lines: InvoiceLine[] = [];

  // ① Барааны мөрүүд — хоосон бол нэхэмжлээгүй үлдэгдэл × PO нэгж үнэ.
  const byId = new Map(detail.lines.map((line) => [line.id, line]));
  const requested: {
    purchaseOrderLineId: string;
    quantity: number;
    unitPrice?: number;
  }[] =
    data.lines && data.lines.length > 0
      ? data.lines
      : detail.lines
          .map((line) => ({
            purchaseOrderLineId: line.id,
            quantity: round4(line.quantity - line.invoicedQuantity),
          }))
          .filter((line) => line.quantity > QTY_EPSILON);

  for (const line of requested) {
    const poLine = byId.get(line.purchaseOrderLineId);
    if (!poLine) throw new Error("Захиалгын мөр олдсонгүй");
    const quantity = round4(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Тоо хэмжээ 0-ээс их байна");
    const remaining = round4(poLine.quantity - poLine.invoicedQuantity);
    if (quantity > remaining + QTY_EPSILON)
      throw new Error(
        `[OVER_INVOICED] ${poLine.itemCode}: нэхэмжлэх үлдэгдэл ${remaining}, оруулсан ${quantity}`
      );
    const unitPrice = round4(Number(line.unitPrice ?? poLine.unitPrice));
    if (!(unitPrice > 0)) throw new Error("Нэгж үнэ 0-ээс их байна");
    lines.push({
      account: apClearing,
      description: poLine.description || `${poLine.itemCode} ${poLine.itemName}`,
      amount: roundMoney(quantity * unitPrice),
      itemId: poLine.itemId,
      quantity,
      warehouseId: poLine.warehouseId ?? order.warehouseId ?? undefined,
      purchaseOrderLineId: poLine.id,
      unitPrice,
    });
  }

  // ② Нэмэлт зардлын мөрүүд (гааль, тээвэр …) — бүрэлдэхүүнтэй, капиталжина.
  if (data.costLines && data.costLines.length > 0) {
    const components = await loadCostComponents(orgId, { activeOnly: true });
    for (const costLine of data.costLines) {
      const component = components.find(
        (candidate) => candidate.id === costLine.costComponentId
      );
      if (!component)
        throw new Error("Идэвхтэй өртгийн бүрэлдэхүүн олдсонгүй");
      const amount = roundMoney(Number(costLine.amount));
      if (!(amount > 0)) throw new Error("Зардлын дүн 0-ээс их байна");
      lines.push({
        account: apClearing,
        description: costLine.description?.trim() || component.name,
        amount,
        purchaseOrderLineId: undefined,
        costComponentId: component.id,
      });
    }
  }

  // ③ Капиталжихгүй мөрүүд (импортын НӨАТ г.м) — данс ИЛ өгөгдөнө.
  if (data.otherLines && data.otherLines.length > 0)
    for (const otherLine of data.otherLines) {
      const account = otherLine.account.trim();
      if (!account) throw new Error("Данс сонгоно уу");
      const amount = roundMoney(Number(otherLine.amount));
      if (!(amount > 0)) throw new Error("Мөрийн дүн 0-ээс их байна");
      lines.push({
        account,
        description: otherLine.description?.trim() || "",
        amount,
      });
    }

  if (lines.length === 0)
    throw new Error(
      "Нэхэмжлэх үүсгэх мөр алга — нэхэмжлээгүй үлдэгдэл болон нэмэлт зардал хоосон"
    );

  const controlAccountNumber =
    counterparty.defaultPayableAccountNumber ||
    (await loadArApSegmentData(orgId)).defaultAccountNumbers.payable;
  if (!controlAccountNumber)
    throw new Error(
      "Өглөгийн хяналтын данс тодорхойгүй — харилцагчийн default дансыг тохируулна уу"
    );

  const dueDate =
    data.dueDate ??
    new Date(
      new Date(`${data.date}T00:00:00Z`).getTime() +
        counterparty.paymentTermsDays * 86_400_000
    )
      .toISOString()
      .slice(0, 10);

  const description =
    data.description?.trim() ||
    `[${order.documentNo}] ${counterparty.name} — нийлүүлэгчийн нэхэмжлэх`;

  const created = unwrapAction(
    await createArApDocument({
      documentType: "ap_bill",
      documentNo: cleanText(data.documentNo) ?? undefined,
      counterpartyId: counterparty.id,
      date: data.date,
      dueDate,
      currency: order.currency,
      exchangeRate: rate.rate,
      controlAccountNumber,
      description,
      purchaseOrderId: order.id,
      lines,
      postNow: data.postNow,
      externalRef: externalRef ?? undefined,
    })
  );

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: data.postNow ? "create_invoice_posted" : "create_invoice",
    entityType: "purchase_order",
    entityId: order.id,
    summary: `Захиалгын нэхэмжлэх ${data.postNow ? "бичигдэв" : "үүслээ"} — ${order.documentNo} → ${created.documentNo}, ${data.date}, ханш ${rate.rate}`,
  });

  revalidateProcurement();
  return { id: created.id, documentNo: created.documentNo };
}

export async function createApInvoiceFromPo(
  data: Parameters<typeof createApInvoiceFromPoCore>[0]
): Promise<ActionResult<{ id: string; documentNo: string; dedup?: boolean }>> {
  try {
    return await createApInvoiceFromPoCore(data);
  } catch (caught) {
    return actionError(
      "createApInvoiceFromPo",
      caught,
      "Нэхэмжлэх үүсгэгдсэнгүй"
    );
  }
}

// ── Панелийн өгөгдөл (§6) ────────────────────────────────────────────────────

export async function getPurchaseOrderPanelData(purchaseOrderId?: string): Promise<
  | { ok: true; data: PurchaseOrderPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" }
> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId } = active;

  const [
    detail,
    counterpartyRows,
    inventoryOptions,
    components,
    roles,
    attachmentResult,
  ] = await Promise.all([
    purchaseOrderId
      ? loadPurchaseOrderDetail(orgId, purchaseOrderId)
      : Promise.resolve(null),
    loadArApCounterparties(orgId),
    loadArApInventoryOptions(orgId),
    loadCostComponents(orgId, { activeOnly: true }),
    loadCostingAccountSettings(orgId),
    purchaseOrderId
      ? listAttachments(PO_BUSINESS_OBJECT, purchaseOrderId)
      : Promise.resolve({ items: [] }),
  ]);
  if (purchaseOrderId && !detail) return { ok: false, code: "not-found" };

  let supplier: PurchaseOrderPanelData["supplier"] = null;
  if (detail) {
    const base = counterpartyRows.find(
      (row) => row.id === detail.counterpartyId
    );
    if (base) {
      const [payableRows, orderRows] = await Promise.all([
        db
          .select({
            balance: sql<string>`coalesce(sum(${arApDocuments.baseTotalAmount} - ${arApDocuments.basePaidAmount}), 0)`,
          })
          .from(arApDocuments)
          .where(
            and(
              eq(arApDocuments.organizationId, orgId),
              eq(arApDocuments.counterpartyId, base.id),
              eq(arApDocuments.documentType, "ap_bill"),
              inArray(arApDocuments.status, ["posted", "partially_paid"])
            )
          ),
        db
          .select({ total: sql<string>`count(*)` })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.organizationId, orgId),
              eq(purchaseOrders.counterpartyId, base.id),
              ne(purchaseOrders.id, detail.id)
            )
          ),
      ]);
      supplier = {
        ...base,
        openPayableMnt: roundMoney(Number(payableRows[0]?.balance ?? 0)),
        previousOrders: Number(orderRows[0]?.total ?? 0),
      };
    }
  }

  return {
    ok: true,
    data: {
      detail,
      counterparties: counterpartyRows,
      inventoryItems: inventoryOptions.inventoryItems,
      warehouses: inventoryOptions.warehouses,
      costComponents: components.map((component) => ({
        id: component.id,
        code: component.code,
        name: component.name,
      })),
      roles: {
        clearingAccountNumber: roles.clearingAccountNumber,
        apClearingAccountNumber: roles.apClearingAccountNumber,
      },
      supplier,
      attachments: attachmentResult.items ?? [],
      today: todayIso(),
    },
  };
}

export async function getGoodsReceiptPanelData(input: {
  receiptId?: string;
  purchaseOrderId?: string;
}): Promise<
  | { ok: true; data: GoodsReceiptPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" }
> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId } = active;

  const receipt = input.receiptId
    ? await loadGoodsReceiptDetail(orgId, input.receiptId)
    : null;
  if (input.receiptId && !receipt) return { ok: false, code: "not-found" };

  const purchaseOrderId = receipt?.purchaseOrderId ?? input.purchaseOrderId;
  const [purchaseOrder, inventoryOptions] = await Promise.all([
    purchaseOrderId
      ? loadPurchaseOrderDetail(orgId, purchaseOrderId)
      : Promise.resolve(null),
    loadArApInventoryOptions(orgId),
  ]);
  if (purchaseOrderId && !purchaseOrder)
    return { ok: false, code: "not-found" };

  const remaining: GoodsReceiptRemainingLine[] = (purchaseOrder?.lines ?? []).map(
    (line) => ({
      purchaseOrderLineId: line.id,
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      unit: line.unit,
      unitPrice: line.unitPrice,
      orderedQuantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      remainingQuantity: Math.max(
        0,
        round4(line.quantity - line.receivedQuantity)
      ),
      warehouseId: line.warehouseId,
    })
  );

  return {
    ok: true,
    data: {
      receipt,
      purchaseOrder,
      warehouses: inventoryOptions.warehouses,
      remaining,
      today: todayIso(),
    },
  };
}

/** Панель/UI-д ханш татах (client шууд Монголбанк руу fetch хийхгүй). */
export async function fetchOfficialRate(input: {
  currency: string;
  date: string;
}): Promise<ActionResult<{ rate: number; rateDate: string }>> {
  try {
    await getActiveOrg();
    assertDate(input.date, "Огноо");
    const lookup = await getOfficialRateForDate(input.currency, input.date);
    return { rate: lookup.rate, rateDate: lookup.rateDate };
  } catch (caught) {
    return actionError("fetchOfficialRate", caught, "Ханш татагдсангүй");
  }
}

// ── Орлогдох өртгийн (landed cost) хураангуй ────────────────────────────────

async function getLandedCostSummaryCore(input: { purchaseOrderId: string }): Promise<{
  currency: string;
  items: {
    itemId: string;
    itemCode: string;
    itemName: string;
    quantity: number;
    purchaseMnt: number;
    components: { name: string; amount: number }[];
    landedTotal: number;
    unitLanded: number;
  }[];
}> {
  const { orgId } = await requireModuleAction(PROCUREMENT_MODULE_KEY, "read");
  const detail = await requirePurchaseOrderDetail(orgId, input.purchaseOrderId);

  // PO объектод холбогдсон өртгийн бичилтүүд (буцаагдсаныг хасна).
  const entries = await db.query.costEntries.findMany({
    where: and(
      eq(costEntries.organizationId, orgId),
      eq(costEntries.businessObjectType, PO_BUSINESS_OBJECT),
      eq(costEntries.businessObjectId, input.purchaseOrderId),
      inArray(costEntries.status, ["draft", "posted"])
    ),
  });

  // Бүрэлдэхүүний нэрс — лавлахаас (кодод хаалттай жагсаалт байхыг spec
  // хориглодог тул нэрийг мастер датагаас уншина).
  const components = await loadCostComponents(orgId);
  const componentNameById = new Map(
    components.map((component) => [component.id, component.name])
  );

  const purchaseByItem = new Map<string, number>();
  const componentsByItem = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    if (!entry.itemId) continue;
    const amount = Number(entry.amount);
    if (entry.entryType === "receipt_capitalize") {
      purchaseByItem.set(
        entry.itemId,
        roundMoney((purchaseByItem.get(entry.itemId) ?? 0) + amount)
      );
      continue;
    }
    if (entry.entryType !== "landed_cost") continue;
    const name =
      (entry.costComponentId
        ? componentNameById.get(entry.costComponentId)
        : null) ?? "Нэмэлт зардал";
    const bucket = componentsByItem.get(entry.itemId) ?? new Map<string, number>();
    bucket.set(name, roundMoney((bucket.get(name) ?? 0) + amount));
    componentsByItem.set(entry.itemId, bucket);
  }

  // Бараа бүрийн хүлээн авсан тоо — PO мөрүүдээс нэгтгэнэ.
  const quantityByItem = new Map<string, number>();
  const itemMeta = new Map<string, { code: string; name: string }>();
  for (const line of detail.lines) {
    quantityByItem.set(
      line.itemId,
      round4((quantityByItem.get(line.itemId) ?? 0) + line.receivedQuantity)
    );
    if (!itemMeta.has(line.itemId))
      itemMeta.set(line.itemId, { code: line.itemCode, name: line.itemName });
  }

  const items = [...itemMeta.entries()].map(([itemId, meta]) => {
    const quantity = quantityByItem.get(itemId) ?? 0;
    const purchaseMnt = purchaseByItem.get(itemId) ?? 0;
    const components = [...(componentsByItem.get(itemId) ?? new Map()).entries()]
      .map(([name, amount]) => ({ name, amount: amount as number }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const landedTotal = roundMoney(
      purchaseMnt + components.reduce((sum, part) => sum + part.amount, 0)
    );
    return {
      itemId,
      itemCode: meta.code,
      itemName: meta.name,
      quantity,
      purchaseMnt,
      components,
      landedTotal,
      unitLanded: quantity > 0 ? round4(landedTotal / quantity) : 0,
    };
  });

  return { currency: detail.currency, items };
}

export async function getLandedCostSummary(input: {
  purchaseOrderId: string;
}): Promise<
  ActionResult<{
    currency: string;
    items: {
      itemId: string;
      itemCode: string;
      itemName: string;
      quantity: number;
      purchaseMnt: number;
      components: { name: string; amount: number }[];
      landedTotal: number;
      unitLanded: number;
    }[];
  }>
> {
  try {
    return await getLandedCostSummaryCore(input);
  } catch (caught) {
    return actionError(
      "getLandedCostSummary",
      caught,
      "Орлогдох өртгийн хураангуй уншигдсангүй"
    );
  }
}
