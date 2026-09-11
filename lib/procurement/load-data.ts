// Хангамжийн УНШИХ давхарга — цэвэр (plain) модуль, "use server" БИШ.
//
// Server component (хуудас) болон server action (панель) ХОЁУЛАА эндээс
// уншина — query давхардуулж бичихгүй (lib/arap/load-data.ts загвар).
//
// Дүрмүүд (docs/procurement 01-implementation-contract.md §4):
//   • query бүр `organizationId`-аар шүүгдэнэ;
//   • `receivedQuantity` = `goods_receipt_lines` (receipt.status = confirmed);
//   • `invoicedQuantity/Amount` = `ar_ap_document_lines` (баримт нь PO-той,
//     status ∈ draft|posted|partially_paid|paid);
//   • клирингийн үлдэгдэл `journal_lines`-ээс `businessObjectType/Id`-аар
//     (posted + reversed — буцаалт нь эсрэг мөрөөр бичигддэг).

import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { roundMoney } from "@/lib/arap/accounting";
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  costAllocations,
  costComponents,
  costEntries,
  counterparties,
  documentAttachments,
  goodsReceiptLines,
  goodsReceipts,
  journalLines,
  journalVouchers,
  purchaseOrders,
} from "@/lib/db/schema";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";
import { poCloseBlockers, type PoLineProgress } from "@/lib/procurement/po-math";
import { extractMainAccount } from "@/lib/reports/balances";
import type {
  GoodsReceiptLineView,
  GoodsReceiptStatus,
  GoodsReceiptView,
  PurchaseOrderDetail,
  PurchaseOrderLineView,
  PurchaseOrderStatus,
  PurchaseOrderView,
  UnallocatedCostLineView,
} from "@/lib/procurement/types";

/**
 * PO-той нэхэмжлэхийн "тоологдох" төлвүүд — ноорог нь мөн PO-гийн
 * нэхэмжлэгдсэн дүнд орно (§4). Буцаагдсан (reversed) баримт ОРОХГҮЙ.
 *
 * ⚠️ Энэ жагсаалт нь ИЛҮҮ НЭХЭМЖЛЭХЭЭС хамгаалах (`OVER_INVOICED`) зорилготой.
 * PO ХААЛТЫН нөхцөлд `PO_INVOICE_POSTED_STATUSES`-ийг Л ашиглана — ноорог
 * нэхэмжлэх GL-д ороогүй тул хаавал хаалтын журнал бүтэн дүнг хуурамч
 * ханшийн олз болгоно.
 */
export const PO_INVOICE_COUNTED_STATUSES = [
  "draft",
  "posted",
  "partially_paid",
  "paid",
];

/** PO ХААЛТАД тоологдох — ЗӨВХӨН GL-д бичигдсэн (батлагдсан) нэхэмжлэх. */
export const PO_INVOICE_POSTED_STATUSES = [
  "posted",
  "partially_paid",
  "paid",
];

/** Хаалтыг хориглох НООРОГ өртгийн бичилтийн төрлүүд. */
export const PO_DRAFT_COST_ENTRY_TYPES = ["landed_cost", "receipt_capitalize"];

/** Бөөрөнхийллийн шуугианы хязгаар (₮). */
const MONEY_EPSILON = 0.005;

/** Жагсаалтын дээд хязгаар — бүх түүхийг хязгааргүй ачаалахыг хориглоно. */
const PURCHASE_ORDER_LIST_LIMIT = 500;

/** Самбарын "сүүлийн захиалгууд" болон нээлттэй PO-гийн дээд хязгаар. */
const DASHBOARD_RECENT_LIMIT = 50;
const DASHBOARD_OPEN_LIMIT = 200;

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Хувь — нэг аравтын бутархай хүртэл, 100-аас дээш гарч болно (илүү). */
function percentOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

// ── Дэд аггрегацууд ─────────────────────────────────────────────────────────

/** PO мөр бүрийн БАТЛАГДСАН хүлээн авалтын нийлбэр тоо. */
async function loadReceivedByLine(
  orgId: string,
  purchaseOrderIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (purchaseOrderIds.length === 0) return result;
  const rows = await db
    .select({
      lineId: goodsReceiptLines.purchaseOrderLineId,
      quantity: sql<string>`coalesce(sum(${goodsReceiptLines.quantity}), 0)`,
    })
    .from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .where(
      and(
        eq(goodsReceipts.organizationId, orgId),
        eq(goodsReceipts.status, "confirmed"),
        inArray(goodsReceipts.purchaseOrderId, purchaseOrderIds)
      )
    )
    .groupBy(goodsReceiptLines.purchaseOrderLineId);
  for (const row of rows)
    result.set(row.lineId, round4(Number(row.quantity ?? 0)));
  return result;
}

/** PO мөрийн нэхэмжлэлийн гүйцэтгэл — бүгд ба ЗӨВХӨН батлагдсан нь тусдаа. */
type InvoicedProgress = {
  quantity: number;
  amount: number;
  postedQuantity: number;
  postedAmount: number;
};

/**
 * PO мөр бүрийн нэхэмжлэгдсэн тоо ба дүн (PO валютаар).
 * Хоёр ойлголтыг ТУСГААРЛАНА: `quantity/amount` нь ноорог+батлагдсан
 * (илүү нэхэмжлэхээс хамгаална), `postedQuantity/postedAmount` нь
 * ЗӨВХӨН GL-д бичигдсэн нэхэмжлэх (PO хаалтын нөхцөл).
 */
async function loadInvoicedByLine(
  orgId: string,
  purchaseOrderIds: string[]
): Promise<Map<string, InvoicedProgress>> {
  const result = new Map<string, InvoicedProgress>();
  if (purchaseOrderIds.length === 0) return result;
  const postedFilter = inArray(
    arApDocuments.status,
    PO_INVOICE_POSTED_STATUSES
  );
  const rows = await db
    .select({
      lineId: arApDocumentLines.purchaseOrderLineId,
      quantity: sql<string>`coalesce(sum(${arApDocumentLines.quantity}), 0)`,
      amount: sql<string>`coalesce(sum(${arApDocumentLines.amount}), 0)`,
      postedQuantity: sql<string>`coalesce(sum(case when ${postedFilter} then ${arApDocumentLines.quantity} else 0 end), 0)`,
      postedAmount: sql<string>`coalesce(sum(case when ${postedFilter} then ${arApDocumentLines.amount} else 0 end), 0)`,
    })
    .from(arApDocumentLines)
    .innerJoin(
      arApDocuments,
      eq(arApDocuments.id, arApDocumentLines.documentId)
    )
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        inArray(arApDocuments.purchaseOrderId, purchaseOrderIds),
        inArray(arApDocuments.status, PO_INVOICE_COUNTED_STATUSES),
        isNotNull(arApDocumentLines.purchaseOrderLineId)
      )
    )
    .groupBy(arApDocumentLines.purchaseOrderLineId);
  for (const row of rows) {
    if (!row.lineId) continue;
    result.set(row.lineId, {
      quantity: round4(Number(row.quantity ?? 0)),
      amount: roundMoney(Number(row.amount ?? 0)),
      postedQuantity: round4(Number(row.postedQuantity ?? 0)),
      postedAmount: roundMoney(Number(row.postedAmount ?? 0)),
    });
  }
  return result;
}

/** PO бүрд холбогдсон НООРОГ нэхэмжлэхийн тоо (хаалтыг хориглоно). */
async function loadDraftInvoiceCounts(
  orgId: string,
  purchaseOrderIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (purchaseOrderIds.length === 0) return result;
  const rows = await db
    .select({
      purchaseOrderId: arApDocuments.purchaseOrderId,
      total: sql<string>`count(*)`,
    })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        inArray(arApDocuments.purchaseOrderId, purchaseOrderIds),
        eq(arApDocuments.status, "draft")
      )
    )
    .groupBy(arApDocuments.purchaseOrderId);
  for (const row of rows)
    if (row.purchaseOrderId)
      result.set(row.purchaseOrderId, Number(row.total ?? 0));
  return result;
}

/**
 * PO бүрийн НООРОГ өртгийн бичилтийн тоо (`landed_cost` /
 * `receipt_capitalize`) — батлагдаагүй бичилт GL-д ороогүй тул түр дансдын
 * үлдэгдэл дутуу байна; хаавал зөрүү нь хуурамч ханшийн олз/гарз болно.
 */
async function loadDraftCostEntryCounts(
  orgId: string,
  purchaseOrderIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (purchaseOrderIds.length === 0) return result;
  const rows = await db
    .select({
      purchaseOrderId: costEntries.businessObjectId,
      total: sql<string>`count(*)`,
    })
    .from(costEntries)
    .where(
      and(
        eq(costEntries.organizationId, orgId),
        eq(costEntries.businessObjectType, PO_BUSINESS_OBJECT),
        inArray(costEntries.businessObjectId, purchaseOrderIds),
        eq(costEntries.status, "draft"),
        inArray(costEntries.entryType, PO_DRAFT_COST_ENTRY_TYPES)
      )
    )
    .groupBy(costEntries.businessObjectId);
  for (const row of rows)
    if (row.purchaseOrderId)
      result.set(row.purchaseOrderId, Number(row.total ?? 0));
  return result;
}

/**
 * Түр дансдын PO бүрийн үлдэгдэл — `journal_lines.businessObjectType/Id`-аар.
 * posted + reversed хоёуланг тооцно: буцаалт нь эсрэг мөрөөр шинэ журналд
 * бичигддэг тул эх журналыг ХАСАХГҮЙ (аль аль нь нийлбэрт орж 0 болно).
 */
async function loadClearingByPo(
  orgId: string,
  purchaseOrderIds: string[],
  accounts: { inventory: string; payable: string }
): Promise<Map<string, { inventory: number; payable: number }>> {
  const result = new Map<string, { inventory: number; payable: number }>();
  if (purchaseOrderIds.length === 0) return result;
  const rows = await db
    .select({
      purchaseOrderId: journalLines.businessObjectId,
      accountNumber: journalLines.accountNumber,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalVouchers, eq(journalVouchers.id, journalLines.voucherId))
    .where(
      and(
        eq(journalVouchers.organizationId, orgId),
        inArray(journalVouchers.status, ["posted", "reversed"]),
        eq(journalLines.businessObjectType, PO_BUSINESS_OBJECT),
        inArray(journalLines.businessObjectId, purchaseOrderIds)
      )
    );

  for (const row of rows) {
    if (!row.purchaseOrderId) continue;
    const main = extractMainAccount(row.accountNumber);
    if (main !== accounts.inventory && main !== accounts.payable) continue;
    const bucket =
      result.get(row.purchaseOrderId) ?? { inventory: 0, payable: 0 };
    const delta = Number(row.debit) - Number(row.credit);
    if (main === accounts.inventory) bucket.inventory += delta;
    else bucket.payable += delta;
    result.set(row.purchaseOrderId, bucket);
  }
  for (const [key, value] of result)
    result.set(key, {
      inventory: roundMoney(value.inventory),
      payable: roundMoney(value.payable),
    });
  return result;
}

async function loadAttachmentCounts(
  orgId: string,
  purchaseOrderIds: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (purchaseOrderIds.length === 0) return result;
  const rows = await db
    .select({
      entityId: documentAttachments.entityId,
      total: sql<string>`count(*)`,
    })
    .from(documentAttachments)
    .where(
      and(
        eq(documentAttachments.organizationId, orgId),
        eq(documentAttachments.entityType, PO_BUSINESS_OBJECT),
        inArray(documentAttachments.entityId, purchaseOrderIds)
      )
    )
    .groupBy(documentAttachments.entityId);
  for (const row of rows) result.set(row.entityId, Number(row.total ?? 0));
  return result;
}

/**
 * Нэмэлт зардлын (бүрэлдэхүүнтэй) нэхэмжлэхийн мөрүүд + хуваарилагдсан дүн.
 * Хуваарилагдаагүй үлдэгдэлтэй мөрүүдийг Л буцаана (worklist).
 */
async function loadUnallocatedCostRows(
  orgId: string,
  filter?: {
    purchaseOrderId?: string;
    purchaseOrderIds?: string[];
    from?: string;
    to?: string;
  }
): Promise<UnallocatedCostLineView[]> {
  if (filter?.purchaseOrderIds && filter.purchaseOrderIds.length === 0)
    return [];

  const conditions = [
    eq(arApDocuments.organizationId, orgId),
    inArray(arApDocuments.status, PO_INVOICE_COUNTED_STATUSES),
    isNotNull(arApDocumentLines.costComponentId),
  ];
  if (filter?.purchaseOrderId)
    conditions.push(eq(arApDocuments.purchaseOrderId, filter.purchaseOrderId));
  if (filter?.purchaseOrderIds)
    conditions.push(
      inArray(arApDocuments.purchaseOrderId, filter.purchaseOrderIds)
    );
  if (filter?.from) conditions.push(gte(arApDocuments.date, filter.from));
  if (filter?.to) conditions.push(lte(arApDocuments.date, filter.to));

  const rows = await db
    .select({
      lineId: arApDocumentLines.id,
      amount: arApDocumentLines.amount,
      costComponentId: costComponents.id,
      costComponentName: costComponents.name,
      documentId: arApDocuments.id,
      documentNo: arApDocuments.documentNo,
      date: arApDocuments.date,
      exchangeRate: arApDocuments.exchangeRate,
      counterpartyName: counterparties.name,
      purchaseOrderId: purchaseOrders.id,
      purchaseOrderNo: purchaseOrders.documentNo,
    })
    .from(arApDocumentLines)
    .innerJoin(
      arApDocuments,
      eq(arApDocuments.id, arApDocumentLines.documentId)
    )
    .innerJoin(
      purchaseOrders,
      eq(purchaseOrders.id, arApDocuments.purchaseOrderId)
    )
    .innerJoin(
      counterparties,
      eq(counterparties.id, arApDocuments.counterpartyId)
    )
    .innerJoin(
      costComponents,
      eq(costComponents.id, arApDocumentLines.costComponentId)
    )
    .where(and(...conditions))
    .orderBy(asc(arApDocuments.date), asc(arApDocumentLines.sortOrder));

  if (rows.length === 0) return [];

  const lineIds = rows.map((row) => row.lineId);
  const allocationRows = await db
    .select({
      lineId: costAllocations.sourceLineId,
      amount: sql<string>`coalesce(sum(${costAllocations.totalAmount}), 0)`,
    })
    .from(costAllocations)
    .where(
      and(
        eq(costAllocations.organizationId, orgId),
        inArray(costAllocations.sourceLineId, lineIds)
      )
    )
    .groupBy(costAllocations.sourceLineId);
  const allocatedByLine = new Map<string, number>();
  for (const row of allocationRows)
    if (row.lineId)
      allocatedByLine.set(row.lineId, roundMoney(Number(row.amount ?? 0)));

  const views: UnallocatedCostLineView[] = [];
  for (const row of rows) {
    const amount = Number(row.amount);
    const amountMnt = roundMoney(amount * Number(row.exchangeRate));
    const allocatedMnt = allocatedByLine.get(row.lineId) ?? 0;
    const remainingMnt = roundMoney(amountMnt - allocatedMnt);
    if (remainingMnt <= MONEY_EPSILON) continue;
    views.push({
      lineId: row.lineId,
      documentId: row.documentId,
      documentNo: row.documentNo,
      date: row.date,
      counterpartyName: row.counterpartyName,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNo: row.purchaseOrderNo,
      costComponentId: row.costComponentId,
      costComponentName: row.costComponentName,
      amount: roundMoney(amount),
      amountMnt,
      allocatedMnt,
      remainingMnt,
    });
  }
  return views;
}

// ── Захиалгын багц (view + гүйцэтгэл + хориглолт) ───────────────────────────

type PurchaseOrderFilter = {
  status?: PurchaseOrderStatus;
  counterpartyId?: string;
  from?: string;
  to?: string;
  /** Дээд тал нь хэдэн захиалга уншихыг ил заана (default = жагсаалтын хязгаар). */
  limit?: number;
};

type PurchaseOrderBundle = {
  view: PurchaseOrderView;
  lines: PurchaseOrderLineView[];
  progress: PoLineProgress[];
  clearing: { inventory: number; payable: number };
  unallocatedMnt: number;
  blockers: string[];
};

async function loadPurchaseOrderBundles(
  orgId: string,
  filter?: PurchaseOrderFilter & { purchaseOrderId?: string }
): Promise<PurchaseOrderBundle[]> {
  const conditions = [eq(purchaseOrders.organizationId, orgId)];
  if (filter?.purchaseOrderId)
    conditions.push(eq(purchaseOrders.id, filter.purchaseOrderId));
  if (filter?.status) conditions.push(eq(purchaseOrders.status, filter.status));
  if (filter?.counterpartyId)
    conditions.push(eq(purchaseOrders.counterpartyId, filter.counterpartyId));
  if (filter?.from) conditions.push(gte(purchaseOrders.date, filter.from));
  if (filter?.to) conditions.push(lte(purchaseOrders.date, filter.to));

  // Бүх түүхийг хязгааргүй ачаалахыг хориглоно — нэг захиалга хүссэн үед 1,
  // бусад үед ил хязгаар эсвэл жагсаалтын дээд хязгаар.
  const limit = filter?.purchaseOrderId
    ? 1
    : Math.max(1, Math.trunc(filter?.limit ?? PURCHASE_ORDER_LIST_LIMIT));

  const rows = await db.query.purchaseOrders.findMany({
    where: and(...conditions),
    with: {
      counterparty: { columns: { name: true } },
      warehouse: { columns: { name: true } },
      lines: {
        with: {
          item: { columns: { code: true, name: true, unit: true } },
          warehouse: { columns: { name: true } },
        },
        orderBy: (line, { asc: ascending }) => [ascending(line.sortOrder)],
      },
    },
    orderBy: [desc(purchaseOrders.date), desc(purchaseOrders.createdAt)],
    limit,
  });
  if (rows.length === 0) return [];

  const purchaseOrderIds = rows.map((row) => row.id);
  const roles = await loadCostingAccountSettings(orgId);
  const [
    received,
    invoiced,
    clearing,
    attachmentCounts,
    costLines,
    draftInvoices,
    draftCostEntries,
  ] = await Promise.all([
    loadReceivedByLine(orgId, purchaseOrderIds),
    loadInvoicedByLine(orgId, purchaseOrderIds),
    loadClearingByPo(orgId, purchaseOrderIds, {
      inventory: roles.clearingAccountNumber,
      payable: roles.apClearingAccountNumber,
    }),
    loadAttachmentCounts(orgId, purchaseOrderIds),
    loadUnallocatedCostRows(orgId, { purchaseOrderIds }),
    loadDraftInvoiceCounts(orgId, purchaseOrderIds),
    loadDraftCostEntryCounts(orgId, purchaseOrderIds),
  ]);

  const unallocatedByPo = new Map<string, number>();
  for (const line of costLines)
    unallocatedByPo.set(
      line.purchaseOrderId,
      roundMoney(
        (unallocatedByPo.get(line.purchaseOrderId) ?? 0) + line.remainingMnt
      )
    );

  return rows.map((row) => {
    const lines: PurchaseOrderLineView[] = row.lines.map((line) => {
      const invoicedLine = invoiced.get(line.id);
      return {
        id: line.id,
        itemId: line.itemId,
        itemCode: line.item?.code ?? "",
        itemName: line.item?.name ?? "",
        unit: line.item?.unit ?? "",
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        amount: Number(line.amount),
        warehouseId: line.warehouseId,
        warehouseName: line.warehouse?.name ?? null,
        description: line.description,
        receivedQuantity: received.get(line.id) ?? 0,
        invoicedQuantity: invoicedLine?.quantity ?? 0,
        invoicedAmount: invoicedLine?.amount ?? 0,
      };
    });
    const progress: PoLineProgress[] = lines.map((line) => {
      const invoicedLine = invoiced.get(line.id);
      return {
        ordered: line.quantity,
        received: line.receivedQuantity,
        invoiced: line.invoicedQuantity,
        invoicedAmount: line.invoicedAmount,
        orderedAmount: line.amount,
        // Хаалтын нөхцөлд ЗӨВХӨН батлагдсан нэхэмжлэх (ноорог GL-д ороогүй).
        postedInvoiced: invoicedLine?.postedQuantity ?? 0,
        postedInvoicedAmount: invoicedLine?.postedAmount ?? 0,
      };
    });
    const orderedQty = progress.reduce((sum, line) => sum + line.ordered, 0);
    const receivedQty = progress.reduce((sum, line) => sum + line.received, 0);
    const invoicedAmount = progress.reduce(
      (sum, line) => sum + line.invoicedAmount,
      0
    );
    const totalAmount = Number(row.totalAmount);
    const unallocatedMnt = unallocatedByPo.get(row.id) ?? 0;

    const view: PurchaseOrderView = {
      id: row.id,
      documentNo: row.documentNo,
      counterpartyId: row.counterpartyId,
      counterpartyName: row.counterparty?.name ?? "",
      date: row.date,
      expectedDate: row.expectedDate,
      currency: row.currency,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse?.name ?? null,
      description: row.description,
      status: row.status as PurchaseOrderStatus,
      totalAmount,
      receivedPct: percentOf(receivedQty, orderedQty),
      invoicedPct: percentOf(invoicedAmount, totalAmount),
      approvedAt: isoOrNull(row.approvedAt),
      closedAt: isoOrNull(row.closedAt),
      closeVoucherId: row.closeVoucherId,
      attachmentCount: attachmentCounts.get(row.id) ?? 0,
    };

    return {
      view,
      lines,
      progress,
      clearing: clearing.get(row.id) ?? { inventory: 0, payable: 0 },
      unallocatedMnt,
      blockers: poCloseBlockers({
        lines: progress,
        unallocatedCostAmount: unallocatedMnt,
        draftInvoiceCount: draftInvoices.get(row.id) ?? 0,
        draftCostEntryCount: draftCostEntries.get(row.id) ?? 0,
      }),
    };
  });
}

// ── Экспортын API (§4) ──────────────────────────────────────────────────────

export async function loadPurchaseOrders(
  orgId: string,
  filter?: PurchaseOrderFilter
): Promise<PurchaseOrderView[]> {
  const bundles = await loadPurchaseOrderBundles(orgId, filter);
  return bundles.map((bundle) => bundle.view);
}

export async function loadPurchaseOrderDetail(
  orgId: string,
  purchaseOrderId: string
): Promise<PurchaseOrderDetail | null> {
  const [bundle] = await loadPurchaseOrderBundles(orgId, { purchaseOrderId });
  if (!bundle) return null;

  const [receipts, invoiceRows, costLines] = await Promise.all([
    loadGoodsReceipts(orgId, { purchaseOrderId }),
    db.query.arApDocuments.findMany({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.purchaseOrderId, purchaseOrderId)
      ),
      columns: {
        id: true,
        documentNo: true,
        date: true,
        status: true,
        totalAmount: true,
        baseTotalAmount: true,
      },
      with: { lines: { columns: { costComponentId: true } } },
      orderBy: [asc(arApDocuments.date)],
    }),
    loadUnallocatedCostRows(orgId, { purchaseOrderId }),
  ]);

  return {
    ...bundle.view,
    lines: bundle.lines,
    receipts,
    invoices: invoiceRows.map((row) => ({
      id: row.id,
      documentNo: row.documentNo,
      date: row.date,
      status: row.status,
      totalAmount: Number(row.totalAmount),
      baseTotalAmount: Number(row.baseTotalAmount),
      isCostInvoice: row.lines.some((line) => line.costComponentId != null),
    })),
    costLines,
    clearing: bundle.clearing,
    blockers: bundle.blockers,
  };
}

type GoodsReceiptRow = {
  id: string;
  documentNo: string;
  purchaseOrderId: string;
  date: string;
  warehouseId: string;
  exchangeRate: string;
  rateDate: string | null;
  description: string;
  status: string;
  voucherId: string | null;
  purchaseOrder: {
    documentNo: string;
    currency: string;
    counterparty: { name: string } | null;
  } | null;
  warehouse: { name: string } | null;
  lines: {
    id: string;
    purchaseOrderLineId: string;
    quantity: string;
    movementId: string | null;
    purchaseOrderLine: {
      unitPrice: string;
      itemId: string;
      item: { code: string; name: string } | null;
    } | null;
  }[];
};

function receiptLineViews(row: GoodsReceiptRow): GoodsReceiptLineView[] {
  const exchangeRate = Number(row.exchangeRate);
  return row.lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.purchaseOrderLine?.unitPrice ?? 0);
    return {
      id: line.id,
      purchaseOrderLineId: line.purchaseOrderLineId,
      itemId: line.purchaseOrderLine?.itemId ?? "",
      itemCode: line.purchaseOrderLine?.item?.code ?? "",
      itemName: line.purchaseOrderLine?.item?.name ?? "",
      quantity,
      unitPrice,
      amountMnt: roundMoney(quantity * unitPrice * exchangeRate),
      movementId: line.movementId,
    };
  });
}

function toGoodsReceiptView(row: GoodsReceiptRow): GoodsReceiptView {
  const lines = receiptLineViews(row);
  return {
    id: row.id,
    documentNo: row.documentNo,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderNo: row.purchaseOrder?.documentNo ?? "",
    counterpartyName: row.purchaseOrder?.counterparty?.name ?? "",
    date: row.date,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse?.name ?? "",
    exchangeRate: Number(row.exchangeRate),
    rateDate: row.rateDate,
    currency: row.purchaseOrder?.currency ?? "MNT",
    description: row.description,
    status: row.status as GoodsReceiptStatus,
    totalAmountMnt: roundMoney(
      lines.reduce((sum, line) => sum + line.amountMnt, 0)
    ),
    voucherId: row.voucherId,
    lineCount: lines.length,
  };
}

const goodsReceiptWith = {
  purchaseOrder: {
    columns: { documentNo: true, currency: true },
    with: { counterparty: { columns: { name: true } } },
  },
  warehouse: { columns: { name: true } },
  lines: {
    with: {
      purchaseOrderLine: {
        columns: { unitPrice: true, itemId: true },
        with: { item: { columns: { code: true, name: true } } },
      },
    },
  },
} as const;

export async function loadGoodsReceipts(
  orgId: string,
  filter?: {
    status?: GoodsReceiptStatus;
    purchaseOrderId?: string;
    from?: string;
    to?: string;
  }
): Promise<GoodsReceiptView[]> {
  const conditions = [eq(goodsReceipts.organizationId, orgId)];
  if (filter?.status) conditions.push(eq(goodsReceipts.status, filter.status));
  if (filter?.purchaseOrderId)
    conditions.push(eq(goodsReceipts.purchaseOrderId, filter.purchaseOrderId));
  if (filter?.from) conditions.push(gte(goodsReceipts.date, filter.from));
  if (filter?.to) conditions.push(lte(goodsReceipts.date, filter.to));

  const rows = await db.query.goodsReceipts.findMany({
    where: and(...conditions),
    with: goodsReceiptWith,
    orderBy: [desc(goodsReceipts.date), desc(goodsReceipts.createdAt)],
  });
  return rows.map((row) => toGoodsReceiptView(row as GoodsReceiptRow));
}

export async function loadGoodsReceiptDetail(
  orgId: string,
  receiptId: string
): Promise<(GoodsReceiptView & { lines: GoodsReceiptLineView[] }) | null> {
  const row = await db.query.goodsReceipts.findFirst({
    where: and(
      eq(goodsReceipts.id, receiptId),
      eq(goodsReceipts.organizationId, orgId)
    ),
    with: goodsReceiptWith,
  });
  if (!row) return null;
  const typed = row as GoodsReceiptRow;
  return { ...toGoodsReceiptView(typed), lines: receiptLineViews(typed) };
}

export async function loadUnallocatedCostLines(
  orgId: string,
  filter?: { purchaseOrderId?: string; from?: string; to?: string }
): Promise<UnallocatedCostLineView[]> {
  return await loadUnallocatedCostRows(orgId, filter);
}

export async function loadProcurementDashboard(orgId: string): Promise<{
  draftOrders: number;
  openOrders: number;
  ordersReadyToClose: number;
  ordersBlocked: number;
  draftReceipts: number;
  unallocatedLines: number;
  unallocatedAmountMnt: number;
  clearingInventory: number;
  clearingPayable: number;
  recentOrders: PurchaseOrderView[];
}> {
  // Тоолуурууд SQL count-аар — бүх түүхийн PO-г санах ойд ачаалахгүй.
  // Түр дансдын үлдэгдэл нь ЗӨВХӨН НЭЭЛТТЭЙ захиалгад үлддэг (хаагдсан PO
  // тэгширсэн, ноорог/цуцлагдсанд бичилт байхгүй) тул багц ачааллыг
  // нээлттэй захиалга + сүүлийн N захиалгаар хязгаарлана.
  const [statusRows, draftReceiptRows, unallocated, openBundles, recentBundles] =
    await Promise.all([
      db
        .select({
          status: purchaseOrders.status,
          total: sql<string>`count(*)`,
        })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.organizationId, orgId))
        .groupBy(purchaseOrders.status),
      db
        .select({ total: sql<string>`count(*)` })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.organizationId, orgId),
            eq(goodsReceipts.status, "draft")
          )
        ),
      loadUnallocatedCostRows(orgId),
      loadPurchaseOrderBundles(orgId, {
        status: "open",
        limit: DASHBOARD_OPEN_LIMIT,
      }),
      loadPurchaseOrderBundles(orgId, { limit: DASHBOARD_RECENT_LIMIT }),
    ]);

  const countByStatus = new Map<string, number>();
  for (const row of statusRows)
    countByStatus.set(row.status, Number(row.total ?? 0));

  return {
    draftOrders: countByStatus.get("draft") ?? 0,
    openOrders: countByStatus.get("open") ?? 0,
    ordersReadyToClose: openBundles.filter(
      (bundle) => bundle.blockers.length === 0
    ).length,
    ordersBlocked: openBundles.filter((bundle) => bundle.blockers.length > 0)
      .length,
    draftReceipts: Number(draftReceiptRows[0]?.total ?? 0),
    unallocatedLines: unallocated.length,
    unallocatedAmountMnt: roundMoney(
      unallocated.reduce((sum, line) => sum + line.remainingMnt, 0)
    ),
    clearingInventory: roundMoney(
      openBundles.reduce((sum, bundle) => sum + bundle.clearing.inventory, 0)
    ),
    clearingPayable: roundMoney(
      openBundles.reduce((sum, bundle) => sum + bundle.clearing.payable, 0)
    ),
    recentOrders: recentBundles.slice(0, 8).map((bundle) => bundle.view),
  };
}
