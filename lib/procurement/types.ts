// Хангамжийн модулийн ТӨРЛҮҮД — цэвэр (plain) модуль, "use server" БИШ.
//
// "use server" файл ЗӨВХӨН async функц export хийх боломжтой тул бүх type
// энд байна (docs/procurement 01-implementation-contract.md §3). Server
// component, панель, server action гурвуул эндээс уншина.

import type { CounterpartyView } from "@/lib/arap/types";
import type {
  InventoryItemOption,
  WarehouseOption,
} from "@/lib/arap/load-data";

export type PurchaseOrderStatus = "draft" | "open" | "closed" | "cancelled";
export type GoodsReceiptStatus = "draft" | "confirmed" | "reversed";

export type PurchaseOrderLineView = {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  warehouseId: string | null;
  warehouseName: string | null;
  description: string;
  receivedQuantity: number;
  invoicedQuantity: number;
  invoicedAmount: number;
  /** Дутуу хаалтаар цуцлагдсан (хүлээн аваагүй) тоо — ENT-064. */
  cancelledQuantity: number;
};

export type PurchaseOrderView = {
  id: string;
  documentNo: string;
  counterpartyId: string;
  counterpartyName: string;
  date: string;
  expectedDate: string | null;
  currency: string;
  warehouseId: string | null;
  warehouseName: string | null;
  description: string;
  status: PurchaseOrderStatus;
  totalAmount: number;
  receivedPct: number;
  invoicedPct: number;
  approvedAt: string | null;
  /** Хаах товч дарсан цаг (аудит) — ХАРУУЛАХ огноо биш. */
  closedAt: string | null;
  /** Хаалтын журналын огноо (YYYY-MM-DD) — «Хаагдсан» огноо. */
  closeDate: string | null;
  closeVoucherId: string | null;
  closeVoucherNo: string | null;
  /** Дутуу хаалтын шалтгаан (ENT-064); null = бүрэн хаалт. */
  shortCloseReason: string | null;
  attachmentCount: number;
};

export type GoodsReceiptLineView = {
  id: string;
  purchaseOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  amountMnt: number;
  movementId: string | null;
};

export type GoodsReceiptView = {
  id: string;
  documentNo: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  counterpartyName: string;
  date: string;
  warehouseId: string;
  warehouseName: string;
  exchangeRate: number;
  rateDate: string | null;
  currency: string;
  description: string;
  status: GoodsReceiptStatus;
  totalAmountMnt: number;
  voucherId: string | null;
  lineCount: number;
};

/** PO панелийн дэлгэрэнгүй. */
export type PurchaseOrderDetail = PurchaseOrderView & {
  lines: PurchaseOrderLineView[];
  receipts: GoodsReceiptView[];
  invoices: {
    id: string;
    documentNo: string;
    date: string;
    status: string;
    /** Нэхэмжлэхийн ӨӨРИЙН валют — гааль/тээврийн нэхэмжлэх MNT байж болно (ENT-071). */
    currency: string;
    totalAmount: number;
    baseTotalAmount: number;
    isCostInvoice: boolean;
  }[];
  costLines: UnallocatedCostLineView[];
  clearing: { inventory: number; payable: number };
  blockers: string[];
  /**
   * Дутуу хаалтын урьдчилсан төлөвлөгөө (ENT-064) — нээлттэй, энгийн хаалт
   * хориглогдсон үед л; бусад үед null.
   */
  shortClose: {
    blockers: string[];
    cancelledQuantity: number;
    /** Зардалд бичигдэх илүү нэхэмжлэл, MNT (0 бол зардлын данс хэрэггүй). */
    writeOffMnt: number;
  } | null;
};

/**
 * Дутуу хаалт (ENT-064): хүлээн аваагүй үлдэгдлийг цуцалж, хүлээн авснаас
 * илүү нэхэмжилсэн дүнг `writeOffAccount` (зардал) руу бичнэ. Шалтгаан заавал.
 */
export type PoShortCloseInput = {
  reason: string;
  /** Илүү нэхэмжлэл байвал ЗААВАЛ — 6/7/8XXXXXXX зардлын данс. */
  writeOffAccount?: string | null;
};

/** "Хуваарилагдаагүй зардал" worklist-ийн мөр. */
export type UnallocatedCostLineView = {
  lineId: string;
  documentId: string;
  documentNo: string;
  date: string;
  counterpartyName: string;
  purchaseOrderId: string;
  purchaseOrderNo: string;
  costComponentId: string;
  costComponentName: string;
  amount: number;
  amountMnt: number;
  allocatedMnt: number;
  remainingMnt: number;
};

// ── Панелийн өгөгдөл (§6) ────────────────────────────────────────────────────
// "use server" файлд type export хориотой тул панелийн action-ы буцах
// хэлбэрийг мөн энд тодорхойлно.

/**
 * Хавсралтын мөр — lib/actions/attachments.ts-ийн `AttachmentView`-тэй
 * БҮТЭЦЭЭР ижил (тэр файл "use server" тул type-ыг эндээс уншина).
 */
export type PoAttachmentView = {
  id: string;
  kind: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
};

export type PurchaseOrderPanelData = {
  detail: PurchaseOrderDetail | null;
  counterparties: CounterpartyView[];
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  costComponents: { id: string; code: string; name: string }[];
  roles: { clearingAccountNumber: string; apClearingAccountNumber: string };
  supplier:
    | (CounterpartyView & { openPayableMnt: number; previousOrders: number })
    | null;
  attachments: PoAttachmentView[];
  /**
   * Дутуу хаалтын илүү нэхэмжлэлийг бичих ЗАРДЛЫН дансууд (6/7/8, идэвхтэй) —
   * зөвхөн бичих дүн байгаа үед ачаалагдана, бусад үед хоосон (ENT-064).
   */
  writeOffAccounts: { number: string; name: string }[];
  /** YYYY-MM-DD (server) — ноорог формын default огноо. */
  today: string;
};

/** Хүлээн авалтын мөрийг бөглөхөд хэрэгтэй PO мөрийн үлдэгдэл. */
export type GoodsReceiptRemainingLine = {
  purchaseOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unit: string;
  unitPrice: number;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  warehouseId: string | null;
};

export type GoodsReceiptPanelData = {
  receipt: (GoodsReceiptView & { lines: GoodsReceiptLineView[] }) | null;
  /** Захиалгын дэлгэрэнгүй — толгойн мэдээлэл, хориглолтууд. */
  purchaseOrder: PurchaseOrderDetail | null;
  warehouses: WarehouseOption[];
  remaining: GoodsReceiptRemainingLine[];
  today: string;
};
