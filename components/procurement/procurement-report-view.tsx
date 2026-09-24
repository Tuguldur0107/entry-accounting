"use client";

// Хангамжийн тайлан — захиалгын гүйцэтгэл (PO бүрээр) + нийлүүлэгчийн
// нэгтгэл (нийлүүлэгч × валютаар). Бүх элемент ui-kit-ээс: DataGridDynamic,
// PageTabs, StatusBadge, EmptyState — шинэ component бичихгүй.
// Мөр дээр ДАВХАР даралт → PO панель (жагсаалтын grid-ийн стандарт).

import { useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  ReportEmpty,
  ReportHeader,
  ReportPage,
  ReportToolbar,
  reportRangeLabel,
} from "@/components/reports/report-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageTabs } from "@/components/ui/tabs";
import {
  PO_STATUS_LABELS,
  PO_STATUS_TONES,
} from "@/lib/procurement/labels";
import type {
  ProcurementReportRow,
  ProcurementSupplierRow,
} from "@/lib/procurement/load-data";
import { fmtMnt } from "@/lib/reports/balances";
import { openPurchaseOrderPanel } from "@/lib/store/panel-store";

type Tab = "orders" | "suppliers";

const TABS: { value: Tab; label: string }[] = [
  { value: "orders", label: "Захиалгаар" },
  { value: "suppliers", label: "Нийлүүлэгчээр" },
];

const moneyCell = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) => fmtMnt(Number(params.value ?? 0)),
};

const pctCell = {
  cellClass: "ag-right-aligned-cell font-mono text-xs",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) => `${Number(params.value ?? 0)}%`,
};

const ORDER_COLUMNS: ColDef<ProcurementReportRow>[] = [
  { headerName: "Захиалга №", field: "documentNo", width: 150, cellClass: "font-mono" },
  { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
  { headerName: "Нийлүүлэгч", field: "counterpartyName", flex: 1, minWidth: 160 },
  { headerName: "Валют", field: "currency", width: 80 },
  { headerName: "Захиалсан", field: "totalAmount", width: 140, ...moneyCell },
  { headerName: "Хүлээн авсан", field: "receivedAmount", width: 140, ...moneyCell },
  { headerName: "Хүлээн авсан %", field: "receivedPct", width: 130, ...pctCell },
  { headerName: "Нэхэмжилсэн", field: "invoicedAmount", width: 140, ...moneyCell },
  { headerName: "Нэхэмжилсэн %", field: "invoicedPct", width: 130, ...pctCell },
  {
    headerName: "Хуваарилаагүй зардал ₮",
    field: "unallocatedMnt",
    width: 170,
    ...moneyCell,
  },
  {
    headerName: "Төлөв",
    field: "status",
    width: 120,
    cellRenderer: (params: ICellRendererParams<ProcurementReportRow>) => {
      const status = params.data?.status;
      if (!status) return null;
      return (
        <StatusBadge tone={PO_STATUS_TONES[status] ?? "muted"}>
          {PO_STATUS_LABELS[status] ?? status}
        </StatusBadge>
      );
    },
  },
];

const SUPPLIER_COLUMNS: ColDef<ProcurementSupplierRow>[] = [
  { headerName: "Нийлүүлэгч", field: "counterpartyName", flex: 1, minWidth: 180 },
  { headerName: "Валют", field: "currency", width: 80 },
  {
    headerName: "Захиалга",
    field: "orderCount",
    width: 100,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
  },
  {
    headerName: "Нээлттэй",
    field: "openCount",
    width: 100,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
  },
  { headerName: "Захиалсан", field: "totalAmount", width: 150, ...moneyCell },
  { headerName: "Хүлээн авсан", field: "receivedAmount", width: 150, ...moneyCell },
  { headerName: "Нэхэмжилсэн", field: "invoicedAmount", width: 150, ...moneyCell },
];

export function ProcurementReportView({
  orders,
  suppliers,
  from,
  to,
}: {
  orders: ProcurementReportRow[];
  suppliers: ProcurementSupplierRow[];
  from: string;
  to: string;
}) {
  const [tab, setTab] = useState<Tab>("orders");

  // Валют бүрд тусдаа pinned нийт мөр — олон валютын Σ нийлбэр утгагүй.
  const orderTotals = useMemo(() => {
    const byCurrency = new Map<string, ProcurementReportRow>();
    for (const order of orders) {
      if (order.status === "cancelled") continue;
      const total =
        byCurrency.get(order.currency) ??
        ({
          id: `total-${order.currency}`,
          documentNo: "НИЙТ",
          date: "",
          counterpartyName: "",
          currency: order.currency,
          status: "open",
          totalAmount: 0,
          receivedAmount: 0,
          invoicedAmount: 0,
          receivedPct: 0,
          invoicedPct: 0,
          unallocatedMnt: 0,
        } satisfies ProcurementReportRow);
      total.totalAmount += order.totalAmount;
      total.receivedAmount += order.receivedAmount;
      total.invoicedAmount += order.invoicedAmount;
      total.unallocatedMnt += order.unallocatedMnt;
      byCurrency.set(order.currency, total);
    }
    return [...byCurrency.values()];
  }, [orders]);

  // Нийлүүлэгчийн хөл дүн — захиалгын табтай ижил: ВАЛЮТ бүрд тусдаа мөр
  // (өөр валютыг нэмэхгүй).
  const supplierTotals = useMemo(() => {
    const byCurrency = new Map<string, ProcurementSupplierRow>();
    for (const row of suppliers) {
      const total =
        byCurrency.get(row.currency) ??
        ({
          counterpartyName: `НИЙТ · ${row.currency}`,
          currency: row.currency,
          orderCount: 0,
          openCount: 0,
          totalAmount: 0,
          receivedAmount: 0,
          invoicedAmount: 0,
        } satisfies ProcurementSupplierRow);
      total.orderCount += row.orderCount;
      total.openCount += row.openCount;
      total.totalAmount += row.totalAmount;
      total.receivedAmount += row.receivedAmount;
      total.invoicedAmount += row.invoicedAmount;
      byCurrency.set(row.currency, total);
    }
    return [...byCurrency.values()];
  }, [suppliers]);

  return (
    <ReportPage>
      <ReportHeader
        title="Захиалгын гүйцэтгэл"
        meta={`${reportRangeLabel(from, to)} · дүн бүр захиалгын валютаараа; цуцлагдсан захиалга нэгтгэлд орохгүй. Мөр дээр давхар дарж захиалгын панель нээнэ.`}
      />
      <ReportToolbar
        views={
          <PageTabs
            size="sm"
            ariaLabel="Захиалгын гүйцэтгэлийн зүсэлт"
            value={tab}
            onChange={(value) => setTab(value as Tab)}
            tabs={TABS}
          />
        }
      />

      {tab === "orders" &&
        (orders.length === 0 ? (
          <ReportEmpty
            icon="purchaseOrder"
            title="Мужид захиалга алга"
            description="Топбарын тайлант үеийн сонголтыг өөрчилж үзнэ үү."
          />
        ) : (
          <DataGridDynamic<ProcurementReportRow>
            rowData={orders}
            columnDefs={ORDER_COLUMNS}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            pinnedBottomRowData={orderTotals.map((total) => ({
              ...total,
              // Pinned мөрөнд % ба статус утгагүй тул хоосон үзүүлнэ.
              receivedPct: 0,
              invoicedPct: 0,
            }))}
            suppressCellFocus
            onRowDoubleClicked={(event) => {
              const id = event.data?.id;
              if (id && !id.startsWith("total-"))
                openPurchaseOrderPanel({ purchaseOrderId: id });
            }}
          />
        ))}

      {tab === "suppliers" &&
        (suppliers.length === 0 ? (
          <ReportEmpty
            icon="company"
            title="Мужид нийлүүлэгч алга"
            description="Топбарын тайлант үеийн сонголтыг өөрчилж үзнэ үү."
          />
        ) : (
          <DataGridDynamic<ProcurementSupplierRow>
            rowData={suppliers}
            columnDefs={SUPPLIER_COLUMNS}
            getRowId={(params) =>
              `${params.data.counterpartyName}·${params.data.currency}`
            }
            pinnedBottomRowData={supplierTotals}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        ))}
    </ReportPage>
  );
}
