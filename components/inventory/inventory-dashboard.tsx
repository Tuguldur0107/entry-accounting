"use client";

import { useMemo } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { NegativeStockRow } from "@/lib/inventory/negative-stock";
import type { QtyBalanceRow } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** POS хэсэг (docs/pos/00-proposal.md §4.6) — POS модуль идэвхгүй бол өгөгдөхгүй. */
export interface InventoryPosMetrics {
  /** УБ өдрөөр. */
  today: string;
  todayTotal: number;
  todayCount: number;
  todayAverageTicket: number;
  openShifts: number;
  /** Энэ сарын урьдчилсан COGS Σ (батлагдсан, сар хаалтад залруулагдана). */
  provisionalCogs: number;
  /** Урьдчилсан өртөггүй (явцын дундаж байгаагүй) борлуулалтын мөр — энэ сар. */
  pendingCostLines: number;
}

/** eBarimt-ийн дараалал (docs/pos/03-ebarimt-integration-plan.md §4.5) —
 *  асаалттай үед л өгөгдөнө. */
export interface InventoryEbarimtMetrics {
  pending: number;
  failed: number;
}

interface Props {
  balances: QtyBalanceRow[];
  itemCount: number;
  warehouseCount: number;
  draftCount: number;
  unvaluedCount: number;
  pos?: InventoryPosMetrics;
  ebarimt?: InventoryEbarimtMetrics;
  /** Хасах үлдэгдэлтэй бараа × агуулах (D9) — хоосон бол ногоон мөр. */
  negativeStock?: NegativeStockRow[];
}

type Metric = {
  label: string;
  value: string;
  icon: IconName;
  color: string;
  href: string;
  hint?: string;
};

function MetricTiles({ metrics, columns }: { metrics: Metric[]; columns: "4" | "6" }) {
  return (
    <section
      className={`grid grid-cols-2 border-y border-[var(--ea-border)] ${
        columns === "6" ? "lg:grid-cols-6" : "lg:grid-cols-4"
      }`}
    >
      {metrics.map((metric) => (
        <Link
          key={metric.label}
          href={metric.href}
          title={metric.hint}
          className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
          style={{ textDecoration: "none" }}
        >
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)]"
            style={{ color: metric.color }}
          >
            <Icon name={metric.icon} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[11px] text-[var(--ea-text-3)]">
              {metric.label}
            </div>
            <div className="mt-0.5 truncate font-mono text-base font-semibold text-[var(--ea-text-1)]">
              {metric.value}
            </div>
            {metric.hint ? (
              <div className="truncate text-[10px] text-[var(--ea-text-4)]">
                {metric.hint}
              </div>
            ) : null}
          </div>
        </Link>
      ))}
    </section>
  );
}

export function InventoryDashboard({
  balances,
  itemCount,
  warehouseCount,
  draftCount,
  unvaluedCount,
  pos,
  ebarimt,
  negativeStock = [],
}: Props) {
  const columns = useMemo<ColDef<QtyBalanceRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      { headerName: "Агуулах", field: "warehouseName", minWidth: 160, flex: 1 },
      {
        headerName: "Үлдэгдэл",
        field: "quantity",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtQty(Number(params.value ?? 0)),
      },
      { headerName: "Хэмжих нэгж", field: "unit", width: 110 },
    ],
    []
  );

  const negativeColumns = useMemo<ColDef<NegativeStockRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      { headerName: "Агуулах", field: "warehouseName", minWidth: 160, flex: 1 },
      {
        headerName: "Үлдэгдэл",
        field: "quantity",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        cellStyle: { color: "var(--ea-danger-fg)" },
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          `${fmtQty(Number(params.value ?? 0))} ${params.data?.unit ?? ""}`.trim(),
      },
    ],
    []
  );

  const metrics: Metric[] = [
    {
      label: "Идэвхтэй бараа",
      value: String(itemCount),
      icon: "inventory",
      color: "var(--ea-primary)",
      href: "/inventory/items",
    },
    {
      label: "Агуулах",
      value: String(warehouseCount),
      icon: "warehouse",
      color: "var(--ea-primary)",
      href: "/inventory/items",
    },
    {
      label: "Ноорог хөдөлгөөн",
      value: String(draftCount),
      icon: "pending",
      color: draftCount > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/inventory/movements?status=draft",
    },
    {
      label: "Үнэлгээ хүлээгдэж буй",
      value: String(unvaluedCount),
      icon: "costing",
      color: unvaluedCount > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/costing",
    },
  ];

  const posMetrics: Metric[] = pos
    ? [
        {
          label: "Өнөөдрийн борлуулалт ₮",
          value: fmtMnt(pos.todayTotal),
          icon: "cash",
          color: "var(--ea-primary)",
          href: `/inventory/reports?tab=sales&start=${pos.today}&end=${pos.today}`,
          hint: pos.today,
        },
        {
          label: "Чекийн тоо",
          value: String(pos.todayCount),
          icon: "document",
          color: "var(--ea-primary)",
          href: `/inventory/reports?tab=sales&start=${pos.today}&end=${pos.today}&view=days`,
        },
        {
          label: "Дундаж чек",
          value: fmtMnt(pos.todayAverageTicket),
          icon: "reconciliation",
          color: "var(--ea-primary)",
          href: `/inventory/reports?tab=sales&start=${pos.today}&end=${pos.today}&view=cashiers`,
        },
        {
          label: "Нээлттэй ээлж",
          value: String(pos.openShifts),
          icon: "pending",
          color: pos.openShifts > 0 ? "var(--ea-warning)" : "var(--ea-success)",
          href: "/inventory/shifts",
        },
        {
          label: "Урьдчилсан COGS (энэ сар)",
          value: fmtMnt(pos.provisionalCogs),
          icon: "costing",
          color: pos.provisionalCogs !== 0 ? "var(--ea-warning)" : "var(--ea-success)",
          href: "/costing/reports",
          hint: "сар хаалтад залруулагдана",
        },
        {
          label: "Өртөг хүлээж буй мөр",
          value: String(pos.pendingCostLines),
          icon: "costing",
          color: pos.pendingCostLines > 0 ? "var(--ea-warning)" : "var(--ea-success)",
          href: "/costing",
          hint: "явцын дундаж байгаагүй — сар хаалтад үнэлэгдэнэ",
        },
      ]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Бараа материалын хяналт
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Тоо хэмжээний бүртгэл — үнэ, өртөг Өртгийн модульд
        </p>
      </div>

      <MetricTiles metrics={metrics} columns="4" />

      {pos ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Борлуулалт (POS)
          </h2>
          <MetricTiles metrics={posMetrics} columns="6" />
        </section>
      ) : null}

      {ebarimt ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">eBarimt</h2>
            <p className="mt-0.5 text-xs text-[var(--ea-text-3)]">
              Хүлээгдэж байгаа{" "}
              <span
                className="font-mono font-semibold"
                style={{ color: ebarimt.pending > 0 ? "var(--ea-warning-fg)" : "var(--ea-text-1)" }}
              >
                {ebarimt.pending}
              </span>{" "}
              · Алдаатай{" "}
              <span
                className="font-mono font-semibold"
                style={{ color: ebarimt.failed > 0 ? "var(--ea-danger-fg)" : "var(--ea-text-1)" }}
              >
                {ebarimt.failed}
              </span>
            </p>
          </div>
          <Link
            href="/inventory/sales"
            className="text-xs font-medium underline"
            style={{ color: ebarimt.failed > 0 ? "var(--ea-danger-fg)" : "var(--ea-primary)" }}
          >
            Борлуулалт
          </Link>
        </section>
      ) : null}

      {negativeStock.length > 0 ? (
        <section
          className="flex flex-col gap-2 rounded-md border p-3"
          style={{
            borderColor: "color-mix(in srgb, var(--ea-danger) 45%, transparent)",
            background: "color-mix(in srgb, var(--ea-danger) 6%, var(--ea-surface))",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--ea-danger-fg)" }}>
                Хасах үлдэгдэлтэй бараа — {negativeStock.length}
              </h2>
              <p className="text-xs text-[var(--ea-text-3)]">
                POS борлуулалт хасах үлдэгдлээр зогсдоггүй; орлого эсвэл тооллого
                бүртгэтэл сарын өртөг тооцоо энэ бараа×агуулахад зогсоно.
              </p>
            </div>
            <Link
              href="/inventory/movements"
              className="text-xs font-medium underline"
              style={{ color: "var(--ea-primary)" }}
            >
              Орлого / тооллого бүртгэх
            </Link>
          </div>
          <DataGridDynamic<NegativeStockRow>
            rowData={negativeStock}
            columnDefs={negativeColumns}
            getRowId={(params) => `${params.data.itemId}|${params.data.warehouseId}`}
            height={Math.min(320, 48 + negativeStock.length * 36)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        </section>
      ) : (
        <p className="text-xs" style={{ color: "var(--ea-success-fg)" }}>
          ✓ Хасах үлдэгдэл байхгүй
        </p>
      )}

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Үлдэгдэл (баталсан хөдөлгөөнөөр)
        </h2>
        {balances.length === 0 ? (
          <div className="flex min-h-40 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Үлдэгдэл байхгүй — хөдөлгөөн бүртгэж эхэлнэ
          </div>
        ) : (
          <DataGridDynamic<QtyBalanceRow>
            rowData={balances}
            columnDefs={columns}
            getRowId={(params) => `${params.data.itemId}|${params.data.warehouseName}`}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>
    </div>
  );
}
