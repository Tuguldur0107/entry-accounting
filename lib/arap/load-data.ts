import { and, desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { db } from "@/lib/db";
import {
  arApDocuments,
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
}

export type ArApDocumentDetail = ArApDocumentView & {
  lines: ArApDocumentLineView[];
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
  userId: string
): Promise<ArApSegmentData> {
  const [accounts, configs, values] = await Promise.all([
    db.query.chartOfAccounts.findMany({
      where: and(
        eq(chartOfAccounts.userId, userId),
        eq(chartOfAccounts.isEnabled, true)
      ),
      orderBy: (account, { asc }) => [asc(account.number)],
    }),
    db.query.segmentConfigs.findMany({
      where: eq(segmentConfigs.userId, userId),
    }),
    db.query.segmentValues.findMany({
      where: and(
        eq(segmentValues.userId, userId),
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
  userId: string
): Promise<CounterpartyView[]> {
  const rows = await db.query.counterparties.findMany({
    where: eq(counterparties.userId, userId),
    orderBy: (item, { asc }) => [asc(item.name)],
  });
  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    counterpartyType: item.counterpartyType,
    registerNo: item.registerNo,
    defaultReceivableAccountNumber: item.defaultReceivableAccountNumber,
    defaultPayableAccountNumber: item.defaultPayableAccountNumber,
    defaultCurrency: item.defaultCurrency,
    paymentTermsDays: item.paymentTermsDays,
    email: item.email,
    phone: item.phone,
    address: item.address,
    isActive: item.isActive,
  }));
}

/** Бараатай мөр бичихэд (АП орлого / АР зарлага) ашиглах сонголтууд. */
export async function loadArApInventoryOptions(userId: string): Promise<{
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
}> {
  const [items, warehouseRows] = await Promise.all([
    db.query.inventoryItems.findMany({
      where: and(
        eq(inventoryItems.userId, userId),
        eq(inventoryItems.isActive, true)
      ),
      orderBy: (item, { asc }) => [asc(item.code)],
    }),
    db.query.warehouses.findMany({
      where: and(eq(warehouses.userId, userId), eq(warehouses.isActive, true)),
      orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
    }),
  ]);
  return {
    inventoryItems: items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
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
  };
}

/** Бүх баримт (жагсаалт, тайлан, самбарт). */
export async function loadArApDocuments(
  userId: string
): Promise<ArApDocumentView[]> {
  const [rows, sendRows] = await Promise.all([
    db.query.arApDocuments.findMany({
      where: eq(arApDocuments.userId, userId),
      with: { counterparty: true },
      orderBy: [desc(arApDocuments.date), desc(arApDocuments.createdAt)],
    }),
    db.query.arApInvoiceSends.findMany({
      where: eq(arApInvoiceSends.userId, userId),
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
  userId: string,
  documentId: string
): Promise<ArApDocumentDetail | null> {
  const row = await db.query.arApDocuments.findFirst({
    where: and(
      eq(arApDocuments.id, documentId),
      eq(arApDocuments.userId, userId)
    ),
    with: {
      counterparty: true,
      lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] },
    },
  });
  if (!row) return null;
  return {
    ...toDocumentView(row),
    lines: row.lines.map((line) => ({
      id: line.id,
      account: line.accountNumber,
      description: line.description,
      amount: Number(line.amount),
      itemId: line.itemId,
      quantity: line.quantity != null ? Number(line.quantity) : null,
      warehouseId: line.warehouseId,
    })),
  };
}

export async function loadArApWorkspaceData() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Нэвтрэх шаардлагатай");
  const userId = session.user.id;

  const [counterpartiesView, documentsView, segmentData, inventoryOptions] =
    await Promise.all([
      loadArApCounterparties(userId),
      loadArApDocuments(userId),
      loadArApSegmentData(userId),
      loadArApInventoryOptions(userId),
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
