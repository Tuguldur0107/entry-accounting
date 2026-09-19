import { and, between, desc, eq, inArray, ne, or, sql } from "drizzle-orm";

import { getActiveOrg } from "@/lib/auth";
import { getPeriodSelection } from "@/lib/periods/selection";
import { canAutoDefaultSegment } from "@/lib/gl/posting-code";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  arApDocuments,
  arApDocumentLines,
  chartOfAccounts,
  counterparties,
  segmentConfigs,
  segmentValues,
  inventoryItems,
  warehouses,
  arApInvoiceSends,
} from "@/lib/db/schema";
import type { ArApDocumentView, CounterpartyView } from "@/lib/arap/types";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

// ── Хуваалцсан төрлүүд ──────────────────────────────────────────────────────
// Workspace хуудас болон АР/АП баримтын панелийн server action ХОЁУЛАА эндээс
// уншдаг — query давхардуулж бичихгүй.

export interface InventoryItemOption {
  id: string;
  code: string;
  name: string;
  unit: string;
  /** Барааны бүртгэлийн борлуулах үнэ (MNT, нэгжид) — null = тогтоогоогүй. */
  salesPrice: number | null;
  /**
   * Энэ барааг СҮҮЛД борлуулсан АР нэхэмжлэхийн нэгж үнэ (баримтын валютаар,
   * буцаагдаагүй баримтаас) — бүртгэлд үнэ байхгүй үед АР мөрийн нэгж үнийг
   * нөхөх fallback. null = өмнө нь нэгж үнэтэй борлуулаагүй.
   */
  lastSalesPrice: number | null;
}

export interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

export interface ArApSegmentData {
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  defaultAccountNumbers: {
    receivable: string;
    payable: string;
  };
}

export interface ArApDocumentLineView {
  id: string;
  account: string;
  description: string;
  amount: number;
  itemId: string | null;
  quantity: number | null;
  warehouseId: string | null;
  /** Хангамж: PO мөрийн холбоос, нэгж үнэ, өртгийн бүрэлдэхүүн. */
  purchaseOrderLineId: string | null;
  unitPrice: number | null;
  costComponentId: string | null;
}

export type ArApDocumentDetail = ArApDocumentView & {
  lines: ArApDocumentLineView[];
  /** PO-той баримтын захиалгын дугаар (харагдацад). */
  purchaseOrderNo: string | null;
};

function moduleEnabled(modules: string | null | undefined) {
  const values = (modules ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) return true;
  return values.includes("ar") || values.includes("ap") || values.includes("gl");
}

function pickDefaultAccount(
  accounts: Array<{ number: string; name: string; modules: string }>,
  exact: string[],
  nameIncludes: string[]
) {
  const enabled = accounts.filter((account) => moduleEnabled(account.modules));
  const exactMatch = exact
    .map((number) => enabled.find((account) => account.number === number))
    .find(Boolean);
  if (exactMatch) return exactMatch.number;

  const nameMatch = enabled.find((account) =>
    nameIncludes.some((needle) => account.name.toLowerCase().includes(needle))
  );
  return nameMatch?.number ?? "";
}

/** Сегмент, данс, default-уудын багц — форм бүхий бүх АР/АП UI-д хэрэгтэй. */
export async function loadArApSegmentData(
  orgId: string
): Promise<ArApSegmentData> {
  const [accounts, configs, values] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.organizationId, orgId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.organizationId, orgId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.organizationId, orgId),
        eq(segmentValues.isEnabled, true)
      ),
      orderBy: (value, { asc }) => [asc(value.segmentId), asc(value.code)],
    }),
  ]);

  const configMap = new Map(configs.map((config) => [config.segmentId, config]));
  const activeSegIds = SEGMENT_DEFS.filter((definition) => {
    if (definition.id === 3) return true;
    const config = configMap.get(definition.id);
    return config?.isEnabled === true && moduleEnabled(config.modules);
  }).map((definition) => definition.id);

  const segmentOptions: Record<number, SegOption[]> = {};
  for (const id of activeSegIds) {
    segmentOptions[id] =
      id === 3
        ? accounts
            .filter((account) => moduleEnabled(account.modules))
            .map((account) => ({ code: account.number, name: account.name }))
        : values
            .filter((value) => value.segmentId === id && moduleEnabled(value.modules))
            .map((value) => ({ code: value.code, name: value.name }));
  }

  const defaultSegments: Record<number, string> = {};
  for (const id of activeSegIds) {
    if (!canAutoDefaultSegment(id)) continue;
    const options = segmentOptions[id] ?? [];
    if (options.length === 1) defaultSegments[id] = options[0].code;
  }

  const defaultAccountNumbers = {
    receivable: pickDefaultAccount(
      accounts,
      ["13110000", "12000001", "12000003", "13100000"],
      ["авлага"]
    ),
    payable: pickDefaultAccount(
      accounts,
      ["31000001", "31110000", "31000099", "33100000"],
      ["өглөг"]
    ),
  };

  return { activeSegIds, segmentOptions, defaultSegments, defaultAccountNumbers };
}

/** Харилцагчдын жагсаалт (view хэлбэрээр). */
export async function loadArApCounterparties(
  orgId: string
): Promise<CounterpartyView[]> {
  const rows = await db.query.counterparties.findMany({
    where: eq(counterparties.organizationId, orgId),
    orderBy: (item, { asc }) => [asc(item.name)],
  });
  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    code: item.code,
    counterpartyType: item.counterpartyType,
    registerNo: item.registerNo,
    defaultReceivableAccountNumber: item.defaultReceivableAccountNumber,
    defaultPayableAccountNumber: item.defaultPayableAccountNumber,
    defaultCurrency: item.defaultCurrency,
    paymentTermsDays: item.paymentTermsDays,
    email: item.email,
    phone: item.phone,
    address: item.address,
    contactPerson: item.contactPerson,
    bankName: item.bankName,
    bankAccountNo: item.bankAccountNo,
    isActive: item.isActive,
  }));
}

/** Бараатай мөр бичихэд (АП орлого / АР зарлага) ашиглах сонголтууд. */
export async function loadArApInventoryOptions(orgId: string): Promise<{
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
}> {
  const [items, warehouseRows, lastSales] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.isActive, true)
      ),
      orderBy: (item, { asc }) => [asc(item.code)],
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
      orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
    }),
    // Бараа бүрийн СҮҮЛИЙН борлуулалтын нэгж үнэ — АР нэхэмжлэхийн мөрөөс
    // (буцаагдсан баримт тооцохгүй). Бүртгэлийн борлуулах үнэ байхгүй үед
    // нэгж үнийг нөхөх лавлагаа; үнэ ЗОХИОХГҮЙ — хоёулаа байхгүй бол гараар.
    db
      .selectDistinctOn([arApDocumentLines.itemId], {
        itemId: arApDocumentLines.itemId,
        unitPrice: arApDocumentLines.unitPrice,
      })
      .from(arApDocumentLines)
      .innerJoin(arApDocuments, eq(arApDocuments.id, arApDocumentLines.documentId))
      .where(
        and(
          eq(arApDocuments.organizationId, orgId),
          eq(arApDocuments.documentType, "ar_invoice"),
          ne(arApDocuments.status, "reversed"),
          sql`${arApDocumentLines.itemId} is not null`,
          sql`${arApDocumentLines.unitPrice} is not null`
        )
      )
      .orderBy(
        arApDocumentLines.itemId,
        desc(arApDocuments.date),
        desc(arApDocumentLines.createdAt)
      ),
  ]);
  const lastSalesPriceByItem = new Map(
    lastSales
      .filter((row) => row.itemId && row.unitPrice != null)
      .map((row) => [row.itemId as string, Number(row.unitPrice)])
  );
  return {
    inventoryItems: items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      salesPrice: item.salesPrice != null ? Number(item.salesPrice) : null,
      lastSalesPrice: lastSalesPriceByItem.get(item.id) ?? null,
    })),
    warehouses: warehouseRows.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
    })),
  };
}

type DocumentRowWithCounterparty = typeof arApDocuments.$inferSelect & {
  counterparty: { name: string };
};

function toDocumentView(
  item: DocumentRowWithCounterparty,
  sendStatus: ArApDocumentView["sendStatus"] = null
): ArApDocumentView {
  return {
    sendStatus,
    id: item.id,
    documentNo: item.documentNo,
    documentType: item.documentType as ArApDocumentView["documentType"],
    counterpartyId: item.counterpartyId,
    counterpartyName: item.counterparty.name,
    date: item.date,
    dueDate: item.dueDate,
    currency: item.currency,
    exchangeRate: Number(item.exchangeRate),
    controlAccountNumber: item.controlAccountNumber,
    description: item.description,
    totalAmount: Number(item.totalAmount),
    paidAmount: Number(item.paidAmount),
    balance: Number(item.totalAmount) - Number(item.paidAmount),
    baseTotalAmount: Number(item.baseTotalAmount),
    basePaidAmount: Number(item.basePaidAmount),
    baseBalance: Number(item.baseTotalAmount) - Number(item.basePaidAmount),
    status: item.status,
    voucherId: item.voucherId,
    reversalVoucherId: item.reversalVoucherId,
    purchaseOrderId: item.purchaseOrderId,
  };
}

/**
 * Баримтууд (жагсаалт, тайлан, самбарт). `bounds` өгвөл АЖЛЫН БАГЦ л
 * ачаална — урт хугацаанд бүх түүхийг JS-д ачаалахгүй:
 *   • сонгосон тайлант үеийн баримт (огноогоор),
 *   • ҮЛДЭГДЭЛТЭЙ (нээлттэй) баримт — огноо хамаагүй (үлдэгдэл, насжилт,
 *     тэгшитгэл бүгд үүнээс),
 *   • ноорог — огноо хамаагүй (үйлдэл хүлээж буй).
 * Хаагдсан (бүрэн төлөгдсөн/буцаагдсан) хуучин баримт тайлант үеэ сонговол
 * харагдана. bounds-гүй бол бүгд (AI/экспорт зэрэг бүрэн жагсаалтад).
 */
export async function loadArApDocuments(
  orgId: string,
  bounds?: { from: string; to: string }
): Promise<ArApDocumentView[]> {
  const scope = bounds
    ? and(
        eq(arApDocuments.organizationId, orgId),
        or(
          between(arApDocuments.date, bounds.from, bounds.to),
          eq(arApDocuments.status, "draft"),
          and(
            ne(arApDocuments.status, "reversed"),
            sql`${arApDocuments.totalAmount} <> ${arApDocuments.paidAmount}`
          )
        )
      )
    : eq(arApDocuments.organizationId, orgId);
  const [rows, sendRows] = await Promise.all([
    db.query.arApDocuments.findMany({
      where: scope,
      with: { counterparty: true },
      orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    }),
    db.query.arApInvoiceSends.findMany({
      where: and(
        eq(arApInvoiceSends.organizationId, orgId),
        inArray(
          arApInvoiceSends.documentId,
          db.select({ id: arApDocuments.id }).from(arApDocuments).where(scope)
        )
      ),
    }),
  ]);
  // Баримт бүрийн илгээлтийн ХАМГИЙН АХИСАН төлөв: үзсэн > илгээсэн > null.
  const sendStatusByDocument = new Map<string, "sent" | "viewed">();
  for (const send of sendRows) {
    if (send.revokedAt) continue;
    const current = sendStatusByDocument.get(send.documentId);
    if (send.viewedAt) sendStatusByDocument.set(send.documentId, "viewed");
    else if (!current) sendStatusByDocument.set(send.documentId, "sent");
  }
  return rows.map((row) =>
    toDocumentView(row, sendStatusByDocument.get(row.id) ?? null)
  );
}

/** Нэг баримт мөрүүдтэйгээ — панелийн read-only харагдац. */
export async function loadArApDocumentDetail(
  orgId: string,
  documentId: string
): Promise<ArApDocumentDetail | null> {
  const row = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, documentId),
      eq(arApDocuments.organizationId, orgId)
    ),
    with: {
      counterparty: true,
      purchaseOrder: { columns: { documentNo: true } },
      lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] },
    },
  });
  if (!row) return null;
  return {
    ...toDocumentView(row),
    purchaseOrderNo: row.purchaseOrder?.documentNo ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      account: line.accountNumber,
      description: line.description,
      amount: Number(line.amount),
      itemId: line.itemId,
      quantity: line.quantity != null ? Number(line.quantity) : null,
      warehouseId: line.warehouseId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
      costComponentId: line.costComponentId,
    })),
  };
}

export async function loadArApWorkspaceData() {
  const { orgId } = await getActiveOrg();
  // Topbar-ийн тайлант үе — баримтын ажлын багцын хил (нээлттэй/ноорог нь
  // огноо хамаагүй орно).
  const period = await getPeriodSelection();

  const [counterpartiesView, documentsView, segmentData, inventoryOptions] =
    await Promise.all([
      loadArApCounterparties(orgId),
      loadArApDocuments(orgId, { from: period.from, to: period.to }),
      loadArApSegmentData(orgId),
      loadArApInventoryOptions(orgId),
    ]);

  return {
    counterparties: counterpartiesView,
    documents: documentsView,
    activeSegIds: segmentData.activeSegIds,
    segmentOptions: segmentData.segmentOptions,
    defaultSegments: segmentData.defaultSegments,
    defaultAccountNumbers: segmentData.defaultAccountNumbers,
    inventoryItems: inventoryOptions.inventoryItems,
    warehouses: inventoryOptions.warehouses,
  };
}
