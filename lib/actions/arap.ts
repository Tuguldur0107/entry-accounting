"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";

import {
  getActiveOrg,
  requireAnyModuleAction,
  requireModuleAction,
} from "@/lib/auth";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arApSettlements,
  cashDocuments,
  chartOfAccounts,
  costComponents,
  counterparties,
  inventoryMovements,
  journalLines,
  journalVouchers,
  purchaseOrderLines,
  purchaseOrders,
} from "@/lib/db/schema";
import type {
  ArApDocumentType,
  ArApLineInput,
  CounterpartyView,
} from "@/lib/arap/types";
import {
  loadArApCounterparties,
  loadArApDocumentDetail,
  loadArApInventoryOptions,
  loadArApSegmentData,
  type ArApDocumentDetail,
  type InventoryItemOption,
  type WarehouseOption,
} from "@/lib/arap/load-data";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { calculateBaseAmount, roundMoney } from "@/lib/arap/accounting";
import { extractMainAccount } from "@/lib/reports/balances";
import {
  createMovementDraftsForArApDocument,
  syncInventoryDraftForVoucher,
} from "@/lib/inventory/sync-sources";
import { syncFixedAssetDraftForVoucher } from "@/lib/fa/sync-sources";
import {
  loadCostComponents,
  loadCostingAccountSettings,
} from "@/lib/costing/master-data";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";
import { inventoryItems, warehouses } from "@/lib/db/schema";
import { logAuditEvent } from "@/lib/audit";
import { actionError, type ActionResult } from "@/lib/action-result";

/** Баримтын төрөл → эрхийн модулийн түлхүүр (АР/АП тусдаа тохирно). */
function permissionModuleOf(documentType: string): string {
  return documentType === "ar_invoice" ? "ar" : "ap";
}

/** Транзакцийн handle (assertPeriodOpenInTx-тэй ижил дүгнэлт). */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Тоо хэмжээний нарийвчлал — numeric(18,4). */
function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function revalidateArAp() {
  for (const root of ["/arap", "/receivables", "/payables"]) {
    revalidatePath(root);
    revalidatePath(`${root}/counterparties`);
    revalidatePath(`${root}/documents`);
    revalidatePath(`${root}/reports`);
    revalidatePath(`${root}/settings`);
  }
  revalidatePath("/gl/journal");
  revalidatePath("/gl/reports");
}

function cleanText(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function assertDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} буруу байна`);
}

function assertAmount(value: number, label = "Дүн") {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} 0-ээс их байна`);
}

async function assertEnabledMainAccount(orgId: string, accountNumber: string) {
  const main = extractMainAccount(accountNumber);
  if (!main.trim())
    throw new Error("Данс сонгоогүй байна — данс сонгоод дахин хадгална уу");
  const account = await db.query.chartOfAccounts.findFirst({
    where: and(
      eq(chartOfAccounts.organizationId, orgId),
      eq(chartOfAccounts.number, main),
      eq(chartOfAccounts.isEnabled, true)
    ),
  });
  if (!account) throw new Error(`${main} идэвхтэй GL данс олдсонгүй`);
}

function documentLabel(type: ArApDocumentType) {
  return type === "ar_invoice" ? "Авлагын нэхэмжлэл" : "Өглөгийн нэхэмжлэх";
}

function nextDocumentNo(type: ArApDocumentType, date: string) {
  const prefix = type === "ar_invoice" ? "AR" : "AP";
  return `${prefix}-${date.replaceAll("-", "")}-${crypto
    .randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
}

// ── АР/АП баримтын панелийн өгөгдөл ─────────────────────────────────────────
// Панель клиентээс нээгддэг тул сонголтын өгөгдлөө (харилцагч, сегмент,
// бараа/агуулах) энэ action-аар татна. Query-нүүд нь workspace хуудасны
// loadArApWorkspaceData-тай НЭГ хэрэгжилт (lib/arap/load-data.ts).
// Алдааг throw хийхгүй — production дээр Next.js server action-ий message-ийг
// нуудаг тул код буцаана.

export type ArapDocPanelData = {
  counterparties: CounterpartyView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  /** Клирингийн данс (тохиргооноос) — бараатай АП мөр энд суана. */
  clearingAccountNumber: string;
  /**
   * Өглөгийн түр данс (тохиргооноос) — PO-той нэхэмжлэхийн бараа/
   * бүрэлдэхүүн мөр энд суана (docs/procurement §3.1).
   */
  apClearingAccountNumber: string;
  /** Өртгийн бүрэлдэхүүн (идэвхтэй) — PO-той нэмэлт зардлын мөрд. */
  costComponents: { id: string; code: string; name: string }[];
  /** Системийн default хяналтын дансууд — харилцагчид default байхгүй үед. */
  defaultAccountNumbers: { receivable: string; payable: string };
  /** documentId өгөгдсөн үед л — read-only харагдацын баримт. */
  document: ArApDocumentDetail | null;
  /** Нэхэмжлэхтэй холбогдсон төлөлтүүд — кассын баримт болон суутган тооцоо. */
  payments: {
    id: string;
    documentNo: string;
    date: string;
    baseAmount: number;
    status: string;
    /** "cash" — кассын баримт; "offset" — АР↔АП суутган тооцоо. */
    kind: "cash" | "offset";
    /** offset үед — буцаахад хэрэглэх GL воучерийн ID. */
    voucherId: string | null;
  }[];
};

export type ArapDocPanelResult =
  | { ok: true; data: ArapDocPanelData }
  | { ok: false; code: "unauthenticated" | "not-found" };

export async function getArapDocPanelData(
  documentId?: string
): Promise<ArapDocPanelResult> {
  const active = await getActiveOrg().catch(() => null);
  if (!active) return { ok: false, code: "unauthenticated" };
  const { orgId } = active;

  const [
    segmentData,
    counterpartyRows,
    inventoryOptions,
    document,
    costingAccounts,
    componentRows,
    paymentRows,
    offsetRows,
  ] = await Promise.all([
    loadArApSegmentData(orgId),
    loadArApCounterparties(orgId),
    loadArApInventoryOptions(orgId),
    documentId
      ? loadArApDocumentDetail(orgId, documentId)
      : Promise.resolve(null),
    loadCostingAccountSettings(orgId),
    loadCostComponents(orgId, { activeOnly: true }),
    documentId
      ? db.query.cashDocuments.findMany({
          where: and(
            eq(cashDocuments.organizationId, orgId),
            eq(cashDocuments.arApDocumentId, documentId)
          ),
          columns: {
            id: true,
            documentNo: true,
            date: true,
            amount: true,
            baseAmount: true,
            status: true,
          },
          orderBy: (doc, { asc }) => [asc(doc.date)],
        })
      : Promise.resolve([]),
    // Кассгүй хаалтууд — АР↔АП суутган тооцооны settlement мөрүүд.
    documentId
      ? db.query.arApSettlements.findMany({
          where: and(
            eq(arApSettlements.organizationId, orgId),
            eq(arApSettlements.documentId, documentId),
            isNull(arApSettlements.cashDocumentId)
          ),
          orderBy: (row, { asc }) => [asc(row.settlementDate)],
        })
      : Promise.resolve([]),
  ]);

  // Суутган тооцооны мөр бүрд нөгөө талын баримтын дугаарыг олж хавсаргана
  // (нэг voucherId-тай сettlement-ийн нөгөө нь).
  const offsetVoucherIds = offsetRows
    .map((row) => row.voucherId)
    .filter((value): value is string => !!value);
  const siblingRows =
    offsetVoucherIds.length > 0
      ? await db.query.arApSettlements.findMany({
          where: and(
            eq(arApSettlements.organizationId, orgId),
            inArray(arApSettlements.voucherId, offsetVoucherIds),
            ne(arApSettlements.documentId, documentId!)
          ),
          with: { document: { columns: { documentNo: true } } },
        })
      : [];
  const siblingByVoucher = new Map(
    siblingRows.map((row) => [row.voucherId, row.document?.documentNo ?? ""])
  );

  if (documentId && !document) return { ok: false, code: "not-found" };

  return {
    ok: true,
    data: {
      counterparties: counterpartyRows,
      activeSegIds: segmentData.activeSegIds,
      segmentOptions: segmentData.segmentOptions,
      defaultSegments: segmentData.defaultSegments,
      inventoryItems: inventoryOptions.inventoryItems,
      warehouses: inventoryOptions.warehouses,
      clearingAccountNumber: costingAccounts.clearingAccountNumber,
      apClearingAccountNumber: costingAccounts.apClearingAccountNumber,
      costComponents: componentRows.map((component) => ({
        id: component.id,
        code: component.code,
        name: component.name,
      })),
      defaultAccountNumbers: segmentData.defaultAccountNumbers,
      document,
      payments: [
        ...paymentRows.map((row) => ({
          id: row.id,
          documentNo: row.documentNo,
          date: row.date,
          baseAmount: Number(row.baseAmount ?? row.amount),
          status: row.status,
          kind: "cash" as const,
          voucherId: null,
        })),
        ...offsetRows.map((row) => ({
          id: row.id,
          documentNo: `Суутган тооцоо ↔ ${siblingByVoucher.get(row.voucherId) || "?"}`,
          date: row.settlementDate,
          baseAmount: Number(row.baseAmount ?? row.amount),
          status: "posted",
          kind: "offset" as const,
          voucherId: row.voucherId,
        })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

export async function createCounterparty(data: {
  name: string;
  counterpartyType: "customer" | "supplier" | "both";
  registerNo?: string;
  defaultReceivableAccountNumber?: string;
  defaultPayableAccountNumber?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  email?: string;
  phone?: string;
  address?: string;
  contactPerson?: string;
  bankName?: string;
  bankAccountNo?: string;
}) {
  const { orgId, userId } = await requireAnyModuleAction([
    ["ar", "write"],
    ["ap", "write"],
  ]);
  const name = data.name.trim();
  if (!name) throw new Error("Харилцагчийн нэр оруулна уу");
  if (!["customer", "supplier", "both"].includes(data.counterpartyType))
    throw new Error("Харилцагчийн төрөл буруу байна");

  let receivable = cleanText(data.defaultReceivableAccountNumber);
  let payable = cleanText(data.defaultPayableAccountNumber);
  // Default данс өгөгдөөгүй бол системийн default дансаар автоматаар
  // бөглөнө — нэхэмжлэх үүсгэхэд хяналтын данс хоосон үлдэж алдаа
  // өгөхөөс сэргийлнэ (AI/MCP-ээр үүсгэхэд ч мөн адил).
  if (!receivable || !payable) {
    const fallback = (await loadArApSegmentData(orgId)).defaultAccountNumbers;
    receivable = receivable ?? cleanText(fallback.receivable);
    payable = payable ?? cleanText(fallback.payable);
  }
  if (receivable) await assertEnabledMainAccount(orgId, receivable);
  if (payable) await assertEnabledMainAccount(orgId, payable);

  const [created] = await db
    .insert(counterparties)
    .values({
      userId,
      organizationId: orgId,
      name,
      counterpartyType: data.counterpartyType,
      registerNo: cleanText(data.registerNo),
      defaultReceivableAccountNumber: receivable,
      defaultPayableAccountNumber: payable,
      defaultCurrency: data.defaultCurrency?.trim().toUpperCase() || "MNT",
      paymentTermsDays: Math.max(0, Math.round(data.paymentTermsDays ?? 30)),
      email: cleanText(data.email),
      phone: cleanText(data.phone),
      address: cleanText(data.address),
      contactPerson: cleanText(data.contactPerson),
      bankName: cleanText(data.bankName),
      bankAccountNo: cleanText(data.bankAccountNo),
    })
    .returning({ id: counterparties.id });

  revalidateArAp();
  return { id: created.id };
}

/** Бүртгэгдсэн харилцагчийн мэдээллийг бүхэлд нь засна (create-тэй ижил шалгалт). */
export async function updateCounterparty(
  id: string,
  data: {
    name: string;
    counterpartyType: "customer" | "supplier" | "both";
    registerNo?: string;
    defaultReceivableAccountNumber?: string;
    defaultPayableAccountNumber?: string;
    defaultCurrency?: string;
    paymentTermsDays?: number;
    email?: string;
    phone?: string;
    address?: string;
    contactPerson?: string;
    bankName?: string;
    bankAccountNo?: string;
  }
) {
  const { orgId } = await requireAnyModuleAction([
    ["ar", "write"],
    ["ap", "write"],
  ]);
  const name = data.name.trim();
  if (!name) throw new Error("Харилцагчийн нэр оруулна уу");
  if (!["customer", "supplier", "both"].includes(data.counterpartyType))
    throw new Error("Харилцагчийн төрөл буруу байна");

  const receivable = cleanText(data.defaultReceivableAccountNumber);
  const payable = cleanText(data.defaultPayableAccountNumber);
  if (receivable) await assertEnabledMainAccount(orgId, receivable);
  if (payable) await assertEnabledMainAccount(orgId, payable);

  const [updated] = await db
    .update(counterparties)
    .set({
      name,
      counterpartyType: data.counterpartyType,
      registerNo: cleanText(data.registerNo),
      defaultReceivableAccountNumber: receivable,
      defaultPayableAccountNumber: payable,
      defaultCurrency: data.defaultCurrency?.trim().toUpperCase() || "MNT",
      paymentTermsDays: Math.max(0, Math.round(data.paymentTermsDays ?? 30)),
      email: cleanText(data.email),
      phone: cleanText(data.phone),
      address: cleanText(data.address),
      contactPerson: cleanText(data.contactPerson),
      bankName: cleanText(data.bankName),
      bankAccountNo: cleanText(data.bankAccountNo),
    })
    .where(and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId)))
    .returning({ id: counterparties.id });
  if (!updated) throw new Error("Харилцагч олдсонгүй");

  revalidateArAp();
}

/**
 * Харилцагч устгах — зөвхөн АР/АП баримтад ашиглагдаагүй харилцагч
 * устгагдана (FK ч restrict — DB давхар хамгаална). Түүхтэй харилцагчийг
 * устгавал баримтууд нь эзэнгүйдэж тайлан эвдэрдэг тул идэвхгүй болгохыг
 * заана; заавал устгах бол эхлээд баримтуудыг нь устгана.
 */
export async function deleteCounterparty(
  id: string
): Promise<ActionResult<{ name: string }>> {
  try {
    return await deleteCounterpartyCore(id);
  } catch (caught) {
    return actionError("deleteCounterparty", caught, "Харилцагч устгагдсангүй");
  }
}

async function deleteCounterpartyCore(id: string) {
  const { orgId, userId } = await requireAnyModuleAction([
    ["ar", "write"],
    ["ap", "write"],
  ]);
  const counterparty = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, id),
      eq(counterparties.organizationId, orgId)
    ),
    columns: { id: true, name: true },
  });
  if (!counterparty) throw new Error("Харилцагч олдсонгүй");

  const [usage] = await db
    .select({ count: sql<number>`count(*)` })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.counterpartyId, id)
      )
    );
  const documentCount = Number(usage?.count ?? 0);
  if (documentCount > 0)
    throw new Error(
      `${counterparty.name} — ${documentCount} баримттай тул устгах боломжгүй. Түүхтэй харилцагчийг идэвхгүй болгоно уу; заавал устгах бол эхлээд баримтуудыг нь устгана.`
    );

  await db
    .delete(counterparties)
    .where(
      and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId))
    );
  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "counterparty",
    entityId: id,
    summary: `Харилцагч устгагдав — ${counterparty.name}`,
  });

  revalidateArAp();
  return { name: counterparty.name };
}

export async function toggleCounterparty(id: string, isActive: boolean) {
  const { orgId } = await requireAnyModuleAction([
    ["ar", "write"],
    ["ap", "write"],
  ]);
  await db
    .update(counterparties)
    .set({ isActive })
    .where(and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId)));
  revalidateArAp();
}

// ── Баримтын мутацууд ────────────────────────────────────────────────────────
// *Core функцүүд алдааг ШИДДЭГ (транзакц rollback, дотоод дуудлагад хэрэгтэй);
// гадаад wrapper-ууд нь { error } УТГААР буцаана — Next.js production дээр
// шидсэн алдааны мессежийг нуудаг (React #441) тул client компонент зөвхөн
// wrapper-ыг дуудна. Server-талын дуудагч unwrapAction-аар шидэлтээ сэргээнэ.

// ── Хангамжийн захиалга (PO) — нэхэмжлэхийн шалгалтууд ──────────────────────
// docs/procurement §3.3 ③④ ба контракт §8. PO-той нэхэмжлэх нь захиалгын
// нэхэмжлээгүй үлдэгдлээс ИЛҮҮ гарч болохгүй; хаагдсан захиалгад нэхэмжлэх
// нэмэгдэхгүй. Нэхэмжлэх бүр нь PO мөрүүдийг `for update`-оор цоожилдог тул
// зэрэгцээ хоёр нэхэмжлэх цуваагаар шалгагдана (TOCTUO).

type PoCheckLine = {
  itemId: string | null;
  quantity: number | null;
  purchaseOrderLineId: string | null;
  costComponentId: string | null;
  amount: number;
};

async function assertPurchaseOrderLines(
  tx: DbTx,
  input: {
    orgId: string;
    purchaseOrderId: string;
    documentType: ArApDocumentType;
    counterpartyId: string;
    currency: string;
    lines: PoCheckLine[];
    /** Ноорог засах/батлах үед — өөрийн хадгалагдсан мөрүүдийг хасна. */
    excludeDocumentId?: string;
  }
) {
  const { orgId, purchaseOrderId } = input;
  if (input.documentType !== "ap_bill")
    throw new Error(
      "Захиалгатай (PO) нэхэмжлэх зөвхөн өглөгийн баримт байна"
    );

  // Захиалга + мөрүүдийг цоожилно — нэхэмжлэхүүд цуваагаар шалгагдана.
  await tx.execute(
    sql`select id from purchase_orders where id = ${purchaseOrderId} and organization_id = ${orgId} for update`
  );
  await tx.execute(
    sql`select id from purchase_order_lines where purchase_order_id = ${purchaseOrderId} for update`
  );

  const po = await tx.query.purchaseOrders.findFirst({
    where: and(
      eq(purchaseOrders.id, purchaseOrderId),
      eq(purchaseOrders.organizationId, orgId)
    ),
    columns: {
      id: true,
      documentNo: true,
      status: true,
      currency: true,
      counterpartyId: true,
    },
  });
  if (!po) throw new Error("[PO_NOT_FOUND] Худалдан авалтын захиалга олдсонгүй");
  if (po.status === "closed")
    throw new Error(
      `[PO_CLOSED] ${po.documentNo} захиалга хаагдсан — нэхэмжлэх нэмэх боломжгүй`
    );
  if (po.status !== "open")
    throw new Error(
      `[PO_NOT_OPEN] ${po.documentNo} захиалга нээлттэй биш — эхлээд батална уу`
    );
  // Харилцагч/валютын тааралт нь ЗӨВХӨН PO-гийн бараатай (захиалгын мөртэй
  // холбогдсон) нэхэмжлэхэд хамаарна: гааль, тээвэр, брокер зэрэг НЭМЭЛТ
  // ЗАРДЛЫН нэхэмжлэх нь өөр харилцагчаас, өөр валютаар (ихэвчлэн MNT)
  // ирдэг ч мөн PO-д холбогдож өртөгт хуваарилагдана
  // (docs/procurement §3.3 ④, §4 жишээний АП-002/АП-003).
  const hasPoGoodsLines = input.lines.some(
    (line) => line.itemId || line.purchaseOrderLineId
  );
  if (hasPoGoodsLines && po.counterpartyId !== input.counterpartyId)
    throw new Error(
      `Нэхэмжлэхийн харилцагч ${po.documentNo} захиалгын нийлүүлэгчтэй таарахгүй байна`
    );
  if (hasPoGoodsLines && po.currency !== input.currency)
    throw new Error(
      `Нэхэмжлэхийн валют (${input.currency}) захиалгын валюттай (${po.currency}) таарахгүй байна`
    );

  const poLines = await tx.query.purchaseOrderLines.findMany({
    where: eq(purchaseOrderLines.purchaseOrderId, po.id),
    columns: { id: true, itemId: true, quantity: true, amount: true },
  });
  const poLineById = new Map(poLines.map((line) => [line.id, line]));

  // Бүрэлдэхүүн нь тухайн байгууллагын ИДЭВХТЭЙ лавлахаас байх ёстой.
  const componentIds = [
    ...new Set(
      input.lines
        .map((line) => line.costComponentId)
        .filter((value): value is string => !!value)
    ),
  ];
  if (componentIds.length > 0) {
    const rows = await tx.query.costComponents.findMany({
      where: and(
        eq(costComponents.organizationId, orgId),
        inArray(costComponents.id, componentIds),
        eq(costComponents.isActive, true)
      ),
      columns: { id: true },
    });
    if (rows.length !== componentIds.length)
      throw new Error("Идэвхтэй өртгийн бүрэлдэхүүн олдсонгүй");
  }

  // Энэ баримтын мөрүүдийг PO мөр тус бүрээр нэгтгэнэ.
  const pending = new Map<string, { quantity: number; amount: number }>();
  for (const line of input.lines) {
    if (line.itemId && line.costComponentId)
      throw new Error(
        "Нэг мөрөнд бараа ба өртгийн бүрэлдэхүүн зэрэг байж болохгүй"
      );
    if (!line.itemId) {
      if (line.purchaseOrderLineId)
        throw new Error("Захиалгын мөртэй холбогдсон мөрөнд бараа заавал байна");
      continue;
    }
    if (!line.purchaseOrderLineId)
      throw new Error(
        `${po.documentNo} захиалгатай нэхэмжлэхийн бараатай мөр бүр захиалгын мөртэй холбогдоно`
      );
    const poLine = poLineById.get(line.purchaseOrderLineId);
    if (!poLine)
      throw new Error(
        `[PO_NOT_FOUND] Захиалгын мөр ${po.documentNo}-д хамаарахгүй байна`
      );
    if (poLine.itemId !== line.itemId)
      throw new Error(
        `Нэхэмжлэхийн бараа ${po.documentNo} захиалгын мөрийн бараатай таарахгүй байна`
      );
    const current = pending.get(poLine.id) ?? { quantity: 0, amount: 0 };
    pending.set(poLine.id, {
      quantity: current.quantity + (line.quantity ?? 0),
      amount: current.amount + line.amount,
    });
  }
  if (pending.size === 0) return;

  // Өмнөх нэхэмжлэхүүдийн нийлбэр (ноорог ч тооцогдоно — контракт §4).
  const priorRows = await tx
    .select({
      purchaseOrderLineId: arApDocumentLines.purchaseOrderLineId,
      quantity: sql<string>`coalesce(sum(${arApDocumentLines.quantity}), 0)`,
      amount: sql<string>`coalesce(sum(${arApDocumentLines.amount}), 0)`,
    })
    .from(arApDocumentLines)
    .innerJoin(
      arApDocuments,
      eq(arApDocumentLines.documentId, arApDocuments.id)
    )
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.purchaseOrderId, purchaseOrderId),
        inArray(arApDocuments.status, [
          "draft",
          "posted",
          "partially_paid",
          "paid",
        ]),
        isNotNull(arApDocumentLines.purchaseOrderLineId),
        input.excludeDocumentId
          ? ne(arApDocuments.id, input.excludeDocumentId)
          : undefined
      )
    )
    .groupBy(arApDocumentLines.purchaseOrderLineId);
  const priorByLine = new Map(
    priorRows.map((row) => [
      String(row.purchaseOrderLineId),
      { quantity: Number(row.quantity), amount: Number(row.amount) },
    ])
  );

  const tolerance = 0.005;
  for (const [poLineId, add] of pending) {
    const poLine = poLineById.get(poLineId)!;
    const prior = priorByLine.get(poLineId) ?? { quantity: 0, amount: 0 };
    const ordered = Number(poLine.quantity);
    const orderedAmount = Number(poLine.amount);
    const quantity = round4(prior.quantity + add.quantity);
    const amount = roundMoney(prior.amount + add.amount);
    if (quantity - ordered > tolerance)
      throw new Error(
        `[OVER_INVOICED] ${po.documentNo} захиалгын мөрийг илүү нэхэмжилж байна — захиалсан ${ordered}, нэхэмжилсэн ${quantity}`
      );
    if (amount - orderedAmount > tolerance)
      throw new Error(
        `[OVER_INVOICED] ${po.documentNo} захиалгын мөрийн дүнгээс илүү нэхэмжилж байна — захиалсан ${orderedAmount.toLocaleString("en-US")}, нэхэмжилсэн ${amount.toLocaleString("en-US")}`
      );
  }
}

/**
 * PO-той нэхэмжлэхийг буцаах/устгахын өмнө — ХААГДСАН захиалгыг хөндөхийг
 * таслана (хаалтын журнал Dr бараа мат. түр данс / Cr өглөгийн түр данс
 * тэнцээгүй үлдэх байсан).
 */
async function assertPurchaseOrderNotClosed(
  orgId: string,
  purchaseOrderId: string,
  action: string
) {
  const po = await db.query.purchaseOrders.findFirst({
    where: and(
      eq(purchaseOrders.id, purchaseOrderId),
      eq(purchaseOrders.organizationId, orgId)
    ),
    columns: { documentNo: true, status: true },
  });
  if (po?.status !== "closed") return;
  throw new Error(
    `[PO_CLOSED] ${po.documentNo} захиалга хаагдсан — нэхэмжлэхийг ${action} бол эхлээд захиалгын хаалтыг буцаана уу`
  );
}

async function createArApDocumentCore(data: {
  documentType: ArApDocumentType;
  /** Гараар өгсөн нэхэмжлэхийн дугаар — хоосон бол автоматаар үүснэ. */
  documentNo?: string;
  counterpartyId: string;
  date: string;
  dueDate: string;
  currency?: string;
  exchangeRate?: number;
  controlAccountNumber: string;
  description: string;
  lines: ArApLineInput[];
  postNow?: boolean;
  /** Гадаад системийн давтагдашгүй дугаар (eBarimt ДДТД г.м) — idempotency. */
  externalRef?: string;
  /**
   * Хангамжийн захиалга — өгөгдвөл бараа/бүрэлдэхүүн мөр нь ӨГЛӨГИЙН ТҮР
   * ДАНСанд суух ба орлогын хөдөлгөөн ҮҮСЭХГҮЙ (хүлээн авалтын баримтаас).
   */
  purchaseOrderId?: string;
}) {
  const { orgId, userId } = await requireModuleAction(
    permissionModuleOf(data.documentType),
    data.postNow ? "post" : "write"
  );
  if (!["ar_invoice", "ap_bill"].includes(data.documentType))
    throw new Error("Баримтын төрөл буруу байна");
  assertDate(data.date, "Огноо");
  assertDate(data.dueDate, "Төлөх огноо");
  if (data.dueDate < data.date)
    throw new Error("Төлөх огноо баримтын огнооноос өмнө байж болохгүй");
  // Хаагдсан периодын хамгаалалт — ноорог ч, postNow ч энэ огноогоор бичигдэнэ.
  await assertPeriodOpen(orgId, data.date);
  const description = data.description.trim();
  if (!description) throw new Error("Баримтын утга оруулна уу");

  const counterparty = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, data.counterpartyId),
      eq(counterparties.organizationId, orgId),
      eq(counterparties.isActive, true)
    ),
  });
  if (!counterparty) throw new Error("Идэвхтэй харилцагч олдсонгүй");

  const controlAccountNumber = data.controlAccountNumber.trim();
  await assertEnabledMainAccount(orgId, controlAccountNumber);

  const purchaseOrderId = data.purchaseOrderId?.trim() || null;
  if (purchaseOrderId && data.documentType !== "ap_bill")
    throw new Error("Захиалгатай (PO) нэхэмжлэх зөвхөн өглөгийн баримт байна");

  const validLines = data.lines
    .map((line) => {
      const quantity = line.itemId ? Number(line.quantity ?? 0) : null;
      const rawUnitPrice = line.unitPrice != null ? Number(line.unitPrice) : null;
      const unitPrice =
        rawUnitPrice != null && Number.isFinite(rawUnitPrice) && rawUnitPrice > 0
          ? rawUnitPrice
          : null;
      const given = Number(line.amount);
      // Нэгж үнэ өгөгдсөн ба дүн хоосон бол тоо × нэгж үнэ (grid-тэй ИЖИЛ).
      const amount =
        given > 0
          ? given
          : quantity != null && quantity > 0 && unitPrice != null
            ? roundMoney(quantity * unitPrice)
            : given;
      return {
        account: line.account.trim(),
        description: line.description.trim(),
        amount,
        itemId: line.itemId || null,
        quantity,
        warehouseId: line.itemId ? line.warehouseId || null : null,
        purchaseOrderLineId: line.purchaseOrderLineId || null,
        unitPrice,
        costComponentId: line.costComponentId || null,
      };
    })
    .filter((line) => line.account && line.amount > 0);
  if (validLines.length === 0) throw new Error("Дор хаяж нэг мөр оруулна уу");
  // Клиринг + өглөгийн түр данс тохиргооноос (JPR-006) — кодод хатуу
  // дугаар байхгүй.
  const costingRoles = await loadCostingAccountSettings(orgId, userId);
  const clearingAccount = costingRoles.clearingAccountNumber;
  const apClearingAccount = costingRoles.apClearingAccountNumber;
  for (const line of validLines) {
    assertAmount(line.amount, "Мөрийн дүн");
    await assertEnabledMainAccount(orgId, line.account);
    const lineMain = extractMainAccount(line.account);
    if (line.itemId && line.costComponentId)
      throw new Error(
        "Нэг мөрөнд бараа ба өртгийн бүрэлдэхүүн зэрэг байж болохгүй"
      );
    // Нэмэлт зардлын (бүрэлдэхүүнтэй) мөр зөвхөн PO-той нэхэмжлэхэд —
    // хуваарилалт нь барааны өртөгт капиталжина (docs/procurement §3.3 ④).
    if (line.costComponentId) {
      if (!purchaseOrderId)
        throw new Error(
          "Өртгийн бүрэлдэхүүнтэй мөр зөвхөн захиалгатай (PO) нэхэмжлэхэд бичигдэнэ"
        );
      if (lineMain !== apClearingAccount)
        throw new Error(
          `Бүрэлдэхүүнтэй мөрийн данс ${apClearingAccount} (өглөгийн түр данс) байх ёстой — хуваарилалт барааны өртөгт капиталжина`
        );
    }
    if (!line.itemId) continue;
    if (!(line.quantity! > 0))
      throw new Error("Бараатай мөрөнд тоо хэмжээ 0-ээс их байна");
    // Клирингийн сахилга: АП-ийн бараатай мөр ЗААВАЛ 14000099 клирингт
    // суана (капитализацийг өртгийн модуль Dr бараа данс / Cr клиринг гэж
    // бичдэг — шууд 14000001-д суулгавал GL давхарлана). АР-ийн бараатай
    // мөр орлогын тал тул 14-бүлэгт огт суухгүй. PO-той нэхэмжлэхэд
    // орлого нь хүлээн авалтаас бичигддэг тул ӨГЛӨГИЙН түр данс.
    if (data.documentType === "ap_bill") {
      if (purchaseOrderId && lineMain !== apClearingAccount)
        throw new Error(
          `PO-той нэхэмжлэхийн бараатай мөрийн данс ${apClearingAccount} (өглөгийн түр данс) байх ёстой — орлогын капитализаци хүлээн авалтын баримтаас бичигдэнэ`
        );
      if (!purchaseOrderId && lineMain !== clearingAccount)
        throw new Error(
          `Бараатай мөрийн данс ${clearingAccount} (клиринг) байх ёстой — өртгийн модуль капитализацийг өөрөө бичнэ`
        );
    }
    if (data.documentType === "ar_invoice" && lineMain.startsWith("14"))
      throw new Error(
        "Борлуулалтын бараатай мөр орлогын дансанд суана — COGS бичилтийг өртгийн модуль хийнэ"
      );
    // Ownership + идэвх: өөр хэрэглэгчийн бараа/агуулах холбохоос сэргийлнэ.
    const item = await db.query.inventoryItems.findFirst({
      where: and(
        eq(inventoryItems.id, line.itemId),
        eq(inventoryItems.organizationId, orgId),
        eq(inventoryItems.isActive, true)
      ),
      columns: { id: true },
    });
    if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
    if (line.warehouseId) {
      const warehouse = await db.query.warehouses.findFirst({
        where: and(
          eq(warehouses.id, line.warehouseId),
          eq(warehouses.organizationId, orgId),
          eq(warehouses.isActive, true)
        ),
        columns: { id: true },
      });
      if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
    }
  }

  const totalAmount =
    Math.round(validLines.reduce((sum, line) => sum + line.amount, 0) * 100) /
    100;
  const currency =
    data.currency?.trim().toUpperCase() || counterparty.defaultCurrency;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Валютын код буруу байна");
  const exchangeRate = currency === "MNT" ? 1 : Number(data.exchangeRate ?? 0);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0)
    throw new Error(`${currency} гүйлгээний ханш 0-ээс их байна`);
  const baseTotalAmount = calculateBaseAmount(totalAmount, exchangeRate);
  const baseLineAmounts = validLines.map(
    (line) => calculateBaseAmount(line.amount, exchangeRate)
  );
  const baseLineDifference =
    baseTotalAmount - baseLineAmounts.reduce((sum, amount) => sum + amount, 0);
  if (baseLineAmounts.length > 0) {
    baseLineAmounts[baseLineAmounts.length - 1] = roundMoney(
      baseLineAmounts[baseLineAmounts.length - 1] + baseLineDifference
    );
  }
  const status = data.postNow ? "posted" : "draft";

  // Manual invoice number wins over the generated one; it must be unique
  // per user so the cash-side picker and reports resolve it unambiguously.
  const manualNo = data.documentNo?.trim();
  if (manualNo && manualNo.length > 40)
    throw new Error("Нэхэмжлэхийн дугаар 40 тэмдэгтээс хэтрэхгүй");
  if (manualNo) {
    const duplicate = await db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.documentNo, manualNo)
      ),
      columns: { id: true },
    });
    if (duplicate)
      throw new Error(`"${manualNo}" дугаартай баримт аль хэдийн бүртгэгдсэн`);
  }
  const documentNo = manualNo || nextDocumentNo(data.documentType, data.date);

  let createdDocumentId: string | null = null;
  let createdVoucherId2: string | null = null;

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, data.date);
    // PO-той нэхэмжлэх: захиалга нээлттэй, харилцагч/валют таарсан, мөр
    // бүр PO-д хамаарах, илүү нэхэмжлээгүй (PO мөрүүд цоожлогдоно).
    if (purchaseOrderId)
      await assertPurchaseOrderLines(tx, {
        orgId,
        purchaseOrderId,
        documentType: data.documentType,
        counterpartyId: data.counterpartyId,
        currency,
        lines: validLines,
      });
    // Клирингийн бизнес объект — PO-той үед журналын мөр бүрд тавигдана
    // (FR-PROC-003/004: түр дансууд PO объектоор тэгширнэ).
    const businessObject = purchaseOrderId
      ? {
          businessObjectType: PO_BUSINESS_OBJECT,
          businessObjectId: purchaseOrderId,
        }
      : {};
    let voucherId: string | null = null;

    if (data.postNow) {
      const [voucher] = await tx
        .insert(journalVouchers)
        .values({
          userId,
          organizationId: orgId,
          date: data.date,
          description: `${documentLabel(data.documentType)}: ${description}`,
          status: "posted",
        })
        .returning({ id: journalVouchers.id });
      const createdVoucherId = voucher.id;
      voucherId = createdVoucherId;

      const lineValues =
        data.documentType === "ar_invoice"
          ? [
              {
                voucherId: createdVoucherId,
                accountNumber: controlAccountNumber,
                debit: String(baseTotalAmount),
                credit: "0",
                description,
                sortOrder: 0,
                ...businessObject,
              },
              ...validLines.map((line, index) => ({
                voucherId: createdVoucherId,
                accountNumber: line.account,
                debit: "0",
                credit: String(baseLineAmounts[index]),
                description: line.description || description,
                sortOrder: index + 1,
                ...businessObject,
              })),
            ]
          : [
              ...validLines.map((line, index) => ({
                voucherId: createdVoucherId,
                accountNumber: line.account,
                debit: String(baseLineAmounts[index]),
                credit: "0",
                description: line.description || description,
                sortOrder: index,
                ...businessObject,
              })),
              {
                voucherId: createdVoucherId,
                accountNumber: controlAccountNumber,
                debit: "0",
                credit: String(baseTotalAmount),
                description,
                sortOrder: validLines.length,
                ...businessObject,
              },
            ];

      await tx.insert(journalLines).values(lineValues);
      createdVoucherId2 = createdVoucherId;
    }

    const [document] = await tx
      .insert(arApDocuments)
      .values({
        userId,
        organizationId: orgId,
        documentNo,
        documentType: data.documentType,
        counterpartyId: data.counterpartyId,
        date: data.date,
        dueDate: data.dueDate,
        currency,
        exchangeRate: String(exchangeRate),
        controlAccountNumber,
        description,
        totalAmount: String(totalAmount),
        paidAmount: "0",
        baseTotalAmount: String(baseTotalAmount),
        basePaidAmount: "0",
        status,
        voucherId,
        externalRef: cleanText(data.externalRef),
        purchaseOrderId,
        postedAt: data.postNow ? new Date() : null,
      })
      .returning({ id: arApDocuments.id });

    await tx.insert(arApDocumentLines).values(
      validLines.map((line, index) => ({
        documentId: document.id,
        accountNumber: line.account,
        description: line.description || description,
        amount: String(line.amount),
        itemId: line.itemId,
        quantity: line.quantity != null ? String(line.quantity) : null,
        warehouseId: line.warehouseId,
        purchaseOrderLineId: line.purchaseOrderLineId,
        unitPrice: line.unitPrice != null ? String(line.unitPrice) : null,
        costComponentId: line.costComponentId,
        sortOrder: index,
      }))
    );
    createdDocumentId = document.id;
    if (data.postNow)
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "create_posted",
          entityType: "arap",
          entityId: document.id,
          summary: `${documentLabel(data.documentType)} шууд бичигдэв — ${documentNo}, ${data.date}, ${counterparty.name}, дүн ${totalAmount.toLocaleString("en-US")} ${currency}`,
        },
        tx
      );
  });

  // Батлагдсан бараатай мөрүүд → inventory-д тоо хэмжээний draft;
  // бараагүй 14-данс хөндсөн бол sentinel (sync дотроо шийднэ).
  // Sync унавал баримт аль хэдийн батлагдсан тул алдаа шидэхгүй —
  // reconcile_modules зөрүүг илрүүлж өөрөө засна (self-healing).
  if (data.postNow && createdDocumentId) {
    try {
      // PO-той нэхэмжлэхэд орлого нь хүлээн авалтын баримтаас үүсдэг тул
      // мөрийн draft ҮҮСГЭХГҮЙ (sync дотор мөн хамгаалагдсан).
      if (!purchaseOrderId)
        await createMovementDraftsForArApDocument(createdDocumentId);
      if (createdVoucherId2) {
        await syncInventoryDraftForVoucher(createdVoucherId2);
        await syncFixedAssetDraftForVoucher(createdVoucherId2);
      }
    } catch (caught) {
      console.error(
        `createArApDocument: subledger sync failed for document ${createdDocumentId} (voucher ${createdVoucherId2})`,
        caught
      );
    }
  }

  revalidateArAp();
  return { id: createdDocumentId!, documentNo };
}

export async function createArApDocument(
  data: Parameters<typeof createArApDocumentCore>[0]
): Promise<ActionResult<{ id: string; documentNo: string }>> {
  try {
    return await createArApDocumentCore(data);
  } catch (caught) {
    return actionError("createArApDocument", caught, "Баримт хадгалагдсангүй");
  }
}

// Ноорог АР/АП баримтыг батлах: create(postNow)-тэй ижил журналын бичилтийг
// хадгалагдсан мөрүүдээс үүсгэнэ (base дүнг баримтын ханшаар дахин тооцно).
async function postArApDocumentCore(id: string) {
  const { orgId, userId } = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!document) throw new Error("Баримт олдсонгүй");
  await requireModuleAction(permissionModuleOf(document.documentType), "post");
  if (document.status !== "draft")
    throw new Error("Зөвхөн ноорог баримтыг батална");
  await assertPeriodOpen(orgId, document.date);
  if (document.lines.length === 0) throw new Error("Баримтад мөр алга");

  const counterparty = await db.query.counterparties.findFirst({
    where: and(
      eq(counterparties.id, document.counterpartyId),
      eq(counterparties.organizationId, orgId),
      eq(counterparties.isActive, true)
    ),
    columns: { id: true },
  });
  if (!counterparty) throw new Error("Идэвхтэй харилцагч олдсонгүй");

  await assertEnabledMainAccount(orgId, document.controlAccountNumber);
  for (const line of document.lines)
    await assertEnabledMainAccount(orgId, line.accountNumber);

  const exchangeRate = Number(document.exchangeRate);
  const baseTotalAmount = calculateBaseAmount(
    Number(document.totalAmount),
    exchangeRate
  );
  const baseLineAmounts = document.lines.map((line) =>
    calculateBaseAmount(Number(line.amount), exchangeRate)
  );
  // Мөрүүдийн base нийлбэрийн зөрүүг сүүлийн мөрөнд шингээнэ (create-тэй ижил).
  const residual =
    baseTotalAmount -
    baseLineAmounts.reduce((sum, amount) => sum + amount, 0);
  if (baseLineAmounts.length > 0)
    baseLineAmounts[baseLineAmounts.length - 1] = roundMoney(
      baseLineAmounts[baseLineAmounts.length - 1] + residual
    );

  let voucherId: string | null = null;
  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, document.date);
    // PO-той ноорог батлагдахдаа захиалга нээлттэй, илүү нэхэмжлээгүй
    // эсэхийг ДАХИН шалгана (ноорог хэвтэх зуур PO хаагдсан байж болно).
    if (document.purchaseOrderId)
      await assertPurchaseOrderLines(tx, {
        orgId,
        purchaseOrderId: document.purchaseOrderId,
        documentType: document.documentType as ArApDocumentType,
        counterpartyId: document.counterpartyId,
        currency: document.currency,
        lines: document.lines.map((line) => ({
          itemId: line.itemId,
          quantity: line.quantity != null ? Number(line.quantity) : null,
          purchaseOrderLineId: line.purchaseOrderLineId,
          costComponentId: line.costComponentId,
          amount: Number(line.amount),
        })),
        excludeDocumentId: id,
      });
    const businessObject = document.purchaseOrderId
      ? {
          businessObjectType: PO_BUSINESS_OBJECT,
          businessObjectId: document.purchaseOrderId,
        }
      : {};
    const [claimed] = await tx
      .update(arApDocuments)
      .set({ status: "posted", postedAt: new Date() })
      .where(
        and(
          eq(arApDocuments.id, id),
          eq(arApDocuments.organizationId, orgId),
          eq(arApDocuments.status, "draft")
        )
      )
      .returning({ id: arApDocuments.id });
    if (!claimed) throw new Error("Баримтын төлөв өөрчлөгдсөн байна");

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: document.date,
        description: `${documentLabel(document.documentType as ArApDocumentType)}: ${document.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    voucherId = voucher.id;

    const lineValues =
      document.documentType === "ar_invoice"
        ? [
            {
              voucherId: voucher.id,
              accountNumber: document.controlAccountNumber,
              debit: String(baseTotalAmount),
              credit: "0",
              description: document.description,
              sortOrder: 0,
              ...businessObject,
            },
            ...document.lines.map((line, index) => ({
              voucherId: voucher.id,
              accountNumber: line.accountNumber,
              debit: "0",
              credit: String(baseLineAmounts[index]),
              description: line.description || document.description,
              sortOrder: index + 1,
              ...businessObject,
            })),
          ]
        : [
            ...document.lines.map((line, index) => ({
              voucherId: voucher.id,
              accountNumber: line.accountNumber,
              debit: String(baseLineAmounts[index]),
              credit: "0",
              description: line.description || document.description,
              sortOrder: index,
              ...businessObject,
            })),
            {
              voucherId: voucher.id,
              accountNumber: document.controlAccountNumber,
              debit: "0",
              credit: String(baseTotalAmount),
              description: document.description,
              sortOrder: document.lines.length,
              ...businessObject,
            },
          ];
    await tx.insert(journalLines).values(lineValues);

    await tx
      .update(arApDocuments)
      .set({ voucherId: voucher.id })
      .where(eq(arApDocuments.id, id));
    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "post",
        entityType: "arap",
        entityId: id,
        summary: `${documentLabel(document.documentType as ArApDocumentType)} батлагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.totalAmount).toLocaleString("en-US")} ${document.currency}`,
      },
      tx
    );
  });

  // Sync унавал баримт аль хэдийн батлагдсан тул алдаа шидэхгүй —
  // reconcile_modules зөрүүг илрүүлж өөрөө засна (self-healing).
  try {
    // PO-той нэхэмжлэх: орлого нь хүлээн авалтын баримтаас (sync дотор мөн
    // хамгаалагдсан).
    if (!document.purchaseOrderId)
      await createMovementDraftsForArApDocument(id);
    if (voucherId) {
      await syncInventoryDraftForVoucher(voucherId);
      await syncFixedAssetDraftForVoucher(voucherId);
    }
  } catch (caught) {
    console.error(
      `postArApDocument: subledger sync failed for document ${id} (voucher ${voucherId})`,
      caught
    );
  }

  revalidateArAp();
}

export async function postArApDocument(id: string): Promise<ActionResult> {
  try {
    await postArApDocumentCore(id);
    return {};
  } catch (caught) {
    return actionError("postArApDocument", caught, "Баримт батлагдсангүй");
  }
}

/**
 * Батлагдсан АР/АП нэхэмжлэхийг БУЦААХ — GL журналыг нь урвуу мөртэй шинэ
 * журналаар цэвэрлэж (нэт 0), баримт "reversed" төлөвт орно. Нэг баримт
 * ЗӨВХӨН НЭГ удаа буцаагдана: транзакц доторх атом claim (posted→reversed)
 * давхар буцаалтыг таслана — бусад модулийн reverse-тэй ИЖИЛ загвар.
 * Хамгаалалт:
 *   - төлөлттэй (paid/partially_paid эсвэл settlement) бол эхлээд төлөлтийн
 *     кассын баримтыг буцаана
 *   - үүсгэсэн бараа хөдөлгөөн БАТАЛГААЖСАН бол эхлээд цуцлуулна
 *     (ноорог хөдөлгөөн нь хамт устна)
 *   - период нээлттэй байх (буцаалт эх огноогоор бичигдэнэ)
 */
async function reverseArApDocumentCore(id: string) {
  const { orgId, userId } = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
  });
  if (!document) throw new Error("Баримт олдсонгүй");
  await requireModuleAction(permissionModuleOf(document.documentType), "post");
  if (document.status === "reversed")
    throw new Error("Энэ баримт аль хэдийн буцаагдсан байна");
  if (document.status === "partially_paid" || document.status === "paid")
    throw new Error(
      "Төлөлттэй нэхэмжлэх — эхлээд төлөлтийн кассын баримт(ууд)ыг буцаана уу"
    );
  if (document.status !== "posted" || !document.voucherId)
    throw new Error("Зөвхөн батлагдсан нэхэмжлэхийг буцаана");
  await assertPeriodOpen(orgId, document.date);
  // Хаагдсан PO-гийн нэхэмжлэхийг буцаавал хаалтын журнал тэнцэхгүй.
  if (document.purchaseOrderId)
    await assertPurchaseOrderNotClosed(orgId, document.purchaseOrderId, "буцаах");

  // Аюулгүйн давхар шалгалт — статус posted атлаа settlement үлдсэн байж болно.
  const settlement = await db.query.arApSettlements.findFirst({
    where: and(
      eq(arApSettlements.organizationId, orgId),
      eq(arApSettlements.documentId, id)
    ),
    columns: { id: true },
  });
  if (settlement || Number(document.paidAmount) > 0.005)
    throw new Error(
      "Төлөлттэй нэхэмжлэх — эхлээд төлөлтийн кассын баримт(ууд)ыг буцаана уу"
    );

  // Энэ баримтын мөрүүдээс үүссэн бараа хөдөлгөөнүүд (delete-тэй ижил дүрэм).
  const lines = await db.query.arApDocumentLines.findMany({
    where: eq(arApDocumentLines.documentId, id),
    columns: { id: true },
  });
  const movements =
    lines.length > 0
      ? await db.query.inventoryMovements.findMany({
          where: and(
            eq(inventoryMovements.organizationId, orgId),
            eq(inventoryMovements.sourceType, "arap_line"),
            inArray(
              inventoryMovements.sourceId,
              lines.map((line) => line.id)
            )
          ),
          columns: { id: true, status: true },
        })
      : [];
  if (movements.some((movement) => movement.status === "confirmed"))
    throw new Error(
      "Энэ нэхэмжлэхээс үүссэн бараа хөдөлгөөн баталгаажсан байна — эхлээд хөдөлгөөнийг цуцлана уу"
    );

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, document.voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");

  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, document.date);
    // Атом claim — зэрэг дарсан хоёр буцаалтын нэг нь л амжина.
    const [claimed] = await tx
      .update(arApDocuments)
      .set({ status: "reversed" })
      .where(
        and(
          eq(arApDocuments.id, id),
          eq(arApDocuments.organizationId, orgId),
          eq(arApDocuments.status, "posted")
        )
      )
      .returning({ id: arApDocuments.id });
    if (!claimed) throw new Error("Баримтын төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: document.date,
        description: `Буцаалт [${document.documentNo}] ${document.description}`,
        status: "posted",
        // Эх журналтайгаа хосолно — журналын харагдацад хоёр чигт холбоос гарна.
        reversalOfVoucherId: voucher.id,
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
        sortOrder: index,
        // Клирингийн бизнес объект урвуу мөрд ч дамжина — PO-гүй баримтад
        // хоёулаа null тул хуучин зан төлөв өөрчлөгдөхгүй.
        businessObjectType: line.businessObjectType,
        businessObjectId: line.businessObjectId,
      }))
    );

    await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucher.id),
          eq(journalVouchers.organizationId, orgId)
        )
      );

    await tx
      .update(arApDocuments)
      .set({ reversalVoucherId: reversal.id })
      .where(eq(arApDocuments.id, id));

    // Батлагдмагц үүссэн НООРОГ бараа хөдөлгөөнүүд хамт устна (баталгаажсан
    // байвал дээр аль хэдийн хориглосон).
    for (const movement of movements) {
      await tx
        .delete(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.id, movement.id),
            eq(inventoryMovements.organizationId, orgId)
          )
        );
    }

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "arap",
        entityId: id,
        summary: `${documentLabel(document.documentType as ArApDocumentType)} буцаагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.totalAmount).toLocaleString("en-US")} ${document.currency}`,
      },
      tx
    );
  });
  revalidateArAp();
}

export async function reverseArApDocument(id: string): Promise<ActionResult> {
  try {
    await reverseArApDocumentCore(id);
    return {};
  } catch (caught) {
    return actionError("reverseArApDocument", caught, "Баримт буцаагдсангүй");
  }
}

// Ноорог АР/АП баримтыг устгах — journal/cash-ийн delete-тэй ижил зан төлөв:
// батлагдсан баримт устгагдахгүй (буцаалтыг reverse урсгалаар хийнэ).
/**
 * АР/АП баримт устгах. Ноорог — шууд. БАТЛАГДСАН нэхэмжлэхийг мөн устгаж
 * болно — GL журнал(ууд) нь хамт устна. Хамгаалалт:
 *   - төлөлттэй (paid/partially_paid эсвэл settlement-тэй) бол эхлээд
 *     төлөлтийн кассын баримтуудыг устгуулна
 *   - үүсгэсэн бараа хөдөлгөөн нь БАТАЛГААЖСАН бол эхлээд цуцлуулна
 *     (ноорог хөдөлгөөн хамт устна)
 *   - период нээлттэй байх
 */
async function deleteArApDocumentCore(id: string) {
  const { orgId, userId } = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
  });
  if (!document) throw new Error("Баримт олдсонгүй");
  // Ноорог устгах — бичих; батлагдсаныг GL-тэй нь устгах — батлах түвшин.
  await requireModuleAction(
    permissionModuleOf(document.documentType),
    document.status === "draft" ? "write" : "post"
  );
  // Хаагдсан PO-гийн нэхэмжлэхийг устгавал хаалтын нөхцөл/журнал эвдэрнэ
  // (ноорог нэхэмжлэх ч PO-гийн нэхэмжилсэн нийлбэрт тооцогддог).
  if (document.purchaseOrderId)
    await assertPurchaseOrderNotClosed(orgId, document.purchaseOrderId, "устгах");

  if (document.status !== "draft") {
    await assertPeriodOpen(orgId, document.date);

    const settlement = await db.query.arApSettlements.findFirst({
      where: and(
        eq(arApSettlements.organizationId, orgId),
        eq(arApSettlements.documentId, id)
      ),
      columns: { id: true },
    });
    if (settlement || Number(document.paidAmount) > 0.005)
      throw new Error(
        "Төлөлттэй нэхэмжлэх — эхлээд төлөлтийн кассын баримт(ууд)ыг устгана уу"
      );

    // Энэ баримтын мөрүүдээс үүссэн хөдөлгөөнүүд (sourceType=arap_line,
    // sourceId=мөрийн id).
    const lines = await db.query.arApDocumentLines.findMany({
      where: eq(arApDocumentLines.documentId, id),
      columns: { id: true },
    });
    const movements =
      lines.length > 0
        ? await db.query.inventoryMovements.findMany({
            where: and(
              eq(inventoryMovements.organizationId, orgId),
              eq(inventoryMovements.sourceType, "arap_line"),
              inArray(
                inventoryMovements.sourceId,
                lines.map((line) => line.id)
              )
            ),
            columns: { id: true, status: true },
          })
        : [];
    if (movements.some((movement) => movement.status === "confirmed"))
      throw new Error(
        "Энэ нэхэмжлэхээс үүссэн бараа хөдөлгөөн баталгаажсан байна — эхлээд хөдөлгөөнийг цуцлана уу"
      );

    const voucherIds = [
      ...new Set(
        [document.voucherId, document.reversalVoucherId].filter(
          (value): value is string => !!value
        )
      ),
    ];

    await db.transaction(async (tx) => {
      // Үүсгэсэн ноорог хөдөлгөөнүүд хамт устна.
      for (const movement of movements) {
        await tx
          .delete(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.id, movement.id),
              eq(inventoryMovements.organizationId, orgId)
            )
          );
      }
      await tx
        .delete(arApDocuments)
        .where(and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)));
      for (const voucherId of voucherIds) {
        await tx
          .delete(journalVouchers)
          .where(
            and(
              eq(journalVouchers.id, voucherId),
              eq(journalVouchers.organizationId, orgId)
            )
          );
      }
      await logAuditEvent(
        {
          userId,
          organizationId: orgId,
          action: "delete",
          entityType: "arap",
          entityId: id,
          summary: `АР/АП баримт устгагдав — ${document.documentNo}, ${document.date}, дүн ${Number(document.totalAmount).toLocaleString("en-US")} ${document.currency} (өмнөх төлөв: ${document.status})`,
        },
        tx
      );
    });

    revalidateArAp();
    return { documentNo: document.documentNo };
  }

  // Мөрүүд FK cascade-аар хамт устна; ноорогт settlement/journal холбоос байхгүй.
  await db
    .delete(arApDocuments)
    .where(and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)));

  await logAuditEvent({
    userId,
    organizationId: orgId,
    action: "delete",
    entityType: "arap",
    entityId: id,
    summary: `АР/АП баримт устгагдав — ${document.documentNo}, ${document.date} (өмнөх төлөв: draft)`,
  });

  revalidateArAp();
  return { documentNo: document.documentNo };
}


// Ноорог АР/АП баримтыг засах — зөвхөн draft; өгсөн талбар л өөрчлөгдөнө.
// Мөрүүд өгвөл БҮХЛЭЭРЭЭ солигдоно (create-тэй ИЖИЛ шалгалтууд: данс,
// бараа/агуулах ownership, клирингийн сахилга).
export async function updateArApDocument(
  id: string,
  data: {
    date?: string;
    dueDate?: string;
    description?: string;
    controlAccountNumber?: string;
    lines?: ArApLineInput[];
  }
) {
  const { orgId, userId } = await getActiveOrg();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
  });
  if (!document) throw new Error("Баримт олдсонгүй");
  await requireModuleAction(permissionModuleOf(document.documentType), "write");
  if (document.status !== "draft")
    throw new Error("Зөвхөн ноорог баримтыг засна — батлагдсаныг буцаагаад шинээр бүртгэнэ");

  const date = data.date?.trim() || document.date;
  const dueDate = data.dueDate?.trim() || document.dueDate;
  assertDate(date, "Огноо");
  assertDate(dueDate, "Төлөх огноо");
  if (dueDate < date)
    throw new Error("Төлөх огноо баримтын огнооноос өмнө байж болохгүй");
  // Ноорог хожим энэ огноогоор батлагдах тул хаагдсан сар руу зөөхийг таслана.
  await assertPeriodOpen(orgId, date);
  const description = data.description?.trim() || document.description;
  const controlAccountNumber =
    data.controlAccountNumber?.trim() || document.controlAccountNumber;
  await assertEnabledMainAccount(orgId, controlAccountNumber);

  const updateValues: Partial<typeof arApDocuments.$inferInsert> = {
    date,
    dueDate,
    description,
    controlAccountNumber,
  };

  // PO-гийн холбоос ҮҮСГЭХ үед тогтдог — засварлаж сольдоггүй.
  const purchaseOrderId = document.purchaseOrderId;

  let newLines:
    | {
        account: string;
        description: string;
        amount: number;
        itemId: string | null;
        quantity: number | null;
        warehouseId: string | null;
        purchaseOrderLineId: string | null;
        unitPrice: number | null;
        costComponentId: string | null;
      }[]
    | null = null;
  if (data.lines) {
    const validLines = data.lines
      .map((line) => {
        const quantity = line.itemId ? Number(line.quantity ?? 0) : null;
        const rawUnitPrice =
          line.unitPrice != null ? Number(line.unitPrice) : null;
        const unitPrice =
          rawUnitPrice != null &&
          Number.isFinite(rawUnitPrice) &&
          rawUnitPrice > 0
            ? rawUnitPrice
            : null;
        const given = Number(line.amount);
        const amount =
          given > 0
            ? given
            : quantity != null && quantity > 0 && unitPrice != null
              ? roundMoney(quantity * unitPrice)
              : given;
        return {
          account: line.account.trim(),
          description: line.description.trim(),
          amount,
          itemId: line.itemId || null,
          quantity,
          warehouseId: line.itemId ? line.warehouseId || null : null,
          purchaseOrderLineId: line.purchaseOrderLineId || null,
          unitPrice,
          costComponentId: line.costComponentId || null,
        };
      })
      .filter((line) => line.account && line.amount > 0);
    if (validLines.length === 0) throw new Error("Дор хаяж нэг мөр оруулна уу");
    const costingRoles = await loadCostingAccountSettings(orgId, userId);
    const clearingAccount = costingRoles.clearingAccountNumber;
    const apClearingAccount = costingRoles.apClearingAccountNumber;
    for (const line of validLines) {
      assertAmount(line.amount, "Мөрийн дүн");
      await assertEnabledMainAccount(orgId, line.account);
      const lineMain = extractMainAccount(line.account);
      if (line.itemId && line.costComponentId)
        throw new Error(
          "Нэг мөрөнд бараа ба өртгийн бүрэлдэхүүн зэрэг байж болохгүй"
        );
      if (line.costComponentId) {
        if (!purchaseOrderId)
          throw new Error(
            "Өртгийн бүрэлдэхүүнтэй мөр зөвхөн захиалгатай (PO) нэхэмжлэхэд бичигдэнэ"
          );
        if (lineMain !== apClearingAccount)
          throw new Error(
            `Бүрэлдэхүүнтэй мөрийн данс ${apClearingAccount} (өглөгийн түр данс) байх ёстой — хуваарилалт барааны өртөгт капиталжина`
          );
      }
      if (!line.itemId) continue;
      if (!(line.quantity! > 0))
        throw new Error("Бараатай мөрөнд тоо хэмжээ 0-ээс их байна");
      if (document.documentType === "ap_bill") {
        if (purchaseOrderId && lineMain !== apClearingAccount)
          throw new Error(
            `PO-той нэхэмжлэхийн бараатай мөрийн данс ${apClearingAccount} (өглөгийн түр данс) байх ёстой — орлогын капитализаци хүлээн авалтын баримтаас бичигдэнэ`
          );
        if (!purchaseOrderId && lineMain !== clearingAccount)
          throw new Error(
            `Бараатай мөрийн данс ${clearingAccount} (клиринг) байх ёстой — өртгийн модуль капитализацийг өөрөө бичнэ`
          );
      }
      if (document.documentType === "ar_invoice" && lineMain.startsWith("14"))
        throw new Error(
          "Борлуулалтын бараатай мөр орлогын дансанд суана — COGS бичилтийг өртгийн модуль хийнэ"
        );
      const item = await db.query.inventoryItems.findFirst({
        where: and(
          eq(inventoryItems.id, line.itemId),
          eq(inventoryItems.organizationId, orgId),
          eq(inventoryItems.isActive, true)
        ),
        columns: { id: true },
      });
      if (!item) throw new Error("Идэвхтэй бараа олдсонгүй");
      if (line.warehouseId) {
        const warehouse = await db.query.warehouses.findFirst({
          where: and(
            eq(warehouses.id, line.warehouseId),
            eq(warehouses.organizationId, orgId),
            eq(warehouses.isActive, true)
          ),
          columns: { id: true },
        });
        if (!warehouse) throw new Error("Идэвхтэй агуулах олдсонгүй");
      }
    }
    const totalAmount =
      Math.round(validLines.reduce((sum, line) => sum + line.amount, 0) * 100) /
      100;
    const exchangeRate = Number(document.exchangeRate);
    updateValues.totalAmount = String(totalAmount);
    updateValues.baseTotalAmount = String(
      calculateBaseAmount(totalAmount, exchangeRate)
    );
    newLines = validLines;
  }

  await db.transaction(async (tx) => {
    // PO-той ноорогт мөр солигдвол захиалгын нөхцөл ДАХИН шалгагдана
    // (өөрийн хадгалагдсан мөрүүд нийлбэрээс хасагдана).
    if (purchaseOrderId && newLines)
      await assertPurchaseOrderLines(tx, {
        orgId,
        purchaseOrderId,
        documentType: document.documentType as ArApDocumentType,
        counterpartyId: document.counterpartyId,
        currency: document.currency,
        lines: newLines,
        excludeDocumentId: id,
      });
    await tx
      .update(arApDocuments)
      .set(updateValues)
      .where(
        and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId))
      );
    if (newLines) {
      await tx
        .delete(arApDocumentLines)
        .where(eq(arApDocumentLines.documentId, id));
      await tx.insert(arApDocumentLines).values(
        newLines.map((line, index) => ({
          documentId: id,
          accountNumber: line.account,
          description: line.description || description,
          amount: String(line.amount),
          itemId: line.itemId,
          quantity: line.quantity != null ? String(line.quantity) : null,
          warehouseId: line.warehouseId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          unitPrice: line.unitPrice != null ? String(line.unitPrice) : null,
          costComponentId: line.costComponentId,
          sortOrder: index,
        }))
      );
    }
  });

  revalidateArAp();
  return { documentNo: document.documentNo };
}

export async function deleteArApDocument(
  id: string
): Promise<ActionResult<{ documentNo: string }>> {
  try {
    return await deleteArApDocumentCore(id);
  } catch (caught) {
    return actionError("deleteArApDocument", caught, "Баримт устгагдсангүй");
  }
}

// ─── Харилцан суутган тооцоо (АР ↔ АП offset) ───────────────────────────────
// Нэг харилцагчийн авлага, өглөгийг мөнгө хөдөлгөлгүй хооронд нь хаана
// (харилцан суутган тооцооны акт). GL: Dr АП-ийн хяналтын данс / Cr АР-ийн
// хяналтын данс — НӨАТ-д нөлөөгүй (татвар нь нэхэмжлэх дээр бүртгэгдсэн).
// Нэг offset = НЭГ posted воучер + ХОЁР settlement мөр (voucherId-гаар
// холбогдоно, cashDocumentId null). Эхний хувилбарт зөвхөн MNT баримтууд —
// гадаад валютын түүхэн ханшны зөрүү (ханшийн олз/гарз) 2-р үе шатанд.

export async function settleArApOffset(input: {
  arDocumentId: string;
  apDocumentId: string;
  /** Валютаар; өгөхгүй бол хоёр үлдэгдлийн бага нь. */
  amount?: number;
  /** Тооцоо нийлсэн актын огноо. */
  date: string;
}): Promise<ActionResult<{ voucherId: string }>> {
  try {
    const voucherId = await settleArApOffsetCore(input);
    return { voucherId };
  } catch (caught) {
    return actionError("settleArApOffset", caught, "Суутган тооцоо амжилтгүй");
  }
}

async function settleArApOffsetCore(input: {
  arDocumentId: string;
  apDocumentId: string;
  amount?: number;
  date: string;
}): Promise<string> {
  const { orgId, userId } = await getActiveOrg();
  await requireModuleAction("ar", "post");
  await requireModuleAction("ap", "post");
  assertDate(input.date, "Огноо");
  if (input.arDocumentId === input.apDocumentId)
    throw new Error("Нэг баримтыг өөртэй нь хаах боломжгүй");

  const [arDoc, apDoc] = await Promise.all([
    db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.id, input.arDocumentId),
        eq(arApDocuments.organizationId, orgId)
      ),
    }),
    db.query.arApDocuments.findFirst({
      where: and(
        eq(arApDocuments.id, input.apDocumentId),
        eq(arApDocuments.organizationId, orgId)
      ),
    }),
  ]);
  if (!arDoc) throw new Error("Авлагын нэхэмжлэл олдсонгүй");
  if (!apDoc) throw new Error("Өглөгийн нэхэмжлэх олдсонгүй");
  if (arDoc.documentType !== "ar_invoice")
    throw new Error(`${arDoc.documentNo} нь авлагын нэхэмжлэл биш байна`);
  if (apDoc.documentType !== "ap_bill")
    throw new Error(`${apDoc.documentNo} нь өглөгийн нэхэмжлэх биш байна`);
  if (arDoc.counterpartyId !== apDoc.counterpartyId)
    throw new Error(
      "Хоёр баримт НЭГ харилцагчийнх байх ёстой — өөр харилцагч хоорондын (гурван талт) тооцоо дэмжигдэхгүй"
    );
  for (const doc of [arDoc, apDoc])
    if (!["posted", "partially_paid"].includes(doc.status))
      throw new Error(
        `${doc.documentNo} баримт нээлттэй төлөвт биш байна (${doc.status})`
      );
  if (arDoc.currency !== "MNT" || apDoc.currency !== "MNT")
    throw new Error(
      "Гадаад валютын баримтын суутган тооцоо одоогоор дэмжигдэхгүй — зөвхөн MNT баримтууд хоорондоо хаагдана"
    );

  const arBalance =
    Math.round((Number(arDoc.totalAmount) - Number(arDoc.paidAmount)) * 100) /
    100;
  const apBalance =
    Math.round((Number(apDoc.totalAmount) - Number(apDoc.paidAmount)) * 100) /
    100;
  const amount =
    input.amount != null
      ? Math.round(Number(input.amount) * 100) / 100
      : Math.min(arBalance, apBalance);
  assertAmount(amount, "Суутган тооцооны дүн");
  if (amount > arBalance + 0.005)
    throw new Error(
      `Дүн ${arDoc.documentNo}-ийн үлдэгдлээс (${arBalance.toLocaleString("en-US")}₮) их байна`
    );
  if (amount > apBalance + 0.005)
    throw new Error(
      `Дүн ${apDoc.documentNo}-ийн үлдэгдлээс (${apBalance.toLocaleString("en-US")}₮) их байна`
    );

  await assertEnabledMainAccount(orgId, arDoc.controlAccountNumber);
  await assertEnabledMainAccount(orgId, apDoc.controlAccountNumber);
  await assertPeriodOpen(orgId, input.date);

  let voucherId = "";
  const amountText = String(amount);
  await db.transaction(async (tx) => {
    // Периодын хаалттай уралдахаас хамгаалсан транзакц-доторх шалгалт.
    await assertPeriodOpenInTx(tx, orgId, input.date);

    // Хоёр талын paidAmount-ыг атом нэмэгдүүлнэ — кассын хаалттай ижил
    // optimistic guard: үлдэгдэл зэрэг өөрчлөгдсөн бол бүхэлдээ буцна.
    // MNT тул baseAmount = amount.
    for (const doc of [arDoc, apDoc]) {
      const [updated] = await tx
        .update(arApDocuments)
        .set({
          paidAmount: sql`${arApDocuments.paidAmount} + ${amountText}`,
          basePaidAmount: sql`${arApDocuments.basePaidAmount} + ${amountText}`,
          status: sql`CASE WHEN ${arApDocuments.paidAmount} + ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid' ELSE 'partially_paid' END`,
        })
        .where(
          and(
            eq(arApDocuments.id, doc.id),
            eq(arApDocuments.organizationId, orgId),
            inArray(arApDocuments.status, ["posted", "partially_paid"]),
            sql`${arApDocuments.totalAmount} - ${arApDocuments.paidAmount} >= ${amountText} - 0.005`
          )
        )
        .returning({ id: arApDocuments.id });
      if (!updated)
        throw new Error(
          `${doc.documentNo} — үлдэгдэл өөрчлөгдсөн байна, хуудсаа шинэчлээд дахин оролдоно уу`
        );
    }

    const [voucher] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: input.date,
        description: `Суутган тооцоо [${arDoc.documentNo} ↔ ${apDoc.documentNo}] ${arDoc.description}`,
        status: "posted",
      })
      .returning({ id: journalVouchers.id });
    voucherId = voucher.id;

    await tx.insert(journalLines).values([
      {
        voucherId: voucher.id,
        accountNumber: apDoc.controlAccountNumber,
        debit: amountText,
        credit: "0",
        description: `Суутган тооцоо — ${apDoc.documentNo}`,
        sortOrder: 0,
      },
      {
        voucherId: voucher.id,
        accountNumber: arDoc.controlAccountNumber,
        debit: "0",
        credit: amountText,
        description: `Суутган тооцоо — ${arDoc.documentNo}`,
        sortOrder: 1,
      },
    ]);

    await tx.insert(arApSettlements).values([
      {
        userId,
        organizationId: orgId,
        documentId: arDoc.id,
        cashDocumentId: null,
        voucherId: voucher.id,
        settlementDate: input.date,
        amount: amountText,
        baseAmount: amountText,
      },
      {
        userId,
        organizationId: orgId,
        documentId: apDoc.id,
        cashDocumentId: null,
        voucherId: voucher.id,
        settlementDate: input.date,
        amount: amountText,
        baseAmount: amountText,
      },
    ]);

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "offset",
        entityType: "arap",
        entityId: arDoc.id,
        summary: `Суутган тооцоо — ${arDoc.documentNo} ↔ ${apDoc.documentNo}, дүн ${amount.toLocaleString("en-US")}₮`,
      },
      tx
    );
  });

  revalidateArAp();
  return voucherId;
}

/**
 * Суутган тооцоог буцаана — воучер нь урвуу мөртэй шинэ журналаар цэвэрлэгдэж
 * (нэт 0), хоёр талын paidAmount/статус сэргэж, settlement мөрүүд устна.
 * Кассын буцаалтын rollback-тай ижил атом SQL хэв маяг.
 */
export async function reverseArApOffset(
  voucherId: string
): Promise<ActionResult> {
  try {
    await reverseArApOffsetCore(voucherId);
    return {};
  } catch (caught) {
    return actionError(
      "reverseArApOffset",
      caught,
      "Суутган тооцоо буцаагдсангүй"
    );
  }
}

async function reverseArApOffsetCore(voucherId: string) {
  const { orgId, userId } = await getActiveOrg();
  await requireModuleAction("ar", "post");
  await requireModuleAction("ap", "post");

  const settlements = await db.query.arApSettlements.findMany({
    where: and(
      eq(arApSettlements.organizationId, orgId),
      eq(arApSettlements.voucherId, voucherId)
    ),
    with: { document: true },
  });
  if (settlements.length === 0)
    throw new Error("Суутган тооцооны бичилт олдсонгүй");

  const voucher = await db.query.journalVouchers.findFirst({
    where: and(
      eq(journalVouchers.id, voucherId),
      eq(journalVouchers.organizationId, orgId)
    ),
    with: { lines: { orderBy: (line, { asc }) => [asc(line.sortOrder)] } },
  });
  if (!voucher) throw new Error("Холбоотой GL журнал олдсонгүй");
  if (voucher.status !== "posted")
    throw new Error("Зөвхөн батлагдсан суутган тооцоог буцаана");
  await assertPeriodOpen(orgId, voucher.date);

  await db.transaction(async (tx) => {
    await assertPeriodOpenInTx(tx, orgId, voucher.date);
    // Атом claim — давхар буцаалтын нэг нь л амжина.
    const [claimed] = await tx
      .update(journalVouchers)
      .set({ status: "reversed" })
      .where(
        and(
          eq(journalVouchers.id, voucherId),
          eq(journalVouchers.organizationId, orgId),
          eq(journalVouchers.status, "posted")
        )
      )
      .returning({ id: journalVouchers.id });
    if (!claimed) throw new Error("Журналын төлөв өөрчлөгдсөн байна");

    const [reversal] = await tx
      .insert(journalVouchers)
      .values({
        userId,
        organizationId: orgId,
        date: voucher.date,
        description: `Буцаалт: ${voucher.description}`,
        status: "posted",
        reversalOfVoucherId: voucher.id,
      })
      .returning({ id: journalVouchers.id });

    await tx.insert(journalLines).values(
      voucher.lines.map((line, index) => ({
        voucherId: reversal.id,
        accountNumber: line.accountNumber,
        debit: line.credit,
        credit: line.debit,
        description: line.description,
        sortOrder: index,
      }))
    );

    // Хоёр талын paidAmount-ыг атом хасалтаар сэргээнэ (кассын буцаалттай
    // ижил — SET доторх багана бүр ХУУЧИН утгаа хардаг).
    for (const settlement of settlements) {
      const amountText = String(settlement.amount);
      const baseText = String(settlement.baseAmount ?? settlement.amount);
      await tx
        .update(arApDocuments)
        .set({
          paidAmount: sql`GREATEST(${arApDocuments.paidAmount} - ${amountText}, 0)`,
          basePaidAmount: sql`GREATEST(COALESCE(${arApDocuments.basePaidAmount}, ${arApDocuments.paidAmount}) - ${baseText}, 0)`,
          status: sql`CASE
            WHEN ${arApDocuments.status} NOT IN ('posted', 'partially_paid', 'paid') THEN ${arApDocuments.status}
            WHEN ${arApDocuments.paidAmount} - ${amountText} <= 0.005 THEN 'posted'
            WHEN ${arApDocuments.paidAmount} - ${amountText} >= ${arApDocuments.totalAmount} - 0.005 THEN 'paid'
            ELSE 'partially_paid' END`,
        })
        .where(
          and(
            eq(arApDocuments.id, settlement.documentId),
            eq(arApDocuments.organizationId, orgId)
          )
        );
      await tx
        .delete(arApSettlements)
        .where(eq(arApSettlements.id, settlement.id));
    }

    await logAuditEvent(
      {
        userId,
        organizationId: orgId,
        action: "reverse",
        entityType: "arap",
        entityId: settlements[0].documentId,
        summary: `Суутган тооцоо буцаагдав — ${voucher.description}`,
      },
      tx
    );
  });

  revalidateArAp();
}
