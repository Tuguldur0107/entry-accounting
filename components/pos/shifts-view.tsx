"use client";

// Ээлжийн таб — docs/pos §4.5: жагсаалт, «Ээлж нээх», нээлттэй мөрөнд
// «Ээлж хаах» (тоолсон бэлэн → систем / зөрүү), мөр бүрд «Z-тайлан» (хэвлэх).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  CloseShiftDialog,
  OpenShiftDialog,
  ZReportDialog,
  type ShiftCashAccount,
  type ShiftWarehouse,
} from "@/components/pos/shift-dialogs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { SHIFT_STATUS_LABELS } from "@/lib/pos/constants";
import type { PosShiftView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";

const fmtTime = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

const money = (value: unknown) => (value == null ? "" : fmtMnt(Number(value)));

export function ShiftsView({
  shifts,
  cashAccounts,
  warehouses,
  defaultWarehouseId,
}: {
  shifts: PosShiftView[];
  cashAccounts: ShiftCashAccount[];
  warehouses: ShiftWarehouse[];
  defaultWarehouseId: string | null;
}) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState(false);
  const [closing, setClosing] = useState<PosShiftView | null>(null);
  const [zReport, setZReport] = useState<PosShiftView | null>(null);

  const columns = useMemo<ColDef<PosShiftView>[]>(
    () => [
      { headerName: "Дугаар", field: "documentNo", width: 130, cellClass: "font-mono text-xs" },
      {
        headerName: "Нээсэн",
        field: "openedAt",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtTime(String(p.value ?? "")),
      },
      {
        headerName: "Хаасан",
        field: "closedAt",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (p) => fmtTime(p.value as string | null),
      },
      { headerName: "Касс", field: "cashAccountName", minWidth: 140, flex: 1 },
      { headerName: "Агуулах", field: "warehouseName", minWidth: 130, flex: 1 },
      { headerName: "Кассчин", field: "openedByName", width: 130 },
      {
        headerName: "Эхний мөнгө",
        field: "openingFloat",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Бэлэн орлого",
        field: "cashReceipts",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Буцаалт",
        field: "cashRefunds",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Систем",
        field: "systemCash",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Тоолсон",
        field: "countedCash",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Зөрүү",
        field: "varianceAmount",
        width: 110,
        cellClass: (p) =>
          `ag-right-aligned-cell font-mono text-xs${
            p.value != null && Number(p.value) !== 0 ? " font-semibold text-[var(--ea-danger-fg)]" : ""
          }`,
        headerClass: "ag-right-aligned-header",
        valueFormatter: (p) => money(p.value),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 110,
        valueGetter: (p) => (p.data ? SHIFT_STATUS_LABELS[p.data.status] : ""),
        cellRenderer: (p: ICellRendererParams<PosShiftView>) =>
          p.data ? (
            <span className="flex h-full items-center">
              <StatusBadge tone={p.data.status === "open" ? "success" : "muted"} size="sm">
                {SHIFT_STATUS_LABELS[p.data.status]}
              </StatusBadge>
            </span>
          ) : null,
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 200,
        sortable: false,
        filter: false,
        cellClass: "flex items-center",
        cellRenderer: (p: ICellRendererParams<PosShiftView>) =>
          p.data ? (
            <div className="flex items-center gap-1">
              {p.data.status === "open" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--warning"
                  onClick={() => setClosing(p.data!)}
                >
                  <Icon name="locked" size="xs" />
                  Ээлж хаах
                </button>
              )}
              <button type="button" className="ea-btn" onClick={() => setZReport(p.data!)}>
                <Icon name="report" size="xs" />
                Z-тайлан
              </button>
            </div>
          ) : null,
      },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpenDialog(true)}>
          <Icon name="unlocked" size="sm" />
          Ээлж нээх
        </Button>
      </div>
      {shifts.length === 0 ? (
        <EmptyState
          icon="cash"
          title="Ээлж бүртгэгдээгүй"
          description="Борлуулалт бүр нээлттэй ээлжид харьяалагдана — эхлээд ээлж нээнэ үү."
          actions={[{ label: "Ээлж нээх", onClick: () => setOpenDialog(true), icon: "unlocked", primary: true }]}
        />
      ) : (
        <DataGridDynamic<PosShiftView>
          rowData={shifts}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={shifts.length > 50}
          paginationPageSize={50}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <OpenShiftDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        cashAccounts={cashAccounts}
        warehouses={warehouses}
        defaultWarehouseId={defaultWarehouseId}
        onDone={() => router.refresh()}
      />
      <CloseShiftDialog shift={closing} onClose={() => setClosing(null)} onDone={() => router.refresh()} />
      <ZReportDialog shift={zReport} onClose={() => setZReport(null)} />
    </div>
  );
}
