"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";
import { Boxes, Calculator, FileClock, Warehouse as WarehouseIcon } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { QtyBalanceRow } from "@/lib/inventory/types";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  balances: QtyBalanceRow[];
  itemCount: number;
  warehouseCount: number;
  draftCount: number;
  unvaluedCount: number;
}

export function InventoryDashboard({
  balances,
  itemCount,
  warehouseCount,
  draftCount,
  unvaluedCount,
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

  const metrics = [
    {
      label: "Идэвхтэй бараа",
      value: String(itemCount),
      icon: Boxes,
      color: "var(--ea-primary)",
      href: "/inventory/items",
    },
    {
      label: "Агуулах",
      value: String(warehouseCount),
      icon: WarehouseIcon,
      color: "var(--ea-primary)",
      href: "/inventory/items",
    },
    {
      label: "Ноорог хөдөлгөөн",
      value: String(draftCount),
      icon: FileClock,
      color: draftCount > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/inventory/movements?status=draft",
    },
    {
      label: "Үнэлгээ хүлээгдэж буй",
      value: String(unvaluedCount),
      icon: Calculator,
      color: unvaluedCount > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/costing",
    },
  ];

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

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <Link
              key={metric.label}
              href={metric.href}
              className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 transition-colors last:border-r-0 hover:bg-[var(--ea-bg-2)] lg:border-b-0"
              style={{ textDecoration: "none" }}
            >
              <div
                className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)]"
                style={{ color: metric.color }}
              >
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] text-[var(--ea-text-3)]">
                  {metric.label}
                </div>
                <div className="mt-0.5 truncate font-mono text-base font-semibold text-[var(--ea-text-1)]">
                  {metric.value}
                </div>
              </div>
            </Link>
          );
        })}
      </section>

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
