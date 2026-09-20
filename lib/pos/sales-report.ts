// Борлуулалтын тайлангийн ЦЭВЭР давхарга — төрөл + нэгтгэлүүд (тесттэй).
// DB, drizzle, postgres ЭНД ИМПОРТ ХИЙХИЙГ ХОРИГЛОНО: client component
// (components/pos/sales-report-view.tsx) энэ файлаас уншдаг тул server-only
// модуль орвол postgres драйвер browser bundle-д орж `next build` унана
// (fs/net/tls олдохгүй). DB ачаалагч `lib/pos/reports.ts`-д (loadSalesReport).

import type { PaymentKind } from "./constants";

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
  /** ewallet-ийн провайдер ("qpay") — null = гар лавлагаа / бусад төрөл. */
  provider?: string | null;
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
  provider: string | null;
  count: number;
  amount: number;
}

export function aggregatePayments(payments: SalesPaymentRow[]): MethodAggRow[] {
  const map = new Map<string, MethodAggRow & { saleIds: Set<string> }>();
  for (const payment of payments) {
    let row = map.get(payment.methodId);
    if (!row) {
      row = {
        methodId: payment.methodId,
        methodName: payment.methodName,
        kind: payment.kind,
        provider: payment.provider ?? null,
        count: 0,
        amount: 0,
        saleIds: new Set(),
      };
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
