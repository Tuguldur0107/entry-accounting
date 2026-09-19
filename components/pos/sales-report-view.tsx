"use client";

// Борлуулалтын дэлгэрэнгүй тайлан — docs/pos/00-proposal.md §5.
// Бараа материал → Тайлан → "Борлуулалт" таб. Өгөгдөл нь page.tsx-ээс
// (loadSalesReport) ирнэ; энд ЗӨВХӨН цэвэр нэгтгэл (aggregateBy / summarize /
// aggregatePayments — lib/pos/sales-report.ts) + харуулалт. Шүүлтүүр бүр URL
// параметр (wh, cashier, cp, method, item, cat) — хуудас сервер талд дахин
// ачаална; дэд таб `view`, огноо `start`/`end` (тоо хэмжээний табтай нийтлэг).
//
// Бүх элемент ui-kit-ээс: DataGridDynamic (pinned нийт), PageTabs,
// SearchableSelect, EmptyState, Button, Input — шинэ component бичихгүй.
// Мөр дээр ДАВХАР даралт → POS борлуулалтын панель (жагсаалтын стандарт).

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColDef, ICellRendererParams, RowDoubleClickedEvent } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { PageTabs } from "@/components/ui/tabs";
import { downloadWorkbook, type ExportColumn } from "@/lib/excel/core";
import { PAYMENT_KIND_LABELS, type PaymentKind } from "@/lib/pos/constants";
import {
  aggregateBy,
  aggregatePayments,
  COGS_BASIS_LABELS,
  summarize,
  type AggRow,
  type CogsBasis,
  type MethodAggRow,
  type SalesLineRow,
  type SalesReportData,
  type SalesSummary,
} from "@/lib/pos/sales-report";
import { fmtMnt } from "@/lib/reports/balances";
import { openPosSalePanel } from "@/lib/store/panel-store";

// ─── Тайлангийн хуудасны дээд таб (тоо хэмжээ / борлуулалт) ──────────────────

export type InventoryReportTab = "flow" | "sales";

const REPORT_TABS: { value: InventoryReportTab; label: string }[] = [
  { value: "flow", label: "Тоо хэмжээний урсгал" },
  { value: "sales", label: "Борлуулалт" },
];

/** Огнооны муж (start/end) хоёр табд нийтлэг тул таб солиход дагуулна. */
export function InventoryReportTabs({ value }: { value: InventoryReportTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <PageTabs
      size="md"
      ariaLabel="Бараа материалын тайлан"
      value={value}
      tabs={REPORT_TABS}
      onChange={(next) => {
        if (next === value) return;
        const params = new URLSearchParams();
        for (const key of ["start", "end"]) {
          const carried = searchParams.get(key);
          if (carried) params.set(key, carried);
        }
        if (next === "sales") params.set("tab", "sales");
        router.push(params.size ? `${pathname}?${params}` : pathname);
      }}
    />
  );
}

// ─── Дэд таб ─────────────────────────────────────────────────────────────────

export const SALES_VIEWS = [
  "lines",
  "items",
  "days",
  "cashiers",
  "methods",
  "customers",
  "rules",
] as const;
export type SalesView = (typeof SALES_VIEWS)[number];

const VIEW_TABS: { value: SalesView; label: string }[] = [
  { value: "lines", label: "Гүйлгээ" },
  { value: "items", label: "Бараагаар" },
  { value: "days", label: "Өдрөөр" },
  { value: "cashiers", label: "Кассчинаар" },
  { value: "methods", label: "Төлбөрийн хэлбэрээр" },
  { value: "customers", label: "Харилцагчаар" },
  { value: "rules", label: "Хөнгөлөлтийн үр ашиг" },
];

export function isSalesView(value: string | undefined | null): value is SalesView {
  return SALES_VIEWS.includes(value as SalesView);
}

export interface SalesReportFilters {
  warehouseId: string | null;
  cashierUserId: string | null;
  counterpartyId: string | null;
  methodId: string | null;
  itemId: string | null;
  categoryCode: string | null;
}

export interface SalesReportOptions {
  warehouses: SearchableOption[];
  cashiers: SearchableOption[];
  customers: SearchableOption[];
  methods: SearchableOption[];
  items: SearchableOption[];
  categories: SearchableOption[];
}

// ─── Нүдний туслахууд ────────────────────────────────────────────────────────

const ANY = "";

/** Өдрийн баганын богино шошго — PAYMENT_KIND_LABELS толгойд урт. */
const KIND_SHORT: Record<PaymentKind, string> = {
  cash: "Бэлэн",
  cash_fx: "Бэлэн (валют)",
  card: "Карт",
  ewallet: "QPay / Wallet",
  transfer: "Шилжүүлэг",
  credit: "Зээлээр",
  advance: "Урьдчилгаа",
  gift_card: "Бэлгийн карт",
  store_credit: "Дэлгүүрийн кредит",
  bnpl: "BNPL",
};

const BASIS_SUFFIX: Partial<Record<CogsBasis, string>> = {
  provisional: "урьдчилсан",
  computed: "тооцоолсон",
};

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

const fmtPct = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** soldAt (ISO) → УБ цагаар "YYYY-MM-DD HH:mm". */
function fmtSoldAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
}

const numberCell = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  context: { export: "number" },
};

const moneyCell = {
  ...numberCell,
  valueFormatter: (params: { value: unknown }) =>
    params.value === null || params.value === undefined ? "—" : fmtMnt(Number(params.value)),
};

const qtyCell = {
  ...numberCell,
  valueFormatter: (params: { value: unknown }) =>
    params.value === null || params.value === undefined ? "—" : fmtQty(Number(params.value)),
};

const pctCell = {
  ...numberCell,
  valueFormatter: (params: { value: unknown }) =>
    fmtPct(params.value === null || params.value === undefined ? null : Number(params.value)),
};

/**
 * COGS / ахиуцын нүд: null → "—"; суурь нь эцсийн биш бол "урьдчилсан" /
 * "тооцоолсон" дагавар анхааруулгын өнгөөр (§5 "COGS-ийн эх сурвалж").
 */
function cogsCell<T extends { cogsBasis: CogsBasis }>(): Partial<ColDef<T>> {
  return {
    ...numberCell,
    cellRenderer: (params: ICellRendererParams<T>) => {
      const value = params.value as number | null | undefined;
      if (value === null || value === undefined) return <span>—</span>;
      const basis = params.data?.cogsBasis ?? "final";
      const suffix = BASIS_SUFFIX[basis];
      return (
        <span>
          {fmtMnt(Number(value))}
          {suffix ? (
            <span className="ml-1 text-[10px]" style={{ color: "var(--ea-warning-fg)" }}>
              {suffix}
            </span>
          ) : null}
        </span>
      );
    },
  };
}

// ─── Мөрийн төрлүүд ──────────────────────────────────────────────────────────

type LineRow = SalesLineRow & { rowId: string; itemLabel: string; rulesLabel: string };

type ItemRow = AggRow & {
  itemId: string;
  code: string;
  name: string;
  category: string;
  returnedQty: number;
  stock: number | null;
};

type DayRow = SalesSummary & {
  date: string;
  saleIds: string[];
  /** kind → тэмдэгтэй дүн. */
  byKind: Record<string, number>;
};

type CashierRow = SalesSummary & { cashierName: string; discountPct: number | null };

type CustomerRow = SalesSummary & {
  counterpartyId: string;
  counterpartyName: string;
  customerGroup: string;
  saleIds: string[];
};

type RuleRow = {
  rule: string;
  lineCount: number;
  discount: number;
  net: number;
  margin: number | null;
  cogsBasis: CogsBasis;
};

/** Нэг бүлгийн мөрүүдийг summarize-аар нэгтгэнэ (buцаалт, дундаж чек зөв). */
function groupSummaries<K extends string>(
  lines: SalesLineRow[],
  keyOf: (line: SalesLineRow) => K
): Map<K, { lines: SalesLineRow[]; summary: SalesSummary }> {
  const groups = new Map<K, SalesLineRow[]>();
  for (const line of lines) {
    const key = keyOf(line);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const out = new Map<K, { lines: SalesLineRow[]; summary: SalesSummary }>();
  for (const [key, group] of groups) out.set(key, { lines: group, summary: summarize(group) });
  return out;
}

const uniqueSaleIds = (lines: SalesLineRow[]) => [...new Set(lines.map((line) => line.saleId))];

/** Excel: баганын field-ийг мөрөөс шууд уншина (valueGetter-гүй багана л). */
async function exportRows<T extends object>(input: {
  slug: string;
  sheetName: string;
  columns: ColDef<T>[];
  rows: T[];
}) {
  const columns = input.columns.filter((column) => column.field);
  const exportColumns: ExportColumn[] = columns.map((column) => ({
    header: column.headerName ?? String(column.field),
    width: 18,
    kind: column.context?.export === "number" ? "number" : "text",
  }));
  await downloadWorkbook({
    slug: input.slug,
    sheetName: input.sheetName,
    columns: exportColumns,
    rows: input.rows.map((row) =>
      columns.map((column) => {
        const value = (row as Record<string, unknown>)[String(column.field)];
        if (value === null || value === undefined) return null;
        if (typeof value === "number" || typeof value === "string") return value;
        return String(value);
      })
    ),
  });
}

// ─── Гол component ───────────────────────────────────────────────────────────

export function SalesReportView({
  data,
  start,
  end,
  view,
  filters,
  options,
  stock,
}: {
  data: SalesReportData;
  start: string;
  end: string;
  view: SalesView;
  filters: SalesReportFilters;
  options: SalesReportOptions;
  /** itemId → бүх агуулахын нийт үлдэгдэл (өнөөдрийн). */
  stock: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [startInput, setStartInput] = useState(start);
  const [endInput, setEndInput] = useState(end);
  const [exporting, setExporting] = useState(false);

  function pushParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "sales");
    mutate(params);
    router.push(`${pathname}?${params}`);
  }

  const setFilter = (key: "wh" | "cashier" | "cp" | "method" | "item" | "cat") => (value: string) =>
    pushParams((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });

  const { lines, payments } = data;
  const summary = useMemo(() => summarize(lines), [lines]);

  // ── 5.1 Гүйлгээ ──
  const lineRows = useMemo<LineRow[]>(
    () =>
      lines.map((line, index) => ({
        ...line,
        rowId: `${line.saleId}:${index}`,
        itemLabel: line.itemCode ? `${line.itemCode} · ${line.itemName}` : line.itemName,
        rulesLabel: line.discountRules.join(", "),
      })),
    [lines]
  );
  const lineTotals = useMemo<Partial<LineRow>[]>(
    () => [
      {
        rowId: "total",
        documentNo: "НИЙТ",
        quantity: Math.round(lines.reduce((s, l) => s + l.quantity, 0) * 10000) / 10000,
        lineGross: summary.gross,
        discountAmount: summary.discount,
        netAmount: summary.net,
        vatAmount: summary.vat,
        lineTotal: summary.total,
        cogs: summary.cogs,
        margin: summary.margin,
        cogsBasis: summary.cogsBasis,
      },
    ],
    [lines, summary]
  );
  const lineColumns = useMemo<ColDef<LineRow>[]>(
    () => [
      {
        headerName: "Огноо / цаг",
        field: "soldAt",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => (params.value ? fmtSoldAt(String(params.value)) : ""),
      },
      { headerName: "Дугаар", field: "documentNo", width: 130, cellClass: "font-mono" },
      { headerName: "Кассчин", field: "cashierName", width: 130 },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 150, flex: 1 },
      { headerName: "Бараа", field: "itemLabel", minWidth: 180, flex: 1 },
      { headerName: "Тоо", field: "quantity", width: 90, ...qtyCell },
      { headerName: "Үнэ", field: "unitPrice", width: 120, ...moneyCell },
      { headerName: "Хөнгөлөлт", field: "discountAmount", width: 120, ...moneyCell },
      { headerName: "Дүрэм", field: "rulesLabel", width: 130, cellClass: "text-xs" },
      { headerName: "Цэвэр", field: "netAmount", width: 130, ...moneyCell },
      { headerName: "НӨАТ", field: "vatAmount", width: 110, ...moneyCell },
      { headerName: "Нийт", field: "lineTotal", width: 130, ...moneyCell },
      { headerName: "Төлбөр", field: "paymentSummary", minWidth: 160, flex: 1, cellClass: "text-xs" },
      { headerName: "COGS", field: "cogs", width: 140, ...cogsCell<LineRow>() },
      { headerName: "Ахиуц", field: "margin", width: 140, ...cogsCell<LineRow>() },
    ],
    []
  );

  // ── 5.2 Бараагаар ──
  const itemRows = useMemo<ItemRow[]>(() => {
    const returned = new Map<string, number>();
    for (const line of lines)
      if (line.quantity < 0)
        returned.set(line.itemId, (returned.get(line.itemId) ?? 0) - line.quantity);
    const meta = new Map(
      lines.map((line) => [line.itemId, { code: line.itemCode, name: line.itemName, category: line.categoryCode ?? "" }])
    );
    return aggregateBy(lines, (line) => ({ key: line.itemId, label: line.itemName })).map((row) => {
      const info = meta.get(row.key);
      return {
        ...row,
        itemId: row.key,
        code: info?.code ?? "",
        name: info?.name ?? row.label,
        category: info?.category ?? "",
        returnedQty: Math.round((returned.get(row.key) ?? 0) * 10000) / 10000,
        stock: row.key in stock ? stock[row.key] : null,
      };
    });
  }, [lines, stock]);
  const itemTotals = useMemo<Partial<ItemRow>[]>(
    () => [
      {
        itemId: "total",
        code: "НИЙТ",
        quantity: Math.round(itemRows.reduce((s, r) => s + r.quantity, 0) * 10000) / 10000,
        returnedQty: Math.round(itemRows.reduce((s, r) => s + r.returnedQty, 0) * 10000) / 10000,
        gross: summary.gross,
        discount: summary.discount,
        net: summary.net,
        vat: summary.vat,
        cogs: summary.cogs,
        margin: summary.margin,
        marginPercent: summary.marginPercent,
        cogsBasis: summary.cogsBasis,
        stock: null,
      },
    ],
    [itemRows, summary]
  );
  const itemColumns = useMemo<ColDef<ItemRow>[]>(
    () => [
      { headerName: "Код", field: "code", width: 110, cellClass: "font-mono" },
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      { headerName: "Бүлэг", field: "category", width: 110 },
      { headerName: "Тоо", field: "quantity", width: 90, ...qtyCell },
      { headerName: "Буцаасан тоо", field: "returnedQty", width: 120, ...qtyCell },
      { headerName: "Нийт (хөнг. өмнө)", field: "gross", width: 150, ...moneyCell },
      { headerName: "Хөнгөлөлт", field: "discount", width: 120, ...moneyCell },
      { headerName: "Цэвэр орлого", field: "net", width: 140, ...moneyCell },
      { headerName: "НӨАТ", field: "vat", width: 110, ...moneyCell },
      { headerName: "COGS", field: "cogs", width: 140, ...cogsCell<ItemRow>() },
      { headerName: "Ахиуц ₮", field: "margin", width: 140, ...cogsCell<ItemRow>() },
      { headerName: "Ахиуц %", field: "marginPercent", width: 100, ...pctCell },
      { headerName: "Үлдэгдэл", field: "stock", width: 110, ...qtyCell },
    ],
    []
  );

  // ── 5.3 Өдрөөр ──
  const presentKinds = useMemo(
    () => [...new Set(payments.map((payment) => payment.kind))].sort(),
    [payments]
  );
  const dayRows = useMemo<DayRow[]>(() => {
    const byDayKind = new Map<string, Record<string, number>>();
    for (const payment of payments) {
      const record = byDayKind.get(payment.date) ?? {};
      record[payment.kind] = Math.round(((record[payment.kind] ?? 0) + payment.baseAmount) * 100) / 100;
      byDayKind.set(payment.date, record);
    }
    return [...groupSummaries(lines, (line) => line.date)]
      .map(([date, group]) => ({
        ...group.summary,
        date,
        saleIds: uniqueSaleIds(group.lines),
        byKind: byDayKind.get(date) ?? {},
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [lines, payments]);
  const dayTotals = useMemo<Partial<DayRow>[]>(() => {
    const byKind: Record<string, number> = {};
    for (const row of dayRows)
      for (const [kind, amount] of Object.entries(row.byKind))
        byKind[kind] = Math.round(((byKind[kind] ?? 0) + amount) * 100) / 100;
    return [{ ...summary, date: "НИЙТ", saleIds: [], byKind }];
  }, [dayRows, summary]);
  const dayColumns = useMemo<ColDef<DayRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 120, cellClass: "font-mono" },
      { headerName: "Чек", field: "salesCount", width: 80, ...numberCell },
      { headerName: "Дундаж чек", field: "averageTicket", width: 130, ...moneyCell },
      { headerName: "Нийт", field: "total", width: 140, ...moneyCell },
      { headerName: "Хөнгөлөлт", field: "discount", width: 120, ...moneyCell },
      { headerName: "Цэвэр", field: "net", width: 140, ...moneyCell },
      { headerName: "НӨАТ", field: "vat", width: 110, ...moneyCell },
      ...presentKinds.map<ColDef<DayRow>>((kind) => ({
        headerName: KIND_SHORT[kind] ?? kind,
        colId: `kind:${kind}`,
        width: 130,
        ...moneyCell,
        valueGetter: (params) => params.data?.byKind[kind] ?? 0,
      })),
      { headerName: "Буцаалт", field: "returnsTotal", width: 120, ...moneyCell },
      { headerName: "COGS", field: "cogs", width: 140, ...cogsCell<DayRow>() },
      { headerName: "Ахиуц", field: "margin", width: 140, ...cogsCell<DayRow>() },
    ],
    [presentKinds]
  );

  // ── 5.4 Кассчинаар ──
  const cashierRows = useMemo<CashierRow[]>(
    () =>
      [...groupSummaries(lines, (line) => line.cashierName)]
        .map(([cashierName, group]) => ({
          ...group.summary,
          cashierName,
          discountPct:
            group.summary.gross === 0
              ? null
              : Math.round((group.summary.discount / group.summary.gross) * 10000) / 100,
        }))
        .sort((a, b) => b.total - a.total || a.cashierName.localeCompare(b.cashierName)),
    [lines]
  );
  const cashierTotals = useMemo<Partial<CashierRow>[]>(
    () => [
      {
        ...summary,
        cashierName: "НИЙТ",
        discountPct: summary.gross === 0 ? null : Math.round((summary.discount / summary.gross) * 10000) / 100,
      },
    ],
    [summary]
  );
  const cashierColumns = useMemo<ColDef<CashierRow>[]>(
    () => [
      { headerName: "Кассчин", field: "cashierName", minWidth: 180, flex: 1 },
      { headerName: "Чек", field: "salesCount", width: 90, ...numberCell },
      { headerName: "Нийт", field: "total", width: 150, ...moneyCell },
      { headerName: "Хөнгөлөлт Σ", field: "discount", width: 140, ...moneyCell },
      { headerName: "Хөнгөлөлт %", field: "discountPct", width: 120, ...pctCell },
      { headerName: "Буцаалт", field: "returnsTotal", width: 140, ...moneyCell },
    ],
    []
  );

  // ── 5.5 Төлбөрийн хэлбэрээр ──
  const methodRows = useMemo(() => aggregatePayments(payments), [payments]);
  const methodTotals = useMemo<Partial<MethodAggRow>[]>(
    () => [
      {
        methodId: "total",
        methodName: "НИЙТ",
        count: methodRows.reduce((s, r) => s + r.count, 0),
        amount: Math.round(methodRows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      },
    ],
    [methodRows]
  );
  const methodColumns = useMemo<ColDef<MethodAggRow>[]>(
    () => [
      { headerName: "Хэлбэр", field: "methodName", minWidth: 180, flex: 1 },
      {
        headerName: "Төрөл",
        field: "kind",
        width: 200,
        valueFormatter: (params) =>
          params.value ? (PAYMENT_KIND_LABELS[params.value as PaymentKind] ?? String(params.value)) : "",
      },
      { headerName: "Гүйлгээний тоо", field: "count", width: 130, ...numberCell },
      { headerName: "Дүн", field: "amount", width: 160, ...moneyCell },
    ],
    []
  );

  // ── 5.6 Харилцагчаар ──
  const customerRows = useMemo<CustomerRow[]>(() => {
    const meta = new Map(
      lines.map((line) => [line.counterpartyId, { name: line.counterpartyName, group: line.customerGroup ?? "" }])
    );
    return [...groupSummaries(lines, (line) => line.counterpartyId)]
      .map(([counterpartyId, group]) => ({
        ...group.summary,
        counterpartyId,
        counterpartyName: meta.get(counterpartyId)?.name ?? "—",
        customerGroup: meta.get(counterpartyId)?.group ?? "",
        saleIds: uniqueSaleIds(group.lines),
      }))
      .sort((a, b) => b.total - a.total || a.counterpartyName.localeCompare(b.counterpartyName));
  }, [lines]);
  const customerTotals = useMemo<Partial<CustomerRow>[]>(
    () => [{ ...summary, counterpartyId: "total", counterpartyName: "НИЙТ", customerGroup: "", saleIds: [] }],
    [summary]
  );
  const customerColumns = useMemo<ColDef<CustomerRow>[]>(
    () => [
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 180, flex: 1 },
      { headerName: "Бүлэг", field: "customerGroup", width: 120 },
      { headerName: "Чек", field: "salesCount", width: 90, ...numberCell },
      { headerName: "Нийт", field: "total", width: 150, ...moneyCell },
      { headerName: "Хөнгөлөлт", field: "discount", width: 140, ...moneyCell },
      { headerName: "Буцаалт", field: "returnsTotal", width: 140, ...moneyCell },
    ],
    []
  );

  // ── Хөнгөлөлтийн үр ашиг (дүрмээр) ──
  // Нэг мөрд хэд хэдэн дүрэм хэрэглэгдсэн бол мөр дүрэм БҮРД тоологдоно —
  // "энэ дүрэм хэрэглэгдсэн мөрүүд ашигтай юу" гэсэн асуултад хариулна.
  const ruleRows = useMemo<RuleRow[]>(() => {
    const byRule = new Map<string, SalesLineRow[]>();
    for (const line of lines)
      for (const rule of line.discountRules) byRule.set(rule, [...(byRule.get(rule) ?? []), line]);
    return [...byRule]
      .map(([rule, group]) => {
        const groupSummary = summarize(group);
        return {
          rule,
          lineCount: group.length,
          discount: groupSummary.discount,
          net: groupSummary.net,
          margin: groupSummary.margin,
          cogsBasis: groupSummary.cogsBasis,
        };
      })
      .sort((a, b) => b.discount - a.discount || a.rule.localeCompare(b.rule));
  }, [lines]);
  const ruleColumns = useMemo<ColDef<RuleRow>[]>(
    () => [
      { headerName: "Дүрэм", field: "rule", minWidth: 180, flex: 1, cellClass: "font-mono" },
      { headerName: "Хэрэглэсэн мөр", field: "lineCount", width: 130, ...numberCell },
      { headerName: "Σ хөнгөлөлт", field: "discount", width: 150, ...moneyCell },
      { headerName: "Цэвэр орлого", field: "net", width: 150, ...moneyCell },
      { headerName: "Ахиуц", field: "margin", width: 150, ...cogsCell<RuleRow>() },
    ],
    []
  );

  // ── Драйв-даун: мөр → POS борлуулалтын панель (олон бол navIds-аар гүйлгэнэ) ──
  function openSales(saleIds: string[]) {
    if (saleIds.length === 0) return;
    openPosSalePanel(saleIds[0], undefined, saleIds.length > 1 ? saleIds : undefined);
  }

  async function exportActive() {
    setExporting(true);
    try {
      switch (view) {
        case "lines":
          await exportRows({ slug: "pos-sales-lines", sheetName: "Гүйлгээ", columns: lineColumns, rows: lineRows });
          break;
        case "items":
          await exportRows({ slug: "pos-sales-items", sheetName: "Бараагаар", columns: itemColumns, rows: itemRows });
          break;
        case "days":
          await exportRows({
            slug: "pos-sales-days",
            sheetName: "Өдрөөр",
            // Хэлбэрийн багана valueGetter-тэй тул export-д colId-г field болгоно.
            columns: dayColumns.map((column) =>
              column.field ? column : { ...column, field: column.colId as keyof DayRow & string }
            ),
            rows: dayRows.map((row) => {
              const flat: Record<string, unknown> = { ...row };
              for (const kind of presentKinds) flat[`kind:${kind}`] = row.byKind[kind] ?? 0;
              return flat as unknown as DayRow;
            }),
          });
          break;
        case "cashiers":
          await exportRows({ slug: "pos-sales-cashiers", sheetName: "Кассчинаар", columns: cashierColumns, rows: cashierRows });
          break;
        case "methods":
          await exportRows({ slug: "pos-sales-methods", sheetName: "Төлбөрийн хэлбэр", columns: methodColumns, rows: methodRows });
          break;
        case "customers":
          await exportRows({ slug: "pos-sales-customers", sheetName: "Харилцагчаар", columns: customerColumns, rows: customerRows });
          break;
        case "rules":
          await exportRows({ slug: "pos-sales-rules", sheetName: "Хөнгөлөлт", columns: ruleColumns, rows: ruleRows });
          break;
      }
    } finally {
      setExporting(false);
    }
  }

  const basisTone =
    summary.cogsBasis === "none"
      ? "var(--ea-text-3)"
      : summary.cogsBasis === "final"
        ? "var(--ea-success-fg)"
        : "var(--ea-warning-fg)";

  const metrics: { label: string; value: string; tone?: string }[] = [
    { label: "Борлуулалт (тоо)", value: String(summary.salesCount) },
    { label: "Буцаалт", value: `${summary.returnsCount} · ${fmtMnt(summary.returnsTotal)}` },
    { label: "Нийт (хөнг. өмнө)", value: fmtMnt(summary.gross) },
    { label: "Хөнгөлөлт", value: fmtMnt(summary.discount) },
    { label: "Цэвэр орлого", value: fmtMnt(summary.net) },
    { label: "НӨАТ", value: fmtMnt(summary.vat) },
    { label: "Төлөх Σ", value: fmtMnt(summary.total) },
    { label: "Дундаж чек", value: fmtMnt(summary.averageTicket) },
    {
      label: "COGS",
      value: summary.cogs === null ? "—" : fmtMnt(summary.cogs),
      tone: summary.cogsBasis === "final" ? undefined : basisTone,
    },
    {
      label: "Ахиуц ₮",
      value: summary.margin === null ? "—" : fmtMnt(summary.margin),
      tone: summary.cogsBasis === "final" ? undefined : basisTone,
    },
    {
      label: "Ахиуц %",
      value: fmtPct(summary.marginPercent),
      tone: summary.cogsBasis === "final" ? undefined : basisTone,
    },
  ];

  const gridProps = {
    height: "flex" as const,
    wrapperClassName: "rounded-md border border-[var(--ea-border)] overflow-hidden",
    suppressCellFocus: true,
  };
  const isTotalRow = (event: RowDoubleClickedEvent) => !!event.node.rowPinned;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Огноо + шүүлтүүр */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="h-8 w-40"
              value={startInput}
              onChange={(event) => setStartInput(event.target.value)}
            />
            <span className="text-xs text-[var(--ea-text-4)]">—</span>
            <Input
              type="date"
              className="h-8 w-40"
              value={endInput}
              onChange={(event) => setEndInput(event.target.value)}
            />
            <Button
              size="sm"
              onClick={() =>
                pushParams((params) => {
                  if (startInput) params.set("start", startInput);
                  else params.delete("start");
                  if (endInput) params.set("end", endInput);
                  else params.delete("end");
                })
              }
            >
              Шинэчлэх
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={exporting || lines.length === 0} onClick={exportActive}>
              Excel татах
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <FilterField label="Агуулах">
            <SearchableSelect
              value={filters.warehouseId ?? ANY}
              onChange={setFilter("wh")}
              options={[{ value: ANY, label: "Бүх агуулах" }, ...options.warehouses]}
              hideValue
            />
          </FilterField>
          <FilterField label="Кассчин">
            <SearchableSelect
              value={filters.cashierUserId ?? ANY}
              onChange={setFilter("cashier")}
              options={[{ value: ANY, label: "Бүх кассчин" }, ...options.cashiers]}
              hideValue
            />
          </FilterField>
          <FilterField label="Харилцагч">
            <SearchableSelect
              value={filters.counterpartyId ?? ANY}
              onChange={setFilter("cp")}
              options={[{ value: ANY, label: "Бүх харилцагч" }, ...options.customers]}
              hideValue
            />
          </FilterField>
          <FilterField label="Төлбөрийн хэлбэр">
            <SearchableSelect
              value={filters.methodId ?? ANY}
              onChange={setFilter("method")}
              options={[{ value: ANY, label: "Бүх хэлбэр" }, ...options.methods]}
              hideValue
            />
          </FilterField>
          <FilterField label="Бараа">
            <SearchableSelect
              value={filters.itemId ?? ANY}
              onChange={setFilter("item")}
              options={[{ value: ANY, label: "Бүх бараа" }, ...options.items]}
              hideValue
            />
          </FilterField>
          <FilterField label="Барааны бүлэг">
            <SearchableSelect
              value={filters.categoryCode ?? ANY}
              onChange={setFilter("cat")}
              options={[{ value: ANY, label: "Бүх бүлэг" }, ...options.categories]}
              hideValue
            />
          </FilterField>
        </div>
      </div>

      {/* Нэгтгэлийн зурвас */}
      <section className="rounded-md border border-[var(--ea-border)]">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="min-w-0 border-b border-r border-[var(--ea-border)] px-3 py-2 last:border-r-0"
            >
              <div className="truncate text-[11px] text-[var(--ea-text-3)]">{metric.label}</div>
              <div
                className="mt-0.5 truncate font-mono text-sm font-semibold"
                style={{ color: metric.tone ?? "var(--ea-text-1)" }}
              >
                {metric.value}
              </div>
            </div>
          ))}
          <div className="col-span-2 flex min-w-0 items-center gap-2 border-b border-[var(--ea-border)] px-3 py-2 sm:col-span-4 xl:col-span-1">
            <span className="text-[11px] text-[var(--ea-text-3)]">COGS суурь:</span>
            <span
              className="truncate rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                color: basisTone,
                borderColor: "color-mix(in srgb, currentColor 35%, transparent)",
              }}
            >
              {COGS_BASIS_LABELS[summary.cogsBasis]}
            </span>
          </div>
        </div>
        <p className="px-3 py-1.5 text-[11px] text-[var(--ea-text-4)]">
          {start} — {end} · буцаалт сөрөг дүнгээр орсон; COGS сар хаагдаагүй бол урьдчилсан (сар хаалтад
          залруулагдана), GL-ээс тооцохгүй. Мөр дээр давхар дарж борлуулалтын панель нээнэ.
        </p>
      </section>

      <PageTabs
        size="sm"
        ariaLabel="Борлуулалтын тайлангийн дэд таб"
        value={view}
        tabs={VIEW_TABS}
        onChange={(next) => pushParams((params) => params.set("view", next))}
      />

      {lines.length === 0 ? (
        <EmptyState
          icon="report"
          title="Мужид борлуулалт алга"
          description="Огноо эсвэл шүүлтүүрээ өөрчилж үзнэ үү."
        />
      ) : view === "lines" ? (
        <DataGridDynamic<LineRow>
          {...gridProps}
          rowData={lineRows}
          columnDefs={lineColumns}
          getRowId={(params) => params.data.rowId}
          pinnedBottomRowData={lineTotals as LineRow[]}
          onRowDoubleClicked={(event) => {
            if (!isTotalRow(event) && event.data?.saleId) openSales([event.data.saleId]);
          }}
        />
      ) : view === "items" ? (
        <DataGridDynamic<ItemRow>
          {...gridProps}
          rowData={itemRows}
          columnDefs={itemColumns}
          getRowId={(params) => params.data.itemId}
          pinnedBottomRowData={itemTotals as ItemRow[]}
        />
      ) : view === "days" ? (
        <DataGridDynamic<DayRow>
          {...gridProps}
          rowData={dayRows}
          columnDefs={dayColumns}
          getRowId={(params) => params.data.date}
          pinnedBottomRowData={dayTotals as DayRow[]}
          onRowDoubleClicked={(event) => {
            if (!isTotalRow(event) && event.data) openSales(event.data.saleIds);
          }}
        />
      ) : view === "cashiers" ? (
        <DataGridDynamic<CashierRow>
          {...gridProps}
          rowData={cashierRows}
          columnDefs={cashierColumns}
          getRowId={(params) => params.data.cashierName}
          pinnedBottomRowData={cashierTotals as CashierRow[]}
        />
      ) : view === "methods" ? (
        methodRows.length === 0 ? (
          <EmptyState icon="cash" title="Төлбөр алга" description="Сонгосон мужид төлбөрийн бичилт байхгүй." />
        ) : (
          <DataGridDynamic<MethodAggRow>
            {...gridProps}
            rowData={methodRows}
            columnDefs={methodColumns}
            getRowId={(params) => params.data.methodId}
            pinnedBottomRowData={methodTotals as MethodAggRow[]}
          />
        )
      ) : view === "customers" ? (
        <DataGridDynamic<CustomerRow>
          {...gridProps}
          rowData={customerRows}
          columnDefs={customerColumns}
          getRowId={(params) => params.data.counterpartyId}
          pinnedBottomRowData={customerTotals as CustomerRow[]}
          onRowDoubleClicked={(event) => {
            if (!isTotalRow(event) && event.data) openSales(event.data.saleIds);
          }}
        />
      ) : ruleRows.length === 0 ? (
        <EmptyState
          icon="filter"
          title="Хөнгөлөлтийн дүрэм хэрэглэгдээгүй"
          description="Сонгосон мужид дүрмээр хөнгөлсөн мөр байхгүй."
        />
      ) : (
        <DataGridDynamic<RuleRow>
          {...gridProps}
          rowData={ruleRows}
          columnDefs={ruleColumns}
          getRowId={(params) => params.data.rule}
        />
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] text-[var(--ea-text-3)]">{label}</span>
      {children}
    </div>
  );
}
