# Хангамжийн модуль — хэрэгжүүлэлтийн КОНТРАКТ (v1, 2026-09-11)

Зэрэгцээ ажиллаж байгаа бүх хэрэгжүүлэгч ЭНЭ ГЭРЭЭГ дагана. Функцийн нэр,
параметр, буцах утга нь энд бичсэнээс ЗӨРВӨЛ бусад хэсэг эвдэрнэ.
Дизайн: [00-proposal.md](00-proposal.md) §3–§5.

## 0. Схем (аль хэдийн хийгдсэн — зөвхөн лавлах)

`lib/db/schema.ts`-д БЭЛЭН болсон (DB-д мөн хэрэгжсэн,
`scripts/apply-procurement-ddl.ts`):

- Шинэ хүснэгт: `purchaseOrders`, `purchaseOrderLines`, `goodsReceipts`,
  `goodsReceiptLines`, `documentAttachments` (+ relations, `$inferSelect` type).
- `costingAccountSettings.apClearingAccountNumber` (default `"31000099"`).
- `counterparties.contactPerson / bankName / bankAccountNo`.
- `arApDocuments.purchaseOrderId`.
- `arApDocumentLines.purchaseOrderLineId / unitPrice / costComponentId`
  (+ CHECK `not (item_id is not null and cost_component_id is not null)`).
- `journalLines.businessObjectType / businessObjectId`.
- `costEntries.sourceLineId / businessObjectType / businessObjectId`;
  `valuationSource` дээр `"po_receipt" | "ap_line"` утга нэмэгдэв (text).
- `costAllocations.sourceLineId / purchaseOrderId`.
- `inventoryMovements.sourceType` дээр `"po_receipt"` утга (text, DDL үгүй).

## 1. Тогтмолууд, дансны рольууд

```ts
// lib/procurement/constants.ts (ШИНЭ, "use server" БИШ)
export const PO_BUSINESS_OBJECT = "purchase_order" as const;
export const PO_SOURCE_TYPE = "po_receipt" as const;
export const PROCUREMENT_MODULE_KEY = "proc" as const; // app-modules.ts key
```

Данс кодод ХАТУУ бичихийг хориглоно (JPR-006). Бүх дугаар
`loadCostingAccountSettings(orgId, userId)`-ээс:

| Роль | Багана |
|---|---|
| Бараа материалын түр данс | `clearingAccountNumber` |
| Өглөгийн түр данс | `apClearingAccountNumber` |
| Ханшийн олз / гарз | `fxGainAccountNumber` / `fxLossAccountNumber` |
| Барааны нөөц / COGS | `costing_item_settings` (`itemAccountsFor`) |

## 2. Plain (server-action БИШ) модулиуд

### 2.1 `lib/costing/posting-helpers.ts` (ШИНЭ — `lib/actions/costing.ts`-ээс ЗӨӨНӨ)

`lib/actions/costing.ts`-ийн private функцүүдийг ҮГЧЛЭН зөөж, тэндээ
`import`-оор эргүүлж хэрэглэнэ (шинээр бичихгүй, зан төлөв өөрчлөхгүй):

```ts
export async function assertEnabledMainAccount(orgId: string, accountNumber: string): Promise<void>;
export function activeSegIdsOf(configs: { segmentId: number; isEnabled: boolean }[]): number[];
/** S9 = "CO" — өртгийн журналын код үүсгэгч. */
export async function costingPostingCodeBuilder(orgId: string): Promise<(main: string) => string>;
export async function itemAccountsFor(orgId: string, userId: string, itemId: string): Promise<{ inventoryAccountNumber: string; cogsAccountNumber: string }>;
```

### 2.2 `lib/cash/exchange-rates.ts` (НЭМЭЛТ)

```ts
export type OfficialRateLookup = {
  currency: string; rate: number; rateDate: string;
  source: "mongolbank"; basis: "official"; sourceUrl: string; fetchedAt: string;
};
/** ЦЭВЭР (тесттэй): quote жагсаалтаас албан ханш. */
export function pickOfficialRate(quotes: ExchangeRateQuote[], currency: string):
  { rate: number; rateDate: string; sourceUrl: string } | null;
/** Системийн СУУРЬ ханш: Монголбанкны албан ханш огноогоор. MNT → 1.
 *  Олдохгүй бол ШИДНЭ (үнэ зохиохгүй — хэрэглэгч гараар оруулна). */
export async function getOfficialRateForDate(currency: string, date: string): Promise<OfficialRateLookup>;
```

### 2.3 `lib/procurement/close-lines.ts` (ШИНЭ, ЦЭВЭР, тесттэй)

```ts
export type PoCloseLine = {
  accountNumber: string; debit: string; credit: string;
  description: string; sortOrder: number;
  businessObjectType: "purchase_order"; businessObjectId: string;
};
/** Түр дансдын PO-гийн үлдэгдлээс хаалтын мөрүүд. Зөрүү → ханшийн олз/гарз. */
export function buildPoCloseLines(input: {
  purchaseOrderId: string;
  /** Σ(debit − credit) бараа материалын түр дансанд (хүлээгдэх нь ≤ 0 = Cr). */
  invClearingBalance: number;
  /** Σ(debit − credit) өглөгийн түр дансанд (хүлээгдэх нь ≥ 0 = Dr). */
  apClearingBalance: number;
  accounts: { invClearing: string; apClearing: string; fxGain: string; fxLoss: string };
  buildCode: (main: string) => string;
  description: string;
}): PoCloseLine[];
```

Дүрэм: `invCredit = −invClearingBalance`, `apDebit = apClearingBalance`;
`Dr invClearing invCredit`, `Cr apClearing apDebit`,
`diff = apDebit − invCredit` → `diff > 0.01` бол `Dr fxLoss diff`,
`diff < −0.01` бол `Cr fxGain −diff`. Чиглэл буруу (сөрөг) бол ШИДНЭ.

### 2.4 `lib/procurement/po-math.ts` (ШИНЭ, ЦЭВЭР, тесттэй)

```ts
export type PoLineProgress = { ordered: number; received: number; invoiced: number; invoicedAmount: number; orderedAmount: number };
export function remainingToReceive(p: PoLineProgress): number;
export function remainingToInvoice(p: PoLineProgress): number;
/** PO хаах боломжтой эсэх — шалтгааны монгол текстүүдийг буцаана. */
export function poCloseBlockers(input: {
  lines: PoLineProgress[];
  /** Хуваарилагдаагүй нэмэлт зардлын мөрүүд (MNT). */
  unallocatedCostAmount: number;
  tolerance?: number; // default 0.005
}): string[];
```

## 3. `lib/procurement/types.ts` (ШИНЭ)

```ts
export type PurchaseOrderStatus = "draft" | "open" | "closed" | "cancelled";
export type GoodsReceiptStatus = "draft" | "confirmed" | "reversed";

export type PurchaseOrderLineView = {
  id: string; itemId: string; itemCode: string; itemName: string; unit: string;
  quantity: number; unitPrice: number; amount: number;
  warehouseId: string | null; warehouseName: string | null; description: string;
  receivedQuantity: number; invoicedQuantity: number; invoicedAmount: number;
};

export type PurchaseOrderView = {
  id: string; documentNo: string; counterpartyId: string; counterpartyName: string;
  date: string; expectedDate: string | null; currency: string;
  warehouseId: string | null; warehouseName: string | null;
  description: string; status: PurchaseOrderStatus; totalAmount: number;
  receivedPct: number; invoicedPct: number;
  approvedAt: string | null; closedAt: string | null; closeVoucherId: string | null;
  attachmentCount: number;
};

export type GoodsReceiptLineView = {
  id: string; purchaseOrderLineId: string; itemId: string; itemCode: string; itemName: string;
  quantity: number; unitPrice: number; amountMnt: number; movementId: string | null;
};

export type GoodsReceiptView = {
  id: string; documentNo: string; purchaseOrderId: string; purchaseOrderNo: string;
  counterpartyName: string; date: string; warehouseId: string; warehouseName: string;
  exchangeRate: number; rateDate: string | null; currency: string;
  description: string; status: GoodsReceiptStatus; totalAmountMnt: number;
  voucherId: string | null; lineCount: number;
};

/** PO панелийн дэлгэрэнгүй. */
export type PurchaseOrderDetail = PurchaseOrderView & {
  lines: PurchaseOrderLineView[];
  receipts: GoodsReceiptView[];
  invoices: { id: string; documentNo: string; date: string; status: string; totalAmount: number; baseTotalAmount: number; isCostInvoice: boolean }[];
  costLines: UnallocatedCostLineView[];
  clearing: { inventory: number; payable: number };
  blockers: string[];
};

/** "Хуваарилагдаагүй зардал" worklist-ийн мөр. */
export type UnallocatedCostLineView = {
  lineId: string; documentId: string; documentNo: string; date: string;
  counterpartyName: string; purchaseOrderId: string; purchaseOrderNo: string;
  costComponentId: string; costComponentName: string;
  amount: number; amountMnt: number; allocatedMnt: number; remainingMnt: number;
};
```

## 4. `lib/procurement/load-data.ts` (ШИНЭ, plain модуль — server component ба
action хоёул дуудна)

```ts
export async function loadPurchaseOrders(orgId: string, filter?: { status?: PurchaseOrderStatus; counterpartyId?: string; from?: string; to?: string }): Promise<PurchaseOrderView[]>;
export async function loadPurchaseOrderDetail(orgId: string, purchaseOrderId: string): Promise<PurchaseOrderDetail | null>;
export async function loadGoodsReceipts(orgId: string, filter?: { status?: GoodsReceiptStatus; purchaseOrderId?: string; from?: string; to?: string }): Promise<GoodsReceiptView[]>;
export async function loadGoodsReceiptDetail(orgId: string, receiptId: string): Promise<(GoodsReceiptView & { lines: GoodsReceiptLineView[] }) | null>;
export async function loadUnallocatedCostLines(orgId: string, filter?: { purchaseOrderId?: string; from?: string; to?: string }): Promise<UnallocatedCostLineView[]>;
export async function loadProcurementDashboard(orgId: string): Promise<{
  draftOrders: number; openOrders: number; ordersReadyToClose: number; ordersBlocked: number;
  draftReceipts: number; unallocatedLines: number; unallocatedAmountMnt: number;
  clearingInventory: number; clearingPayable: number;
  recentOrders: PurchaseOrderView[];
}>;
```

Дүрэм: бүх query `organizationId`-аар шүүгдэнэ; `receivedQuantity` нь
`goods_receipt_lines` (receipt.status = `confirmed`) -ийн нийлбэр,
`invoicedQuantity/Amount` нь `ar_ap_document_lines` (document.status ∈
`posted|partially_paid|paid|draft`, `purchaseOrderId` тааралдсан) нийлбэр.
Клирингийн үлдэгдэл `journal_lines`-ээс `businessObjectType/Id`-аар.

## 5. `lib/actions/procurement.ts` (ШИНЭ, `"use server"`)

⚠️ `"use server"` файл ЗӨВХӨН async функц export хийнэ (const/type export
хориотой — dev сервер унана). Type-ууд §3-т.

Бүх mutation: `Core` (ШИДНЭ) + wrapper (`ActionResult`, `actionError`).
Эрх: `requireModuleAction("proc", "write" | "post")`.
Огноо: `assertPeriodOpen(orgId, date)` tx-ийн ГАДНА + `assertPeriodOpenInTx(tx, orgId, date)` tx-ийн ДОТОР ПЕРВЫЙ.
Аудит: `logAuditEvent({ userId, organizationId, action, entityType: "purchase_order" | "goods_receipt", entityId, summary }, tx)`.

```ts
export async function createPurchaseOrder(data: {
  counterpartyId: string; date: string; expectedDate?: string; currency?: string;
  warehouseId?: string; description: string; documentNo?: string; externalRef?: string;
  lines: { itemId: string; quantity: number; unitPrice: number; warehouseId?: string; description?: string }[];
  approveNow?: boolean;
}): Promise<ActionResult<{ id: string; documentNo: string; dedup?: boolean }>>;

export async function updatePurchaseOrder(data: {
  id: string; date?: string; expectedDate?: string; warehouseId?: string; description?: string;
  lines?: { id?: string; itemId: string; quantity: number; unitPrice: number; warehouseId?: string; description?: string }[];
}): Promise<ActionResult<{ id: string }>>;   // ЗӨВХӨН draft|open; open-д хүлээн авсан/нэхэмжилсэн доогуур болох ёсгүй

export async function approvePurchaseOrder(input: { id: string }): Promise<ActionResult<{ id: string }>>;   // draft → open
export async function cancelPurchaseOrder(input: { id: string }): Promise<ActionResult<{ id: string }>>;    // draft|open (хүлээн авалт/нэхэмжлэхгүй) → cancelled
export async function deletePurchaseOrder(input: { id: string }): Promise<ActionResult>;                     // ЗӨВХӨН draft
/** Түр дансдыг тэгшитгэх журнал (POSTED) + status closed. */
export async function closePurchaseOrder(input: { id: string; closeDate: string }): Promise<ActionResult<{ voucherId: string }>>;
/** PO хаалтыг буцаах — хаалтын журналыг эсрэг мөрөөр буцааж status open. */
export async function reopenPurchaseOrder(input: { id: string; reversalDate?: string }): Promise<ActionResult<{ id: string }>>;

export async function createGoodsReceipt(data: {
  purchaseOrderId: string; date: string; warehouseId?: string;
  exchangeRate?: number; documentNo?: string; description?: string;
  /** Хоосон бол PO-гийн хүлээн аваагүй үлдэгдэл бүхэлдээ. */
  lines?: { purchaseOrderLineId: string; quantity: number }[];
  confirmNow?: boolean;
}): Promise<ActionResult<{ id: string; documentNo: string }>>;
export async function updateGoodsReceipt(data: { id: string; date?: string; warehouseId?: string; exchangeRate?: number; description?: string; lines?: { purchaseOrderLineId: string; quantity: number }[] }): Promise<ActionResult<{ id: string }>>; // draft л
/** Орлого confirmed + receipt_capitalize + POSTED журнал (Dr бараа / Cr бараа мат. түр данс). */
export async function confirmGoodsReceipt(input: { id: string }): Promise<ActionResult<{ id: string; voucherId: string | null; amountMnt: number }>>;
export async function reverseGoodsReceipt(input: { id: string }): Promise<ActionResult<{ id: string }>>;
export async function deleteGoodsReceipt(input: { id: string }): Promise<ActionResult>; // draft л

/** PO-гийн нэхэмжлээгүй үлдэгдлээр АП нэхэмжлэх (ноорог эсвэл postNow). */
export async function createApInvoiceFromPo(data: {
  purchaseOrderId: string; date: string; dueDate?: string; exchangeRate?: number;
  description?: string; documentNo?: string; externalRef?: string; postNow?: boolean;
  /** Хоосон бол нэхэмжлээгүй үлдэгдэл × PO нэгж үнэ. */
  lines?: { purchaseOrderLineId: string; quantity: number; unitPrice?: number }[];
  /** Нэмэлт зардлын мөрүүд (гааль, тээвэр …) — бүрэлдэхүүнтэй. */
  costLines?: { costComponentId: string; amount: number; description?: string }[];
  /** Бүрэлдэхүүнгүй, капиталжихгүй мөр (импортын НӨАТ г.м) — данс ИЛ. */
  otherLines?: { account: string; amount: number; description?: string }[];
}): Promise<ActionResult<{ id: string; documentNo: string; dedup?: boolean }>>;

/** Панелийн өгөгдөл (getArapDocPanelData-тай ижил хэлбэр). */
export async function getPurchaseOrderPanelData(purchaseOrderId?: string): Promise<
  | { ok: true; data: { /* §6-д */ } }
  | { ok: false; code: "unauthenticated" | "not-found" }
>;
export async function getGoodsReceiptPanelData(input: { receiptId?: string; purchaseOrderId?: string }): Promise<
  | { ok: true; data: { /* §6-д */ } }
  | { ok: false; code: "unauthenticated" | "not-found" }
>;
/** Панель/UI-д ханш татах (client шууд fetch хийхгүй). */
export async function fetchOfficialRate(input: { currency: string; date: string }): Promise<ActionResult<{ rate: number; rateDate: string }>>;
export async function getLandedCostSummary(input: { purchaseOrderId: string }): Promise<ActionResult<{
  currency: string;
  items: { itemId: string; itemCode: string; itemName: string; quantity: number; purchaseMnt: number; components: { name: string; amount: number }[]; landedTotal: number; unitLanded: number }[];
}>>;
```

Алдааны кодууд (`[CODE] монгол текст` — `lib/ai/tools.ts` хэв маяг):
`PO_NOT_FOUND`, `PO_NOT_OPEN`, `PO_CLOSED`, `OVER_RECEIVED`, `OVER_INVOICED`,
`PO_NOT_READY` (хаалтын нөхцөл), `GR_NOT_DRAFT`, `GR_NOT_CONFIRMED`,
`ALLOCATION_EXCEEDS_LINE`.

### 5.1 `confirmGoodsReceipt`-ийн бичилт (docs/procurement §3.3 ②)

Нэг транзакцид:
1. `assertPeriodOpenInTx(tx, orgId, gr.date)` → `pg_advisory_xact_lock(hashtext(orgId), 1)`.
2. `goods_receipts` draft → confirmed (claim, status шалгалттай).
3. Мөр бүрд `inventory_movements` `{ movementType: "receipt", status: "confirmed", confirmedAt, sourceType: "po_receipt", sourceId: grLine.id, quantity, itemId, warehouseId }`; `goods_receipt_lines.movementId` бөглөнө.
4. `amount = roundMoney(qty × poLine.unitPrice × gr.exchangeRate)`, `unitCost = amount / qty`.
5. `cost_entries` `{ entryType: "receipt_capitalize", valuationSource: "po_receipt", status: "posted", movementId, itemId, warehouseId, periodCode: gr.date.slice(0,7), date: gr.date, quantity, unitCost, amount, debitAccountNumber: itemAccountsFor(...).inventoryAccountNumber, creditAccountNumber: roles.clearingAccountNumber, businessObjectType: "purchase_order", businessObjectId: po.id, voucherId }`.
6. НЭГ `journal_vouchers` (status `posted`, `externalRef: "gr-capitalize:" + gr.id`) + мөр бүрд 2 `journal_lines` (`costEntryId`, `inventoryMovementId`, `businessObjectType/Id`).
7. `logAuditEvent` + tx гарсны дараа `revalidatePath` (`/procurement`, `/procurement/receipts`, `/inventory`, `/inventory/movements`, `/costing`, `/gl/journal`).

## 6. Панелийн өгөгдөл (`getPurchaseOrderPanelData`) — data талбарууд

```
detail: PurchaseOrderDetail | null
counterparties: CounterpartyView[]        // loadArApCounterparties (supplier|both шүүлт UI-д)
inventoryItems, warehouses                // loadArApInventoryOptions
costComponents: { id; code; name }[]       // loadCostComponents(orgId,{activeOnly:true})
roles: { clearingAccountNumber; apClearingAccountNumber }
supplier: (CounterpartyView & { openPayableMnt: number; previousOrders: number }) | null
attachments: AttachmentView[]              // listAttachments("purchase_order", id)
today: string                              // YYYY-MM-DD (server)
```

## 7. Хавсралт (attachments)

```ts
// lib/attachments/constants.ts (plain)
export const ATTACHMENT_MAX_BYTES = 8_000_000;
export const ATTACHMENT_ACCEPT: string;
export const ATTACHMENT_KIND_LABELS: Record<string, string>; // quotation, proforma, contract, invoice, packing_list, bill_of_lading, customs_declaration, certificate, other
export const PO_ATTACHMENT_KINDS: readonly { value: string; label: string }[];
export function fmtSize(bytes: number): string;

// lib/actions/attachments.ts ("use server")
export type AttachmentView = { id: string; kind: string; name: string; mediaType: string; sizeBytes: number; createdAt: string; uploadedBy: string };
export async function listAttachments(entityType: string, entityId: string): Promise<ActionResult<{ items: AttachmentView[] }>>;
export async function deleteAttachment(id: string): Promise<ActionResult>;
```

- `POST /api/attachments` — multipart (`file`, `entityType`, `entityId`, `kind`);
  `getActiveOrg()` → 401, `requireModuleAction("proc","write")` → 403,
  ≤ 8MB → 413/400, media type шалгалт, entity нь тухайн org-д хамаарах эсэх → 404,
  `logAuditEvent({ action: "attach", entityType, entityId })`,
  `Response.json({ id, name, kind, mediaType, sizeBytes, createdAt })`.
- `GET /api/attachments/[id]` — org шалгалттай (IDOR), PDF/зураг inline,
  бусад `attachment`; `filename*=UTF-8''…` (кирилл нэр), `Cache-Control: private, no-store`.
- `components/attachments/attachment-list.tsx` — ЗӨВХӨН ui-kit-ээр
  (`Button`, `IconAction`, `Icon`, `StatusBadge`, `EmptyState`, `useConfirm`,
  `LoadingRows`, `ea-form-select`). Шинэ icon бичихгүй — `attach`, `upload`,
  `download`, `delete`, `file`, `document`, `spreadsheet` registry-д бий.

## 8. АР/АП өргөтгөл

- `ArApLineInput` += `purchaseOrderLineId?`, `unitPrice?`, `costComponentId?`.
- `createArApDocumentCore` data += `purchaseOrderId?`. **`updateArApDocument` нь PO холбоосыг ЗОРИУД хүлээж авахгүй** — холбоос үүсгэх мөчид тогтож, засварт өөрчлөгдөхгүй (шалгалт баримтын одоогийн `purchaseOrderId`-гаар явна).
- PO-той баримтын бараа/бүрэлдэхүүн мөр нь `apClearingAccountNumber` байх
  ёстой (эс бөгөөс ШИДНЭ); PO-гүй баримтын бараатай мөр хуучин дүрмээр
  `clearingAccountNumber`.
- Журналын мөрүүдэд `businessObjectType: "purchase_order", businessObjectId: doc.purchaseOrderId` тавина (PO-той үед).
- `assertPurchaseOrderLines(tx, …)`: PO нь `open`, харилцагч/валют тааруулах,
  мөр бүр PO-д хамаарах, `[OVER_INVOICED]`, PO мөрийг `for update`-оор цоожлох.
- `createMovementDraftsForArApDocument`: `if (document.purchaseOrderId) return 0;`.
- PO хаагдсан бол PO-той нэхэмжлэхийг буцаах/устгах ХОРИОТОЙ (`[PO_CLOSED]`).
- `components/arap/arap-lines-grid.tsx` (ШИНЭ — arap-doc-panel.tsx-ээс ЗӨӨНӨ,
  зан төлөв хэвээр): props += `mode?: "arap" | "po_invoice" | "goods_receipt"`,
  `apClearingAccountNumber?`, `costComponents?`, `lockedItemLines?`;
  багана += `Нэгж үнэ`, `Бүрэлдэхүүн`; тоо × нэгж үнэ → дүн автоматаар.
- `components/arap/counterparty-select.tsx` (ШИНЭ — cpOptions + SearchableSelect
  зөөлт; arap-doc-panel мөн энийг хэрэглэнэ).

## 9. Өртгийн интеграци

- `loadPoAllocationTargets(purchaseOrderId)` (cost-allocation.ts) — зорилт нь
  тухайн PO-гийн `po_receipt` confirmed хөдөлгөөнүүд; `value` = Σ
  `receipt_capitalize` (D6 = (а): өмнө хуваарилсан `landed_cost` жинд ОРОХГҮЙ).
- `createCostAllocation` input += `sourceLineId?`; өгөгдвөл: мөрийг
  `for update`, баримт нь PO-той АП нэхэмжлэх, `costComponentId` мөрөөс,
  `lineMnt = amount × exchangeRate`, `Σ өмнөх + одоо ≤ lineMnt`
  (`[ALLOCATION_EXCEEDS_LINE]`), `cost_allocations.sourceLineId/purchaseOrderId`,
  `cost_entries.sourceLineId/businessObjectType/Id`, `valuationSource: "ap_line"`.
- `reverseCostAllocation(input: { allocationId: string })` (ШИНЭ) — бичилтүүдийг
  буцааж (`reverseCostEntry` логик), хуваарилалтыг устгах/reversed болгоно.
- `postCostEntry`: PO-той `landed_cost` (businessObjectId бий) → Cr
  `clearingAccountNumber` (бүрэлдэхүүний данс БИШ).
- `journal_lines`-д `businessObjectType/Id` бүх өртгийн бичилтээс дамжина.
- `po_receipt` хөдөлгөөнийг `/costing` dashboard-ийн гар үнэ оруулах
  жагсаалтаас ХАСНА; `runCosting`-ийн `receiptCosts`-д мөн алгасна.
- `po_receipt` хөдөлгөөнийг inventory-ийн delete/cancel замаар хөндөхийг
  ХОРИГЛОНО (Хангамж → Хүлээн авалт дээр буцаана).
- `clearing-reconciliation.ts`: `apClearingAccountNumber` нэмэх,
  `businessObjectType/Id`-г lineage-аас ЭРТ тооцох, PO дугаараар нэрлэх.
- `transaction-detail.ts` `SOURCE_TYPE_LABELS` += `po_receipt: "Хүлээн авалт (PO)"`.

## 10. Период / сар хаалт

- `closePeriod`: тухайн сард `confirmed` хүлээн авалттай `open` PO байвал
  шинэ код `"open-purchase-orders"`; `goods_receipts` ноорог тоолол
  draftCounts-д нэмэгдэнэ. UI текст: «Энэ сард хүлээн авалттай нээлттэй
  захиалга (PO) байна — эхлээд PO-г хаана уу.»
- `month-end.ts` `MonthEndChecklist` += `procurement: { status; openOrdersWithReceipts; draftReceipts; unallocatedCostLines; hasActivity }`, `drafts.goodsReceipts`.
- `/close` wizard-д «Хангамж — захиалгын хаалт» алхам; хаах товч
  `procurement.openOrdersWithReceipts > 0` бол идэвхгүй.

## 11. UI (ui-kit-ээс гадуур ШИНЭ component бичихгүй)

Модуль бүртгэл: `lib/constants/app-modules.ts` `{ key: "proc", nameMn: "Хангамж", navId: "procurement", group: "accounting" }`; `components/layout/modules.ts` `procurement` бүлэг (`/procurement`, `/procurement/orders`, `/procurement/receipts`, `/procurement/costs`) + `NAV_MODULE_BY_CONFIG_KEY.proc = "procurement"`; `module-switcher.tsx` icon; `quick-create.tsx` «Шинэ худалдан авалтын захиалга».

Панель: `PanelKind` += `"purchase-order" | "goods-receipt"`;
`openPurchaseOrderPanel({ purchaseOrderId?, title?, navIds? })`,
`openGoodsReceiptPanel({ receiptId?, purchaseOrderId?, title?, navIds? })`;
`panel-registry.tsx`-д бүртгэнэ.

Хуудас/component: `app/(dashboard)/procurement/{page,orders/page,receipts/page,costs/page}.tsx` (Server Component) + `components/procurement/{procurement-dashboard,purchase-orders-view,goods-receipts-view,unallocated-costs-view,supplier-card}.tsx` («use client»). Хүснэгт бүгд `DataGridDynamic`, статус `StatusBadge`, шүүлтүүр `FilterChips`, таб `PageTabs`, хоосон `EmptyState`, icon `Icon`/`IconAction`. Давхар даралт → панель.

Хуваарилалтын сонголт: суурь 3 (`value` | `quantity` | `manual`) — `ALLOCATION_BASE_LABELS` (lib/costing/allocation.ts) ашиглана, default СОНГОГДОХГҮЙ (OD-017), `manual`-д мөр бүрийн дүн гараар, Σ таарахгүй бол хадгалахгүй.

## 12. AI tools (lib/ai/tools.ts)

Шинэ tool-ууд: `create_purchase_order`, `update_purchase_order`,
`approve_purchase_order`, `close_purchase_order`, `cancel_purchase_order`,
`list_purchase_orders`, `get_purchase_order`, `create_goods_receipt`,
`confirm_goods_receipt`, `reverse_goods_receipt`, `create_ap_invoice_from_po`,
`create_cost_allocation`, `reverse_cost_allocation`, `get_landed_cost_summary`.
`create_arap_invoice` += `purchaseOrder?`, мөрийн `purchaseOrderLineId?`,
`unitPrice?`, `costComponentCode?`. `get_workflow_guide` += `purchase_order`.
Батлах/хаах/буцаах tools ЗӨВХӨН post горим + `assertPostLimit`.
Executor нь server action-уудыг л дуудна (`db.insert` ХОРИОТОЙ).

## 13. Тест

- Цэвэр: `tests/po-close-lines.test.ts` (buildPoCloseLines — ханшийн олз/гарз,
  чиглэлийн алдаа), `tests/po-math.test.ts` (үлдэгдэл, хаалтын blockers),
  `tests/exchange-rates.test.ts` (pickOfficialRate — амралтын өдөр, валют алга).
- DB: `tests/procurement-flow.test.ts` — `tests/ai-tools-flow.test.ts`-ийн
  scaffold (load-env, `createRequire("next/cache").revalidatePath = () => {}`,
  `DB_READY` skip, setupOrg + syncStandardAccounts, `runAsOrg`) дээр §4
  жишээг бүтнээр: PO → хүлээн авалт (ханш 3450) → нэхэмжлэх (3470) → гааль/
  тээвэр → 3 суурийн хуваарилалт → PO хаалт (ханшийн зөрүү, түр дансууд 0) →
  сар хаалтын хориг. Ханшийг ИЛ өгнө (Монголбанк руу хандахгүй).
- CI: `.github/workflows/ci.yml` DB тестийн жагсаалтад нэмнэ.
