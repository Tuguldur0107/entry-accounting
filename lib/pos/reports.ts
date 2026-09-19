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
  accountingPeriods,
  costEntries,
  costPeriodResults,
  posSales,
} from "@/lib/db/schema";
import { periodCodeOf } from "@/lib/periods/period";
import { scopeKey } from "@/lib/costing/periodic";
import { COGS_TRUE_UP_ENTRY_TYPE, PROVISIONAL_VALUATION_SOURCE, type PaymentKind } from "./constants";

export type CogsBasis = "final" | "computed" | "provisional" | "none";

export interface SalesLineRow {
  saleId: string;
  documentNo: string;
  date: string;
  soldAt: string;
  isReturn: boolean;
  status: string;
  cashierName: string;
  counterpartyId: string;
  counterpartyName: string;
  customerGroup: string | null;
  warehouseId: string;
  warehouseName: string;
  shiftNo: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  categoryCode: string | null;
  /** Тэмдэгтэй: буцаалт сөрөг. */
  quantity: number;
  unitPrice: number;
  lineGross: number;
  discountAmount: number;
  netAmount: number;
  vatAmount: number;
  lineTotal: number;
  discountRules: string[];
  paymentSummary: string;
  /** Тэмдэгтэй COGS (буцаалт сөрөг); null = тодорхойгүй. */
  cogs: number | null;
  cogsBasis: CogsBasis;
  /** netAmount − cogs; null бол COGS тодорхойгүй. */
  margin: number | null;
}

export interface SalesPaymentRow {
  saleId: string;
  date: string;
  isReturn: boolean;
  methodId: string;
  methodName: string;
  kind: PaymentKind;
  /** Тэмдэгтэй MNT (хариулт хасагдсан; буцаалт сөрөг). */
  baseAmount: number;
}

export interface SalesReportFilter {
  from: string;
  to: string;
  warehouseId?: string | null;
  counterpartyId?: string | null;
  itemId?: string | null;
  categoryCode?: string | null;
  cashierUserId?: string | null;
  methodId?: string | null;
}

export interface SalesReportData {
  lines: SalesLineRow[];
  payments: SalesPaymentRow[];
  from: string;
  to: string;
}

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
      payments: { with: { method: { columns: { name: true, kind: true } } } },
    },
    orderBy: (sale, { asc }) => [asc(sale.soldAt)],
  });
  const active = sales.filter((sale) => sale.status !== "voided");

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
        baseAmount: sign * (Number(payment.baseAmount) - Number(payment.changeGiven)),
      });
    }
    if (filter.methodId && !sale.payments.some((payment) => payment.paymentMethodId === filter.methodId)) continue;
    for (const line of sale.lines) {
      if (filter.itemId && line.itemId !== filter.itemId) continue;
      const categoryCode = line.item?.categoryCode ?? null;
      if (filter.categoryCode && categoryCode !== filter.categoryCode) continue;
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
        cogs: signedCogs,
        cogsBasis: basis,
        margin: signedCogs === null ? null : Math.round((netAmount - signedCogs) * 100) / 100,
      });
    }
  }
  return { lines, payments, from: filter.from, to: filter.to };
}

// ─── ЦЭВЭР нэгтгэлүүд ────────────────────────────────────────────────────────

export interface AggRow {
  key: string;
  label: string;
  sublabel?: string;
  /** Борлуулалтын баримтын тоо (буцаалт хасагдсан). */
  count: number;
  quantity: number;
  gross: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
  cogs: number | null;
  margin: number | null;
  marginPercent: number | null;
  /** Ямар нэг мөрийн COGS урьдчилсан/тодорхойгүй бол "provisional"/"none". */
  cogsBasis: CogsBasis;
}

const r2 = (value: number) => Math.round(value * 100) / 100;

function weakestBasis(a: CogsBasis, b: CogsBasis): CogsBasis {
  const rank: Record<CogsBasis, number> = { none: 0, provisional: 1, computed: 2, final: 3 };
  return rank[a] <= rank[b] ? a : b;
}

export function aggregateBy(
  lines: SalesLineRow[],
  keyOf: (line: SalesLineRow) => { key: string; label: string; sublabel?: string }
): AggRow[] {
  const map = new Map<string, AggRow & { saleIds: Set<string> }>();
  for (const line of lines) {
    const { key, label, sublabel } = keyOf(line);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        label,
        sublabel,
        count: 0,
        quantity: 0,
        gross: 0,
        discount: 0,
        net: 0,
        vat: 0,
        total: 0,
        cogs: 0,
        margin: 0,
        marginPercent: null,
        cogsBasis: "final",
        saleIds: new Set(),
      };
      map.set(key, row);
    }
    if (!line.isReturn) row.saleIds.add(line.saleId);
    row.quantity += line.quantity;
    row.gross += line.lineGross;
    row.discount += line.discountAmount;
    row.net += line.netAmount;
    row.vat += line.vatAmount;
    row.total += line.lineTotal;
    if (line.cogs === null) {
      row.cogs = null;
      row.margin = null;
      row.cogsBasis = "none";
    } else if (row.cogs !== null) {
      row.cogs += line.cogs;
      row.margin = (row.margin ?? 0) + (line.margin ?? 0);
      row.cogsBasis = weakestBasis(row.cogsBasis, line.cogsBasis);
    }
  }
  return [...map.values()]
    .map((row) => {
      const { saleIds, ...rest } = row;
      const net = r2(rest.net);
      const cogs = rest.cogs === null ? null : r2(rest.cogs);
      const margin = cogs === null ? null : r2(net - cogs);
      return {
        ...rest,
        count: saleIds.size,
        quantity: Math.round(rest.quantity * 10000) / 10000,
        gross: r2(rest.gross),
        discount: r2(rest.discount),
        net,
        vat: r2(rest.vat),
        total: r2(rest.total),
        cogs,
        margin,
        marginPercent: margin === null || net === 0 ? null : Math.round((margin / net) * 10000) / 100,
      };
    })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export interface MethodAggRow {
  methodId: string;
  methodName: string;
  kind: PaymentKind;
  count: number;
  amount: number;
}

export function aggregatePayments(payments: SalesPaymentRow[]): MethodAggRow[] {
  const map = new Map<string, MethodAggRow & { saleIds: Set<string> }>();
  for (const payment of payments) {
    let row = map.get(payment.methodId);
    if (!row) {
      row = { methodId: payment.methodId, methodName: payment.methodName, kind: payment.kind, count: 0, amount: 0, saleIds: new Set() };
      map.set(payment.methodId, row);
    }
    if (!payment.isReturn) row.saleIds.add(payment.saleId);
    row.amount += payment.baseAmount;
  }
  return [...map.values()]
    .map(({ saleIds, ...row }) => ({ ...row, count: saleIds.size, amount: r2(row.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

export interface SalesSummary {
  salesCount: number;
  returnsCount: number;
  gross: number;
  discount: number;
  net: number;
  vat: number;
  total: number;
  returnsTotal: number;
  averageTicket: number;
  cogs: number | null;
  margin: number | null;
  marginPercent: number | null;
  cogsBasis: CogsBasis;
}

export function summarize(lines: SalesLineRow[]): SalesSummary {
  const saleIds = new Set<string>();
  const returnIds = new Set<string>();
  let gross = 0, discount = 0, net = 0, vat = 0, total = 0, returnsTotal = 0;
  let cogs: number | null = 0;
  let basis: CogsBasis = "final";
  for (const line of lines) {
    if (line.isReturn) {
      returnIds.add(line.saleId);
      returnsTotal += -line.lineTotal;
    } else saleIds.add(line.saleId);
    gross += line.lineGross;
    discount += line.discountAmount;
    net += line.netAmount;
    vat += line.vatAmount;
    total += line.lineTotal;
    if (line.cogs === null) {
      cogs = null;
      basis = "none";
    } else if (cogs !== null) {
      cogs += line.cogs;
      basis = weakestBasis(basis, line.cogsBasis);
    }
  }
  const netR = r2(net);
  const cogsR = cogs === null ? null : r2(cogs);
  const margin = cogsR === null ? null : r2(netR - cogsR);
  const salesTotal = r2(total + returnsTotal);
  return {
    salesCount: saleIds.size,
    returnsCount: returnIds.size,
    gross: r2(gross),
    discount: r2(discount),
    net: netR,
    vat: r2(vat),
    total: r2(total),
    returnsTotal: r2(returnsTotal),
    averageTicket: saleIds.size ? r2(salesTotal / saleIds.size) : 0,
    cogs: cogsR,
    margin,
    marginPercent: margin === null || netR === 0 ? null : Math.round((margin / netR) * 10000) / 100,
    cogsBasis: lines.length ? basis : "none",
  };
}

export const COGS_BASIS_LABELS: Record<CogsBasis, string> = {
  final: "Эцсийн (сар хаагдсан)",
  computed: "Тооцоолсон (сар хаагдаагүй)",
  provisional: "Урьдчилсан (явцын дундаж)",
  none: "Тодорхойгүй",
};
