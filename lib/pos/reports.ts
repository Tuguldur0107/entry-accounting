// Борлуулалтын дэлгэрэнгүй тайлан — docs/pos/00-proposal.md §5.
//
// COGS-ийн эх сурвалж (§3.6, "нэг үнэлгээний суурь"): сар хаагдсан →
// cost_period_results-ийн эцсийн дундаж; хаагдаагүй ч тооцоологдсон →
// "тооцоолсон" (ноорог залруулгыг оруулаад); тооцоологдоогүй → урьдчилсан
// бичилт байвал "урьдчилсан", байхгүй бол null ("—"). GL-ээс ХЭЗЭЭ Ч тооцохгүй.
// Нэгтгэлүүд ЦЭВЭР функц (aggregateSalesReport, тесттэй).

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  inventoryCategories,
  accountingPeriods,
  costEntries,
  costPeriodResults,
  posSales,
} from "@/lib/db/schema";
import { periodCodeOf } from "@/lib/periods/period";
import { scopeKey } from "@/lib/costing/periodic";
import { descendantCodes } from "@/lib/inventory/category-tree";
import { COGS_TRUE_UP_ENTRY_TYPE, PROVISIONAL_VALUATION_SOURCE, type PaymentKind } from "./constants";
import type {
  CogsBasis,
  SalesLineRow,
  SalesPaymentRow,
  SalesReportData,
  SalesReportFilter,
} from "./sales-report";

// Төрөл + цэвэр нэгтгэлүүд ./sales-report-оос — server хуудас, AI tool хуучин
// замаараа (энэ файлаас) уншиж болно; client component ЗӨВХӨН ./sales-report.
export * from "./sales-report";


export async function loadSalesReport(orgId: string, filter: SalesReportFilter): Promise<SalesReportData> {
  const conditions = [
    eq(posSales.organizationId, orgId),
    gte(posSales.date, filter.from),
    lte(posSales.date, filter.to),
  ];
  if (filter.warehouseId) conditions.push(eq(posSales.warehouseId, filter.warehouseId));
  if (filter.counterpartyId) conditions.push(eq(posSales.counterpartyId, filter.counterpartyId));
  if (filter.cashierUserId) conditions.push(eq(posSales.cashierUserId, filter.cashierUserId));
  const sales = await db.query.posSales.findMany({
    where: and(...conditions),
    with: {
      shift: { columns: { documentNo: true } },
      warehouse: { columns: { name: true } },
      counterparty: { columns: { name: true, customerGroup: true } },
      cashier: { columns: { name: true } },
      lines: { with: { item: { columns: { code: true, name: true, categoryCode: true } } } },
      payments: { with: { method: { columns: { name: true, kind: true, provider: true } } } },
    },
    orderBy: (sale, { asc }) => [asc(sale.soldAt)],
  });
  const active = sales.filter((sale) => sale.status !== "voided");
  // Ангиллын шүүлт УДАМШЛААР — эцэг ангилал сонгоход дэд ангиллын бараа ч орно.
  const categoryScope = filter.categoryCode
    ? descendantCodes(
        filter.categoryCode,
        (
          await db.query.inventoryCategories.findMany({
            where: eq(inventoryCategories.organizationId, orgId),
            columns: { id: true, code: true, name: true, parentId: true, isActive: true },
          })
        ).map((row) => ({ ...row, parentId: row.parentId ?? null }))
      )
    : null;

  // COGS: period results (scope × сар) + хаагдсан үе + урьдчилсан/залруулгын бичилт.
  const periodCodes = [...new Set(active.map((sale) => periodCodeOf(sale.date)))];
  const itemIds = [...new Set(active.flatMap((sale) => sale.lines.map((line) => line.itemId)))];
  const movementIds = active.flatMap((sale) => sale.lines.map((line) => line.movementId)).filter((id): id is string => !!id);
  const [results, closed, entries] = await Promise.all([
    periodCodes.length && itemIds.length
      ? db.query.costPeriodResults.findMany({
          where: and(
            eq(costPeriodResults.organizationId, orgId),
            inArray(costPeriodResults.periodCode, periodCodes),
            inArray(costPeriodResults.itemId, itemIds),
            eq(costPeriodResults.status, "calculated")
          ),
          columns: { itemId: true, warehouseId: true, periodCode: true, averageUnitCost: true },
        })
      : Promise.resolve([]),
    periodCodes.length
      ? db.query.accountingPeriods.findMany({
          where: and(eq(accountingPeriods.organizationId, orgId), inArray(accountingPeriods.code, periodCodes), eq(accountingPeriods.status, "closed")),
          columns: { code: true },
        })
      : Promise.resolve([]),
    movementIds.length
      ? db.query.costEntries.findMany({
          where: and(
            eq(costEntries.organizationId, orgId),
            inArray(costEntries.movementId, movementIds),
            inArray(costEntries.status, ["draft", "posted"])
          ),
          columns: { movementId: true, entryType: true, amount: true, valuationSource: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const averageByScopePeriod = new Map<string, number | null>();
  for (const row of results)
    averageByScopePeriod.set(
      `${scopeKey(row.itemId, row.warehouseId)}::${row.periodCode}`,
      row.averageUnitCost === null ? null : Number(row.averageUnitCost)
    );
  const closedPeriods = new Set(closed.map((row) => row.code));
  const entriesByMovement = new Map<string, typeof entries>();
  for (const entry of entries) {
    if (!entry.movementId) continue;
    entriesByMovement.set(entry.movementId, [...(entriesByMovement.get(entry.movementId) ?? []), entry]);
  }

  const lines: SalesLineRow[] = [];
  const payments: SalesPaymentRow[] = [];
  for (const sale of active) {
    const sign = sale.isReturn ? -1 : 1;
    const periodCode = periodCodeOf(sale.date);
    const paymentSummary = sale.payments
      .map((payment) => `${payment.method?.name ?? "—"} ${(Number(payment.baseAmount) - Number(payment.changeGiven)).toLocaleString("en-US")}`)
      .join(" · ");
    for (const payment of sale.payments) {
      if (filter.methodId && payment.paymentMethodId !== filter.methodId) continue;
      payments.push({
        saleId: sale.id,
        date: sale.date,
        isReturn: sale.isReturn,
        methodId: payment.paymentMethodId,
        methodName: payment.method?.name ?? "—",
        kind: (payment.method?.kind ?? "cash") as PaymentKind,
        provider: payment.method?.provider ?? null,
        baseAmount: sign * (Number(payment.baseAmount) - Number(payment.changeGiven)),
      });
    }
    if (filter.methodId && !sale.payments.some((payment) => payment.paymentMethodId === filter.methodId)) continue;
    for (const line of sale.lines) {
      if (filter.itemId && line.itemId !== filter.itemId) continue;
      const categoryCode = line.item?.categoryCode ?? null;
      if (categoryScope && !(categoryCode && categoryScope.has(categoryCode))) continue;
      const quantity = Number(line.quantity);
      // ТЭМДЭГТЭЙ COGS (буцаалт сөрөг): эцсийн дундаж → sign × тоо × дундаж;
      // урьдчилсан → sign × |урьдчилсан| + Σ залруулга (залруулга COGS-ийн
      // чиглэлээр тэмдэгтэй хадгалагддаг).
      let signedCogs: number | null = null;
      let basis: CogsBasis = "none";
      const average = averageByScopePeriod.get(`${scopeKey(line.itemId, sale.warehouseId)}::${periodCode}`);
      if (average != null) {
        signedCogs = Math.round(sign * quantity * average * 100) / 100;
        basis = closedPeriods.has(periodCode) ? "final" : "computed";
      } else if (line.movementId) {
        const movementEntries = entriesByMovement.get(line.movementId) ?? [];
        const provisional = movementEntries.find(
          (entry) => entry.valuationSource === PROVISIONAL_VALUATION_SOURCE && entry.status === "posted"
        );
        if (provisional) {
          const trueUps = movementEntries
            .filter((entry) => entry.entryType === COGS_TRUE_UP_ENTRY_TYPE)
            .reduce((sum, entry) => sum + Number(entry.amount), 0);
          signedCogs = Math.round((sign * Math.abs(Number(provisional.amount)) + trueUps) * 100) / 100;
          basis = trueUps !== 0 ? "computed" : "provisional";
        }
      }
      const netAmount = sign * Number(line.netAmount);
      lines.push({
        saleId: sale.id,
        documentNo: sale.documentNo,
        date: sale.date,
        soldAt: sale.soldAt.toISOString(),
        isReturn: sale.isReturn,
        status: sale.status,
        cashierName: sale.cashier?.name ?? "—",
        counterpartyId: sale.counterpartyId,
        counterpartyName: sale.counterparty?.name ?? "—",
        customerGroup: sale.counterparty?.customerGroup ?? null,
        warehouseId: sale.warehouseId,
        warehouseName: sale.warehouse?.name ?? "—",
        shiftNo: sale.shift?.documentNo ?? null,
        itemId: line.itemId,
        itemCode: line.item?.code ?? "",
        itemName: line.item?.name ?? line.description,
        categoryCode,
        quantity: sign * quantity,
        unitPrice: Number(line.unitPrice),
        lineGross: sign * Number(line.lineGross),
        discountAmount: sign * Number(line.discountAmount),
        netAmount,
        vatAmount: sign * Number(line.vatAmount),
        lineTotal: sign * Number(line.lineTotal),
        discountRules: [...new Set((line.discountDetail ?? []).map((detail) => detail.ruleCode ?? detail.kind))],
        paymentSummary,
        ebarimtId: sale.ebarimtId ?? null,
        ebarimtStatus: sale.ebarimtStatus ?? null,
        nonVat: sale.nonVat,
        cogs: signedCogs,
        cogsBasis: basis,
        margin: signedCogs === null ? null : Math.round((netAmount - signedCogs) * 100) / 100,
      });
    }
  }
  return { lines, payments, from: filter.from, to: filter.to };
}
