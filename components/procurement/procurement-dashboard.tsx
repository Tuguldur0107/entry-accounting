"use client";

// Хангамжийн хяналтын самбар — docs/procurement §3.7, гэрээ §11.
//
// Гол хэмжүүр нь ХОЁР ТҮР ДАНСНЫ үлдэгдэл: бараа материалын түр данс (хүлээн
// авсан ч нэхэмжлэгдээгүй) ба өглөгийн түр данс (нэхэмжлэгдсэн ч хаагдаагүй).
// Захиалга хаагдахад хоёулаа PO объектоороо 0 болно (FR-PROC-004) — тиймээс
// 0-ээс зөрсөн үлдэгдэл нь хийгдээгүй ажлын хэмжүүр.

import { useMemo } from "react";
import Link from "next/link";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PurchaseOrderView } from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import { openPurchaseOrderPanel } from "@/lib/store/panel-store";
import {
  PO_STATUS_LABELS,
  PO_STATUS_TONES,
} from "@/components/procurement/purchase-orders-view";

interface Props {
  draftOrders: number;
  openOrders: number;
  ordersReadyToClose: number;
  ordersBlocked: number;
  draftReceipts: number;
  unallocatedLines: number;
  unallocatedAmountMnt: number;
  /** Σ(Дт − Кт) бараа материалын түр дансанд (хүлээгдэх нь ≤ 0 = Кт). */
  clearingInventory: number;
  /** Σ(Дт − Кт) өглөгийн түр дансанд (хүлээгдэх нь ≥ 0 = Дт). */
  clearingPayable: number;
  recentOrders: PurchaseOrderView[];
}

export function ProcurementDashboard({
  draftOrders,
  openOrders,
  ordersReadyToClose,
  ordersBlocked,
  draftReceipts,
  unallocatedLines,
  unallocatedAmountMnt,
  clearingInventory,
  clearingPayable,
  recentOrders,
}: Props) {
  const metrics: {
    label: string;
    value: string;
    icon: IconName;
    color: string;
    href: string;
    hint?: string;
  }[] = [
    {
      label: "Ноорог захиалга",
      value: String(draftOrders),
      icon: "pending",
      color: draftOrders > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/procurement/orders?status=draft",
      hint: "Батлагдтал хүлээн авалт хийгдэхгүй",
    },
    {
      label: "Нээлттэй захиалга",
      value: String(openOrders),
      icon: "purchaseOrder",
      color: "var(--ea-primary)",
      href: "/procurement/orders?status=open",
      hint: "Хүлээн авалттай нээлттэй захиалга сар хаалтыг хориглоно",
    },
    {
      label: "Хаахад бэлэн",
      value: String(ordersReadyToClose),
      icon: "approve",
      color:
        ordersReadyToClose > 0 ? "var(--ea-success)" : "var(--ea-text-4)",
      href: "/procurement/orders?status=open",
      hint: "Тоо, дүн, хуваарилалт бүгд таарсан — хаах боломжтой",
    },
    {
      label: "Хаалт хоригтой",
      value: String(ordersBlocked),
      icon: "warning",
      color: ordersBlocked > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/procurement/orders?status=open",
      hint: "Зөрүү АВТОМАТААР нөхөгдөхгүй — захиалга тус бүрд шалтгаан харагдана",
    },
    {
      label: "Ноорог хүлээн авалт",
      value: String(draftReceipts),
      icon: "packageReceipt",
      color: draftReceipts > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/procurement/receipts?status=draft",
      hint: "Батлагдтал орлого, өртөг бүртгэгдэхгүй",
    },
    {
      label: "Хуваарилагдаагүй зардал",
      value: String(unallocatedLines),
      icon: "costing",
      color: unallocatedLines > 0 ? "var(--ea-warning)" : "var(--ea-success)",
      href: "/procurement/costs",
      hint:
        unallocatedLines > 0
          ? `Үлдэгдэл ${fmtMnt(unallocatedAmountMnt)}`
          : "Бүх нэмэлт зардал өртөгт шингэсэн",
    },
    {
      label: "Бараа мат. түр данс",
      value: fmtMnt(clearingInventory),
      icon: "inventory",
      color:
        Math.abs(clearingInventory) > 0.005
          ? "var(--ea-primary)"
          : "var(--ea-success)",
      href: "/procurement/orders?status=open",
      hint: "Хүлээн авсан ч нэхэмжлэгдээгүй (Кт үлдэгдэл)",
    },
    {
      label: "Өглөгийн түр данс",
      value: fmtMnt(clearingPayable),
      icon: "document",
      color:
        Math.abs(clearingPayable) > 0.005
          ? "var(--ea-primary)"
          : "var(--ea-success)",
      href: "/procurement/orders?status=open",
      hint: "Нэхэмжлэгдсэн ч захиалга хаагдаагүй (Дт үлдэгдэл)",
    },
  ];

  const columnDefs = useMemo<ColDef<PurchaseOrderView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Захиалгын №",
        field: "documentNo",
        minWidth: 165,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Нийлүүлэгч",
        field: "counterpartyName",
        minWidth: 170,
        flex: 1,
      },
      {
        headerName: "Дүн",
        field: "totalAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => {
          const order = params.data;
          if (!order) return "";
          if (order.currency === "MNT") return fmtMnt(order.totalAmount);
          return `${order.totalAmount.toLocaleString("en-US", {
            maximumFractionDigits: 2,
          })} ${order.currency}`;
        },
      },
      {
        headerName: "Хүлээн авсан",
        field: "receivedPct",
        width: 124,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          `${Number(params.value ?? 0).toLocaleString("en-US", {
            maximumFractionDigits: 1,
          })}%`,
      },
      {
        headerName: "Нэхэмжилсэн",
        field: "invoicedPct",
        width: 124,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          `${Number(params.value ?? 0).toLocaleString("en-US", {
            maximumFractionDigits: 1,
          })}%`,
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 124,
        valueGetter: (params) =>
          params.data ? PO_STATUS_LABELS[params.data.status] : "",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) => {
          const order = params.data;
          if (!order) return null;
          return (
            <span className="flex h-full items-center">
              <StatusBadge tone={PO_STATUS_TONES[order.status]} size="sm">
                {PO_STATUS_LABELS[order.status]}
              </StatusBadge>
            </span>
          );
        },
      },
    ],
    []
  );

  const navIds = useMemo(
    () => recentOrders.map((order) => order.id),
    [recentOrders]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хангамжийн хяналт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Захиалга (PO) нэг объектоор: хүлээн авалт → нэхэмжлэх → нэмэлт
            зардлын хуваарилалт → хаалт. Хоёр түр данс захиалгаараа 0 болж
            хаалт баталгаажна.
          </p>
        </div>
        <Button onClick={() => openPurchaseOrderPanel()}>
          <Icon name="add" />
          Захиалга үүсгэх
        </Button>
      </div>

      <section className="grid grid-cols-2 border-l border-t border-[var(--ea-border)] lg:grid-cols-4">
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            href={metric.href}
            title={metric.hint}
            className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 transition-colors hover:bg-[var(--ea-bg-2)]"
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
              {metric.hint && (
                <div className="mt-0.5 truncate text-[10px] text-[var(--ea-text-4)]">
                  {metric.hint}
                </div>
              )}
            </div>
          </Link>
        ))}
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
            Сүүлийн захиалгууд
          </h2>
          <Link
            href="/procurement/orders"
            className="text-[11px] text-[var(--ea-primary)]"
          >
            Бүх захиалга
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <EmptyState
            icon="purchaseOrder"
            title="Худалдан авалтын захиалгаа бүртгэж эхлээрэй"
            description="Импортын болон томоохон худалдан авалтыг захиалгаар бүртгэвэл хүлээн авалт, нэхэмжлэх, гааль/тээврийн зардал нэг объектоор тулгагдана."
            actions={[
              {
                label: "Захиалга үүсгэх",
                onClick: () => openPurchaseOrderPanel(),
                icon: "add",
                primary: true,
              },
              {
                label: "Нийлүүлэгч нэмэх",
                href: "/payables/counterparties",
                icon: "company",
              },
              {
                label: "Түр дансны тохиргоо",
                href: "/costing/settings",
                icon: "settings",
              },
            ]}
          />
        ) : (
          <DataGridDynamic<PurchaseOrderView>
            rowData={recentOrders}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height={Math.min(420, 86 + recentOrders.length * 38)}
            wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onCellDoubleClicked={(event) => {
              const colId = event.column.getColId();
              if (colId.startsWith("ag-Grid")) return;
              const order = event.data;
              if (order)
                openPurchaseOrderPanel({
                  purchaseOrderId: order.id,
                  title: `${order.documentNo} · ${order.counterpartyName}`,
                  navIds,
                });
            }}
          />
        )}
      </section>
    </div>
  );
}
