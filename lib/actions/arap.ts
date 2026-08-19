"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { getActiveOrg, requireRole } from "@/lib/auth";
import { assertPeriodOpen, assertPeriodOpenInTx } from "@/lib/periods/guard";
import { db } from "@/lib/db";
import {
  arApDocumentLines,
  arApDocuments,
  arApSettlements,
  cashDocuments,
  chartOfAccounts,
  counterparties,
  inventoryMovements,
  journalLines,
  journalVouchers,
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
import { loadCostingAccountSettings } from "@/lib/costing/master-data";
import { inventoryItems, warehouses } from "@/lib/db/schema";
import { logAuditEvent } from "@/lib/audit";

/** Бичилтийн эрхтэй (accountant+) гишүүний org контекст. */
async function requireAccountant() {
  return requireRole("accountant");
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
  /** Системийн default хяналтын дансууд — харилцагчид default байхгүй үед. */
  defaultAccountNumbers: { receivable: string; payable: string };
  /** documentId өгөгдсөн үед л — read-only харагдацын баримт. */
  document: ArApDocumentDetail | null;
  /** Нэхэмжлэхтэй холбогдсон мөнгөн хөрөнгийн баримтууд (төлөлтүүд). */
  payments: {
    id: string;
    documentNo: string;
    date: string;
    baseAmount: number;
    status: string;
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
    paymentRows,
  ] = await Promise.all([
    loadArApSegmentData(orgId),
    loadArApCounterparties(orgId),
    loadArApInventoryOptions(orgId),
    documentId
      ? loadArApDocumentDetail(orgId, documentId)
      : Promise.resolve(null),
    loadCostingAccountSettings(orgId),
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
  ]);

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
      defaultAccountNumbers: segmentData.defaultAccountNumbers,
      document,
      payments: paymentRows.map((row) => ({
        id: row.id,
        documentNo: row.documentNo,
        date: row.date,
        baseAmount: Number(row.baseAmount ?? row.amount),
        status: row.status,
      })),
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
}) {
  const { orgId, userId } = await requireAccountant();
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
  }
) {
  const { orgId } = await requireAccountant();
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
    })
    .where(and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId)))
    .returning({ id: counterparties.id });
  if (!updated) throw new Error("Харилцагч олдсонгүй");

  revalidateArAp();
}

export async function toggleCounterparty(id: string, isActive: boolean) {
  const { orgId } = await requireAccountant();
  await db
    .update(counterparties)
    .set({ isActive })
    .where(and(eq(counterparties.id, id), eq(counterparties.organizationId, orgId)));
  revalidateArAp();
}

export async function createArApDocument(data: {
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
}) {
  const { orgId, userId } = await requireAccountant();
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

  const validLines = data.lines
    .map((line) => ({
      account: line.account.trim(),
      description: line.description.trim(),
      amount: Number(line.amount),
      itemId: line.itemId || null,
      quantity: line.itemId ? Number(line.quantity ?? 0) : null,
      warehouseId: line.itemId ? line.warehouseId || null : null,
    }))
    .filter((line) => line.account && line.amount > 0);
  if (validLines.length === 0) throw new Error("Дор хаяж нэг мөр оруулна уу");
  // Клирингийн данс тохиргооноос (JPR-006) — кодод хатуу дугаар байхгүй.
  const clearingAccount = (await loadCostingAccountSettings(orgId, userId))
    .clearingAccountNumber;
  for (const line of validLines) {
    assertAmount(line.amount, "Мөрийн дүн");
    await assertEnabledMainAccount(orgId, line.account);
    if (!line.itemId) continue;
    if (!(line.quantity! > 0))
      throw new Error("Бараатай мөрөнд тоо хэмжээ 0-ээс их байна");
    // Клирингийн сахилга: АП-ийн бараатай мөр ЗААВАЛ 14000099 клирингт
    // суана (капитализацийг өртгийн модуль Dr бараа данс / Cr клиринг гэж
    // бичдэг — шууд 14000001-д суулгавал GL давхарлана). АР-ийн бараатай
    // мөр орлогын тал тул 14-бүлэгт огт суухгүй.
    const lineMain = extractMainAccount(line.account);
    if (data.documentType === "ap_bill" && lineMain !== clearingAccount)
      throw new Error(
        `Бараатай мөрийн данс ${clearingAccount} (клиринг) байх ёстой — өртгийн модуль капитализацийг өөрөө бичнэ`
      );
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
              },
              ...validLines.map((line, index) => ({
                voucherId: createdVoucherId,
                accountNumber: line.account,
                debit: "0",
                credit: String(baseLineAmounts[index]),
                description: line.description || description,
                sortOrder: index + 1,
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
              })),
              {
                voucherId: createdVoucherId,
                accountNumber: controlAccountNumber,
                debit: "0",
                credit: String(baseTotalAmount),
                description,
                sortOrder: validLines.length,
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

// Ноорог АР/АП баримтыг батлах: create(postNow)-тэй ижил журналын бичилтийг
// хадгалагдсан мөрүүдээс үүсгэнэ (base дүнг баримтын ханшаар дахин тооцно).
export async function postArApDocument(id: string) {
  const { orgId, userId } = await requireAccountant();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
    with: { lines: { orderBy: (l, { asc }) => [asc(l.sortOrder)] } },
  });
  if (!document) throw new Error("Баримт олдсонгүй");
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
            },
            ...document.lines.map((line, index) => ({
              voucherId: voucher.id,
              accountNumber: line.accountNumber,
              debit: "0",
              credit: String(baseLineAmounts[index]),
              description: line.description || document.description,
              sortOrder: index + 1,
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
            })),
            {
              voucherId: voucher.id,
              accountNumber: document.controlAccountNumber,
              debit: "0",
              credit: String(baseTotalAmount),
              description: document.description,
              sortOrder: document.lines.length,
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
export async function reverseArApDocument(id: string) {
  const { orgId, userId } = await requireAccountant();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
  });
  if (!document) throw new Error("Баримт олдсонгүй");
  if (document.status === "reversed")
    throw new Error("Энэ баримт аль хэдийн буцаагдсан байна");
  if (document.status === "partially_paid" || document.status === "paid")
    throw new Error(
      "Төлөлттэй нэхэмжлэх — эхлээд төлөлтийн кассын баримт(ууд)ыг буцаана уу"
    );
  if (document.status !== "posted" || !document.voucherId)
    throw new Error("Зөвхөн батлагдсан нэхэмжлэхийг буцаана");
  await assertPeriodOpen(orgId, document.date);

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
export async function deleteArApDocument(id: string) {
  const { orgId, userId } = await requireAccountant();
  const document = await db.query.arApDocuments.findFirst({
    where: and(eq(arApDocuments.id, id), eq(arApDocuments.organizationId, orgId)),
  });
  if (!document) throw new Error("Баримт олдсонгүй");

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
