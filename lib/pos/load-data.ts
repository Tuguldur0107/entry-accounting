// POS-ийн өгөгдөл ачаалагч + тохиргооны ratified-seed — ЭНГИЙН server модуль
// ("use server" БИШ): server action, хуудас, AI tool гурвуул шууд дуудна.
// docs/pos/00-proposal.md §3.1–§3.2.

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  arApDocuments,
  cashAccounts,
  counterparties,
  costEntries,
  inventoryCategories,
  inventoryItems,
  posDiscountRules,
  posPaymentMethods,
  posPayments,
  posSales,
  posSettings,
  posShifts,
  users,
  warehouses,
  type PosSettings,
} from "@/lib/db/schema";
import {
  defaultIssueType,
  ensureAccountsExist,
  seedCreatorUserId,
} from "@/lib/costing/master-data";
import { loadVatSettings } from "@/lib/vat/settings";
import { loadQtyBalancesFast } from "@/lib/inventory/period-balances";
import { toItemVatMode } from "@/lib/inventory/load-data";
import { ancestorCodes, buildCategoryTree } from "@/lib/inventory/category-tree";
import { baseKindOf } from "@/lib/arap/counterparty-kind";
import { loadEntityKinds } from "@/lib/arap/entity-kinds";
import type { PaymentKind } from "./constants";
import type {
  DiscountRule,
  PaymentMethodView,
  PosSaleDetail,
  PosSaleView,
  PosSettingsView,
  PosShiftView,
} from "./types";

export const WALK_IN_CUSTOMER_NAME = "Бэлэн худалдан авагч";
const DEFAULT_RECEIVABLE_ACCOUNT = "13110000";

type QueryHandle = Pick<typeof db, "query" | "select" | "insert" | "update">;

/** Тохиргооны бүх ролийн данс — chart-д байхгүйг стандарт нэрээр нэмнэ. */
function roleAccountsOf(row: PosSettings): string[] {
  return [
    row.revenueAccountNumber,
    row.discountAccountNumber,
    row.giftCardLiabilityAccountNumber,
    row.storeCreditLiabilityAccountNumber,
    row.customerAdvanceAccountNumber,
    row.cashOverAccountNumber,
    row.cashShortAccountNumber,
    row.roundingAccountNumber,
    DEFAULT_RECEIVABLE_ACCOUNT,
  ];
}

/**
 * POS тохиргоо — байхгүй бол default-аар үүсгэнэ (costing/vat-тэй ижил
 * ratified-seed). Мөн "Бэлэн худалдан авагч" харилцагч, анхны зарлагын төрөл,
 * анхны төлбөрийн хэлбэр (Бэлэн / Зээлээр) байхгүй бол үүсгэнэ — идемпотент.
 */
export async function ensurePosSettings(
  orgId: string,
  creatorUserId?: string
): Promise<PosSettings> {
  const resolveUserId = () => seedCreatorUserId(orgId, creatorUserId);
  let row = await db.query.posSettings.findFirst({
    where: eq(posSettings.organizationId, orgId),
  });
  if (!row) {
    const userId = await resolveUserId();
    const [created] = await db
      .insert(posSettings)
      // Шинэ байгууллагад хасах үлдэгдэл АНХДАГЧААР хаалттай (ENT-054) —
      // хэрэглэгч тохиргооноос ил асаана. Хуучин байгууллагын утга хэвээр.
      .values({ userId, organizationId: orgId, allowNegativeStock: false })
      .onConflictDoNothing()
      .returning();
    row =
      created ??
      (await db.query.posSettings.findFirst({
        where: eq(posSettings.organizationId, orgId),
      })) ??
      null;
    if (!row) throw new Error("POS тохиргоо үүсгэж чадсангүй");
  }
  await ensureAccountsExist(orgId, roleAccountsOf(row), resolveUserId);

  const patch: Partial<typeof posSettings.$inferInsert> = {};
  if (!row.walkInCounterpartyId) {
    const userId = await resolveUserId();
    let walkIn = await db.query.counterparties.findFirst({
      where: and(
        eq(counterparties.organizationId, orgId),
        eq(counterparties.name, WALK_IN_CUSTOMER_NAME)
      ),
      columns: { id: true },
    });
    if (!walkIn) {
      const [inserted] = await db
        .insert(counterparties)
        .values({
          userId,
          organizationId: orgId,
          name: WALK_IN_CUSTOMER_NAME,
          counterpartyType: "customer",
          defaultReceivableAccountNumber: DEFAULT_RECEIVABLE_ACCOUNT,
          defaultCurrency: "MNT",
          paymentTermsDays: 0,
        })
        .onConflictDoNothing()
        .returning({ id: counterparties.id });
      walkIn =
        inserted ??
        (await db.query.counterparties.findFirst({
          where: and(
            eq(counterparties.organizationId, orgId),
            eq(counterparties.name, WALK_IN_CUSTOMER_NAME)
          ),
          columns: { id: true },
        })) ??
        null;
    }
    if (walkIn) patch.walkInCounterpartyId = walkIn.id;
  }
  if (!row.issueTypeId) {
    const issueType = await defaultIssueType(orgId);
    if (issueType) patch.issueTypeId = issueType.id;
  }
  if (Object.keys(patch).length > 0) {
    const [updated] = await db
      .update(posSettings)
      .set(patch)
      .where(eq(posSettings.id, row.id))
      .returning();
    if (updated) row = updated;
  }
  await ensureDefaultPaymentMethods(orgId, resolveUserId);
  return row;
}

/** Анхны төлбөрийн хэлбэр: Бэлэн (эхний идэвхтэй кассын данс), Зээлээр. */
async function ensureDefaultPaymentMethods(
  orgId: string,
  resolveUserId: () => Promise<string>
) {
  const existing = await db.query.posPaymentMethods.findMany({
    where: eq(posPaymentMethods.organizationId, orgId),
    columns: { id: true },
  });
  if (existing.length > 0) return;
  const userId = await resolveUserId();
  const cashBox = await db.query.cashAccounts.findFirst({
    where: and(
      eq(cashAccounts.organizationId, orgId),
      eq(cashAccounts.isActive, true),
      eq(cashAccounts.accountType, "cash"),
      eq(cashAccounts.currency, "MNT")
    ),
    columns: { id: true },
  });
  await db
    .insert(posPaymentMethods)
    .values([
      {
        userId,
        organizationId: orgId,
        code: "CASH",
        name: "Бэлэн",
        kind: "cash",
        cashAccountId: cashBox?.id ?? null,
        currency: "MNT",
        allowsChange: true,
        allowsRefund: true,
        ebarimtCode: "CASH",
        sortOrder: 0,
      },
      {
        userId,
        organizationId: orgId,
        code: "CREDIT",
        name: "Зээлээр (дараа төлөх)",
        kind: "credit",
        cashAccountId: null,
        currency: "MNT",
        allowsChange: false,
        allowsRefund: false,
        sortOrder: 90,
      },
    ])
    .onConflictDoNothing();
}

export function toPosSettingsView(row: PosSettings): PosSettingsView {
  return {
    revenueAccountNumber: row.revenueAccountNumber,
    discountAccountNumber: row.discountAccountNumber,
    discountPosting: row.discountPosting === "contra" ? "contra" : "net",
    giftCardLiabilityAccountNumber: row.giftCardLiabilityAccountNumber,
    storeCreditLiabilityAccountNumber: row.storeCreditLiabilityAccountNumber,
    customerAdvanceAccountNumber: row.customerAdvanceAccountNumber,
    cashOverAccountNumber: row.cashOverAccountNumber,
    cashShortAccountNumber: row.cashShortAccountNumber,
    roundingAccountNumber: row.roundingAccountNumber,
    nonVatRevenueAccountNumber: row.nonVatRevenueAccountNumber,
    nonVatReceivableAccountNumber: row.nonVatReceivableAccountNumber,
    walkInCounterpartyId: row.walkInCounterpartyId,
    issueTypeId: row.issueTypeId,
    defaultWarehouseId: row.defaultWarehouseId,
    provisionalCogs: row.provisionalCogs,
    allowNegativeStock: row.allowNegativeStock,
    maxManualDiscountPercent: Number(row.maxManualDiscountPercent),
    maxTotalDiscountPercent: Number(row.maxTotalDiscountPercent),
    discountStacking: row.discountStacking === "cumulative" ? "cumulative" : "best_single",
    cashRoundingUnit: row.cashRoundingUnit,
    receiptHeader: row.receiptHeader,
    receiptFooter: row.receiptFooter,
    ebarimtEnabled: row.ebarimtEnabled,
    ebarimtMerchantTin: row.ebarimtMerchantTin,
    ebarimtBranchNo: row.ebarimtBranchNo,
    ebarimtDistrictCode: row.ebarimtDistrictCode,
    ebarimtPosNo: row.ebarimtPosNo,
    ebarimtPosApiUrl: row.ebarimtPosApiUrl,
    ebarimtMode: row.ebarimtMode === "browser" ? "browser" : "server",
    qpayEnabled: row.qpayEnabled,
    qpayApiUrl: row.qpayApiUrl,
    qpayApiKeySet: !!row.qpayApiKeyEnc,
    qpayWebhookSecretSet: !!row.qpayWebhookSecretEnc,
    qpayMerchantId: row.qpayMerchantId,
    qpayInvoiceTtlSec: row.qpayInvoiceTtlSec,
  };
}

export async function loadPaymentMethodViews(
  orgId: string,
  handle: QueryHandle = db
): Promise<PaymentMethodView[]> {
  const rows = await handle.query.posPaymentMethods.findMany({
    where: eq(posPaymentMethods.organizationId, orgId),
    with: { cashAccount: { columns: { name: true } } },
    orderBy: (method, { asc }) => [asc(method.sortOrder), asc(method.code)],
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind as PaymentKind,
    cashAccountId: row.cashAccountId,
    cashAccountName: row.cashAccount?.name ?? null,
    currency: row.currency,
    requiresReference: row.requiresReference,
    allowsChange: row.allowsChange,
    allowsRefund: row.allowsRefund,
    feePercent: row.feePercent === null ? null : Number(row.feePercent),
    ebarimtCode: row.ebarimtCode ?? null,
    provider: row.provider ?? null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  }));
}

export async function loadDiscountRuleViews(
  orgId: string,
  handle: QueryHandle = db
): Promise<DiscountRule[]> {
  const rows = await handle.query.posDiscountRules.findMany({
    where: eq(posDiscountRules.organizationId, orgId),
    orderBy: (rule, { asc }) => [asc(rule.priority), asc(rule.code)],
  });
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    ruleType: row.ruleType as DiscountRule["ruleType"],
    scope: row.scope as DiscountRule["scope"],
    scopeRef: row.scopeRef,
    valueType: row.valueType as DiscountRule["valueType"],
    value: Number(row.value),
    minQty: row.minQty === null ? null : Number(row.minQty),
    minAmount: row.minAmount === null ? null : Number(row.minAmount),
    buyQty: row.buyQty === null ? null : Number(row.buyQty),
    getQty: row.getQty === null ? null : Number(row.getQty),
    tiers: row.tiers ?? null,
    dateFrom: row.dateFrom,
    dateTo: row.dateTo,
    timeFrom: row.timeFrom,
    timeTo: row.timeTo,
    weekdays: row.weekdays,
    couponCode: row.couponCode,
    maxUsesTotal: row.maxUsesTotal,
    maxUsesPerCustomer: row.maxUsesPerCustomer,
    usedCount: row.usedCount,
    stackable: row.stackable,
    priority: row.priority,
    requiresApproval: row.requiresApproval,
    isActive: row.isActive,
  }));
}

const fmtTs = (value: Date | null) => (value ? value.toISOString() : null);

export async function loadShiftViews(
  orgId: string,
  options?: { openOnly?: boolean; limit?: number }
): Promise<PosShiftView[]> {
  const rows = await db.query.posShifts.findMany({
    where: options?.openOnly
      ? and(eq(posShifts.organizationId, orgId), eq(posShifts.status, "open"))
      : eq(posShifts.organizationId, orgId),
    with: {
      cashAccount: { columns: { name: true } },
      warehouse: { columns: { name: true } },
      opener: { columns: { name: true } },
    },
    orderBy: (shift, { desc: descOrder }) => [descOrder(shift.openedAt)],
    limit: options?.limit ?? 200,
  });
  if (rows.length === 0) return [];
  const shiftIds = rows.map((row) => row.id);
  const closerIds = [...new Set(rows.map((row) => row.closedBy).filter((id): id is string => !!id))];
  const [closers, sales, paymentRows] = await Promise.all([
    closerIds.length
      ? db.query.users.findMany({ where: inArray(users.id, closerIds), columns: { id: true, name: true } })
      : Promise.resolve([]),
    db.query.posSales.findMany({
      where: and(eq(posSales.organizationId, orgId), inArray(posSales.shiftId, shiftIds)),
      columns: { id: true, shiftId: true, total: true, isReturn: true, status: true },
    }),
    db
      .select({
        shiftId: posSales.shiftId,
        isReturn: posSales.isReturn,
        kind: posPaymentMethods.kind,
        code: posPaymentMethods.code,
        name: posPaymentMethods.name,
        baseAmount: posPayments.baseAmount,
        changeGiven: posPayments.changeGiven,
      })
      .from(posPayments)
      .innerJoin(posSales, eq(posSales.id, posPayments.saleId))
      .innerJoin(posPaymentMethods, eq(posPaymentMethods.id, posPayments.paymentMethodId))
      .where(and(eq(posSales.organizationId, orgId), inArray(posSales.shiftId, shiftIds))),
  ]);
  const closerName = new Map(closers.map((user) => [user.id, user.name]));
  const summary = new Map<
    string,
    {
      salesCount: number;
      salesTotal: number;
      cashReceipts: number;
      cashRefunds: number;
      returnsTotal: number;
      byMethod: Map<string, PosShiftView["paymentsByMethod"][number]>;
    }
  >();
  const of = (id: string) => {
    const current = summary.get(id) ?? {
      salesCount: 0,
      salesTotal: 0,
      cashReceipts: 0,
      cashRefunds: 0,
      returnsTotal: 0,
      byMethod: new Map(),
    };
    summary.set(id, current);
    return current;
  };
  for (const sale of sales) {
    if (!sale.shiftId || sale.status === "voided") continue;
    const entry = of(sale.shiftId);
    if (sale.isReturn) entry.returnsTotal += Number(sale.total);
    else {
      entry.salesCount += 1;
      entry.salesTotal += Number(sale.total);
    }
  }
  for (const payment of paymentRows) {
    if (!payment.shiftId) continue;
    const entry = of(payment.shiftId);
    const net = Number(payment.baseAmount) - Number(payment.changeGiven);
    // Хэлбэр бүрийн цэвэр дүн (борлуулалт +, буцаалт −) — Z-тайлан, ээлж
    // хаалтын хариунд бэлэн биш хэлбэрийн дүн ил гарна.
    const method = entry.byMethod.get(payment.code) ?? {
      code: payment.code,
      name: payment.name,
      kind: payment.kind,
      amount: 0,
    };
    method.amount += payment.isReturn ? -net : net;
    entry.byMethod.set(payment.code, method);
    // Системийн бэлэн мөнгө = ЗӨВХӨН cash хэлбэр.
    if (payment.kind !== "cash") continue;
    if (payment.isReturn) entry.cashRefunds += net;
    else entry.cashReceipts += net;
  }
  return rows.map((row) => {
    const entry = summary.get(row.id) ?? {
      salesCount: 0,
      salesTotal: 0,
      cashReceipts: 0,
      cashRefunds: 0,
      returnsTotal: 0,
      byMethod: new Map<string, PosShiftView["paymentsByMethod"][number]>(),
    };
    return {
      id: row.id,
      documentNo: row.documentNo,
      cashAccountId: row.cashAccountId,
      cashAccountName: row.cashAccount?.name ?? "—",
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse?.name ?? "—",
      openedByName: row.opener?.name ?? "—",
      openedAt: row.openedAt.toISOString(),
      openingFloat: Number(row.openingFloat),
      closedByName: row.closedBy ? (closerName.get(row.closedBy) ?? null) : null,
      closedAt: fmtTs(row.closedAt),
      countedCash: row.countedCash === null ? null : Number(row.countedCash),
      systemCash: row.systemCash === null ? null : Number(row.systemCash),
      varianceAmount: row.varianceAmount === null ? null : Number(row.varianceAmount),
      varianceCashDocumentId: row.varianceCashDocumentId,
      fxRates: row.fxRates ?? {},
      status: row.status === "closed" ? "closed" : "open",
      note: row.note,
      // byMethod (Map) нь client prop-оор сериалжихгүй тул spread хийхгүй —
      // талбар бүрийг ил өгнө.
      salesCount: entry.salesCount,
      salesTotal: Math.round(entry.salesTotal * 100) / 100,
      cashReceipts: Math.round(entry.cashReceipts * 100) / 100,
      cashRefunds: Math.round(entry.cashRefunds * 100) / 100,
      returnsTotal: Math.round(entry.returnsTotal * 100) / 100,
      paymentsByMethod: [...entry.byMethod.values()]
        .map((method) => ({ ...method, amount: Math.round(method.amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount),
    };
  });
}

function paymentSummaryOf(
  payments: { methodName: string; baseAmount: number; changeGiven: number }[]
): string {
  return payments
    .map(
      (payment) =>
        `${payment.methodName} ${(payment.baseAmount - payment.changeGiven).toLocaleString("en-US")}`
    )
    .join(" · ");
}

export interface SaleFilter {
  from?: string;
  to?: string;
  status?: string;
  shiftId?: string;
  counterpartyId?: string;
  limit?: number;
}

export async function loadSaleViews(orgId: string, filter: SaleFilter = {}): Promise<PosSaleView[]> {
  const conditions = [eq(posSales.organizationId, orgId)];
  if (filter.from) conditions.push(gte(posSales.date, filter.from));
  if (filter.to) conditions.push(lte(posSales.date, filter.to));
  if (filter.status) conditions.push(eq(posSales.status, filter.status));
  if (filter.shiftId) conditions.push(eq(posSales.shiftId, filter.shiftId));
  if (filter.counterpartyId) conditions.push(eq(posSales.counterpartyId, filter.counterpartyId));
  const rows = await db.query.posSales.findMany({
    where: and(...conditions),
    with: {
      shift: { columns: { documentNo: true } },
      warehouse: { columns: { name: true } },
      counterparty: { columns: { name: true } },
      cashier: { columns: { name: true } },
      arApDocument: { columns: { documentNo: true, status: true } },
      payments: { with: { method: { columns: { name: true } } } },
      lines: { columns: { id: true } },
    },
    orderBy: [desc(posSales.soldAt)],
    limit: filter.limit ?? 500,
  });
  const originalIds = [...new Set(rows.map((row) => row.originalSaleId).filter((id): id is string => !!id))];
  const originals = originalIds.length
    ? await db.query.posSales.findMany({
        where: inArray(posSales.id, originalIds),
        columns: { id: true, documentNo: true },
      })
    : [];
  const originalNo = new Map(originals.map((row) => [row.id, row.documentNo]));
  const walkInId = await loadWalkInCounterpartyId(orgId);
  return rows.map((row) => toSaleView(row, originalNo.get(row.originalSaleId ?? "") ?? null, walkInId));
}

type SaleRowWith = typeof posSales.$inferSelect & {
  shift: { documentNo: string } | null;
  warehouse: { name: string } | null;
  counterparty: { name: string } | null;
  cashier: { name: string } | null;
  arApDocument: { documentNo: string; status: string } | null;
  payments: (typeof posPayments.$inferSelect & { method: { name: string } | null })[];
  lines: { id: string }[];
};

/** Тохиргооны бэлэн худалдан авагчийн ID — тохиргоо үүсээгүй бол null (сонголт үүсгэхгүй). */
async function loadWalkInCounterpartyId(orgId: string): Promise<string | null> {
  const row = await db.query.posSettings.findFirst({
    where: eq(posSettings.organizationId, orgId),
    columns: { walkInCounterpartyId: true },
  });
  return row?.walkInCounterpartyId ?? null;
}

function toSaleView(
  row: SaleRowWith,
  originalSaleNo: string | null,
  walkInCounterpartyId: string | null
): PosSaleView {
  return {
    id: row.id,
    documentNo: row.documentNo,
    date: row.date,
    soldAt: row.soldAt.toISOString(),
    shiftId: row.shiftId,
    shiftNo: row.shift?.documentNo ?? null,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse?.name ?? "—",
    counterpartyId: row.counterpartyId,
    counterpartyName: row.counterparty?.name ?? "—",
    isWalkIn: walkInCounterpartyId != null && row.counterpartyId === walkInCounterpartyId,
    cashierName: row.cashier?.name ?? "—",
    grossAmount: Number(row.grossAmount),
    discountTotal: Number(row.discountTotal),
    netAmount: Number(row.netAmount),
    vatAmount: Number(row.vatAmount),
    roundingAmount: Number(row.roundingAmount),
    total: Number(row.total),
    status: row.status,
    isReturn: row.isReturn,
    originalSaleId: row.originalSaleId,
    originalSaleNo,
    returnReason: row.returnReason,
    arApDocumentId: row.arApDocumentId,
    arApDocumentNo: row.arApDocument?.documentNo ?? null,
    arApStatus: row.arApDocument?.status ?? null,
    ebarimtId: row.ebarimtId,
    ebarimtStatus: row.ebarimtStatus,
    ebarimtDate: row.ebarimtDate,
    ebarimtType: row.ebarimtType,
    ebarimtConsumerNo: row.ebarimtConsumerNo,
    ebarimtCustomerTin: row.ebarimtCustomerTin,
    nonVat: row.nonVat,
    nonVatReason: row.nonVatReason,
    note: row.note,
    paymentSummary: paymentSummaryOf(
      row.payments.map((payment) => ({
        methodName: payment.method?.name ?? "—",
        baseAmount: Number(payment.baseAmount),
        changeGiven: Number(payment.changeGiven),
      }))
    ),
    lineCount: row.lines.length,
  };
}

export async function loadSaleDetail(orgId: string, saleId: string): Promise<PosSaleDetail | null> {
  const row = await db.query.posSales.findFirst({
    where: and(eq(posSales.id, saleId), eq(posSales.organizationId, orgId)),
    with: {
      shift: { columns: { documentNo: true } },
      warehouse: { columns: { name: true } },
      counterparty: { columns: { name: true } },
      cashier: { columns: { name: true } },
      arApDocument: { columns: { documentNo: true, status: true, voucherId: true } },
      payments: {
        with: { method: { columns: { name: true, kind: true } }, cashDocument: { columns: { voucherId: true } } },
        orderBy: (payment, { asc }) => [asc(payment.sortOrder)],
      },
      lines: {
        with: { item: { columns: { code: true, name: true, unit: true } } },
        orderBy: (line, { asc }) => [asc(line.sortOrder)],
      },
      discounts: { with: { rule: { columns: { code: true } } } },
    },
  });
  if (!row) return null;
  const [original, returns, provisional] = await Promise.all([
    row.originalSaleId
      ? db.query.posSales.findFirst({
          where: eq(posSales.id, row.originalSaleId),
          columns: { documentNo: true },
        })
      : Promise.resolve(null),
    db.query.posSales.findMany({
      where: and(eq(posSales.organizationId, orgId), eq(posSales.originalSaleId, saleId)),
      columns: { id: true, documentNo: true, date: true, total: true },
      with: { lines: { columns: { originalLineId: true, quantity: true } } },
    }),
    row.lines.some((line) => line.provisionalCostEntryId)
      ? db.query.costEntries.findMany({
          where: inArray(
            costEntries.id,
            row.lines.map((line) => line.provisionalCostEntryId).filter((id): id is string => !!id)
          ),
          columns: { id: true, amount: true, voucherId: true },
        })
      : Promise.resolve([]),
  ]);
  const returnedByLine = new Map<string, number>();
  for (const ret of returns)
    for (const line of ret.lines)
      if (line.originalLineId)
        returnedByLine.set(
          line.originalLineId,
          (returnedByLine.get(line.originalLineId) ?? 0) + Number(line.quantity)
        );
  const provisionalById = new Map(provisional.map((entry) => [entry.id, entry]));
  const voucherIds = new Set<string>();
  if (row.arApDocument?.voucherId) voucherIds.add(row.arApDocument.voucherId);
  for (const payment of row.payments) {
    if (payment.cashDocument?.voucherId) voucherIds.add(payment.cashDocument.voucherId);
    if (payment.voucherId) voucherIds.add(payment.voucherId);
  }
  for (const entry of provisional) if (entry.voucherId) voucherIds.add(entry.voucherId);

  const base = toSaleView(
    { ...row, payments: row.payments.map((payment) => ({ ...payment, method: payment.method })) },
    original?.documentNo ?? null,
    await loadWalkInCounterpartyId(orgId)
  );
  return {
    ...base,
    lines: row.lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemCode: line.item?.code ?? "",
      itemName: line.item?.name ?? line.description,
      unit: line.item?.unit ?? "",
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      lineGross: Number(line.lineGross),
      discountAmount: Number(line.discountAmount),
      discountDetail: (line.discountDetail ?? []).map((detail) => ({
        ruleId: detail.ruleId ?? null,
        ruleCode: detail.ruleCode ?? null,
        kind: detail.kind as "auto" | "manual" | "coupon" | "receipt",
        amount: detail.amount,
      })),
      vatMode: toItemVatMode(line.vatMode),
      netAmount: Number(line.netAmount),
      vatAmount: Number(line.vatAmount),
      lineTotal: Number(line.lineTotal),
      returnedQty: returnedByLine.get(line.id) ?? 0,
      movementId: line.movementId,
      provisionalCostEntryId: line.provisionalCostEntryId,
      provisionalCost: line.provisionalCostEntryId
        ? Number(provisionalById.get(line.provisionalCostEntryId)?.amount ?? 0)
        : null,
    })),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      methodId: payment.paymentMethodId,
      methodName: payment.method?.name ?? "—",
      kind: (payment.method?.kind ?? "cash") as PaymentKind,
      amount: Number(payment.amount),
      currency: payment.currency,
      exchangeRate: Number(payment.exchangeRate),
      baseAmount: Number(payment.baseAmount),
      changeGiven: Number(payment.changeGiven),
      reference: payment.reference,
      cashDocumentId: payment.cashDocumentId,
      voucherId: payment.voucherId ?? payment.cashDocument?.voucherId ?? null,
    })),
    discounts: row.discounts.map((discount) => ({
      id: discount.id,
      ruleCode: discount.rule?.code ?? null,
      kind: discount.kind,
      amount: Number(discount.amount),
      note: discount.note,
    })),
    voucherIds: [...voucherIds],
    returns: returns.map((ret) => ({
      id: ret.id,
      documentNo: ret.documentNo,
      date: ret.date,
      total: Number(ret.total),
    })),
  };
}

export interface CheckoutItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  barcode: string | null;
  categoryCode: string | null;
  /** Ангиллын өвөг кодууд [өөр, эцэг, …] (олон түвшинтэй ангилал). */
  categoryPath: string[];
  salesPrice: number | null;
  minSalesPrice: number | null;
  vatMode: "standard" | "exempt" | "zero";
}

export interface CheckoutCustomer {
  id: string;
  name: string;
  /**
   * СУУРЬ субъект ("organization" | "individual") — динамик төрлөөс
   * `baseKindOf`-оор. Байгууллага бол eBarimt худалдан авагчийн блок B2B-ээр
   * урьдчилан бөглөгдөнө.
   */
  entityKind: string;
  registerNo: string | null;
  customerGroup: string | null;
  creditLimit: number | null;
  isWalkIn: boolean;
}

/** Кассын дэлгэцийн сүүлийн ээлжийн default-ууд (нэг товчны нээлт, §4.1). */
export interface CheckoutLastShift {
  cashAccountId: string;
  warehouseId: string;
  /** Сүүлийн ХААГДСАН ээлжийн тоолсон бэлэн — дараагийн эхний мөнгөний санал. */
  countedCash: number | null;
  closedAt: string | null;
}

export interface CheckoutData {
  settings: PosSettingsView;
  isVatPayer: boolean;
  vatRatePercent: number;
  items: CheckoutItem[];
  /**
   * Барааны ангиллууд (tile-ийн шүүлтүүрийн chip) — ЭХНИЙ ТҮВШНИЙ идэвхтэй
   * ангилал, кодоор эрэмбэлсэн. Chip нь дэд ангиллын барааг ч багтаана
   * (`CheckoutItem.categoryPath`).
   */
  categories: { code: string; name: string }[];
  warehouses: { id: string; code: string; name: string }[];
  cashAccounts: { id: string; name: string; currency: string; accountType: string }[];
  customers: CheckoutCustomer[];
  methods: PaymentMethodView[];
  rules: DiscountRule[];
  openShifts: PosShiftView[];
  /** "itemId|warehouseId" → үлдэгдэл (өнөөдөр). */
  stock: Record<string, number>;
  /** Сүүлийн ээлж (нээлттэй эсвэл хаагдсан) — ээлж нээх диалогийн default. */
  lastShift: CheckoutLastShift | null;
}

export async function loadCheckoutData(orgId: string, userId: string): Promise<CheckoutData> {
  const settings = await ensurePosSettings(orgId, userId);
  const entityKinds = await loadEntityKinds(orgId);
  const [
    vat,
    items,
    categoryRows,
    warehouseRows,
    cashRows,
    customerRows,
    methods,
    rules,
    openShifts,
    stock,
    lastShiftRow,
  ] = await Promise.all([
      loadVatSettings(orgId, userId),
      db.query.inventoryItems.findMany({
        where: and(eq(inventoryItems.organizationId, orgId), eq(inventoryItems.isActive, true)),
        orderBy: (item, { asc }) => [asc(item.code)],
      }),
      db.query.inventoryCategories.findMany({
        where: and(eq(inventoryCategories.organizationId, orgId), eq(inventoryCategories.isActive, true)),
        columns: { id: true, code: true, name: true, parentId: true, isActive: true },
        orderBy: (category, { asc }) => [asc(category.code)],
      }),
      db.query.warehouses.findMany({
        where: and(eq(warehouses.organizationId, orgId), eq(warehouses.isActive, true)),
        orderBy: (warehouse, { asc }) => [asc(warehouse.code)],
      }),
      db.query.cashAccounts.findMany({
        where: and(eq(cashAccounts.organizationId, orgId), eq(cashAccounts.isActive, true)),
        orderBy: (account, { asc }) => [asc(account.name)],
      }),
      db.query.counterparties.findMany({
        where: and(
          eq(counterparties.organizationId, orgId),
          eq(counterparties.isActive, true),
          inArray(counterparties.counterpartyType, ["customer", "both"])
        ),
        orderBy: (cp, { asc }) => [asc(cp.name)],
      }),
      loadPaymentMethodViews(orgId),
      loadDiscountRuleViews(orgId),
      loadShiftViews(orgId, { openOnly: true }),
      loadQtyBalancesFast(orgId),
      db.query.posShifts.findFirst({
        where: eq(posShifts.organizationId, orgId),
        columns: { cashAccountId: true, warehouseId: true, countedCash: true, closedAt: true, status: true },
        orderBy: (shift, { desc: descOrder }) => [descOrder(shift.openedAt)],
      }),
    ]);
  const stockRecord: Record<string, number> = {};
  for (const [key, qty] of stock) stockRecord[key] = qty;
  // Олон түвшинтэй ангилал: chip = эхний түвшин (эцэг нь идэвхгүй/алга бол
  // тухайн идэвхтэй ангилал өөрөө эхний түвшин болно — buildCategoryTree).
  const categoryNodes = categoryRows.map((row) => ({ ...row, parentId: row.parentId ?? null }));
  const categoryMap = new Map(
    buildCategoryTree(categoryNodes)
      .filter((row) => row.depth === 1)
      .map((row) => [row.node.code, row.node.name])
  );
  // Ангиллын лавлахад байхгүй кодтой бараа (импортоор орсон) — chip-д кодоороо гарна.
  for (const item of items)
    if (item.categoryCode && !categoryNodes.some((node) => node.code === item.categoryCode))
      categoryMap.set(item.categoryCode, item.categoryCode);
  return {
    settings: toPosSettingsView(settings),
    isVatPayer: vat.isVatPayer,
    vatRatePercent: Number(vat.vatRatePercent),
    categories: [...categoryMap.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    items: items.map((item) => ({
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      barcode: item.barcode,
      categoryCode: item.categoryCode,
      categoryPath: item.categoryCode ? ancestorCodes(item.categoryCode, categoryNodes) : [],
      salesPrice: item.salesPrice === null ? null : Number(item.salesPrice),
      minSalesPrice: item.minSalesPrice === null ? null : Number(item.minSalesPrice),
      vatMode: toItemVatMode(item.vatMode),
    })),
    warehouses: warehouseRows.map((warehouse) => ({
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
    })),
    cashAccounts: cashRows.map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      accountType: account.accountType,
    })),
    customers: customerRows.map((cp) => ({
      id: cp.id,
      name: cp.name,
      entityKind: baseKindOf(cp.entityKind, entityKinds),
      registerNo: cp.registerNo,
      customerGroup: cp.customerGroup,
      creditLimit: cp.creditLimit === null ? null : Number(cp.creditLimit),
      isWalkIn: cp.id === settings.walkInCounterpartyId,
    })),
    methods,
    rules,
    openShifts,
    stock: stockRecord,
    lastShift: lastShiftRow
      ? {
          cashAccountId: lastShiftRow.cashAccountId,
          warehouseId: lastShiftRow.warehouseId,
          countedCash:
            lastShiftRow.status === "closed" && lastShiftRow.countedCash != null
              ? Number(lastShiftRow.countedCash)
              : null,
          closedAt: lastShiftRow.closedAt ? lastShiftRow.closedAt.toISOString() : null,
        }
      : null,
  };
}

/** Харилцагчийн нээлттэй авлага (MNT) — зээлийн лимитийн шалгалтад. */
export async function loadOpenReceivable(
  handle: QueryHandle,
  orgId: string,
  counterpartyId: string
): Promise<number> {
  const [row] = await handle
    .select({
      open: sql<string>`coalesce(sum(${arApDocuments.baseTotalAmount} - ${arApDocuments.basePaidAmount}), 0)`,
    })
    .from(arApDocuments)
    .where(
      and(
        eq(arApDocuments.organizationId, orgId),
        eq(arApDocuments.counterpartyId, counterpartyId),
        eq(arApDocuments.documentType, "ar_invoice"),
        inArray(arApDocuments.status, ["posted", "partially_paid"])
      )
    );
  return Number(row?.open ?? 0);
}
