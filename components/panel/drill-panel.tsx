"use client";

// Самбарын метрикийн задаргаа — панель хэлбэрээр. Урьд нь modal dialog
// байсан бөгөөд overlay нь шинээр нээгдэх журналын панелийг дарж блоклодог
// байв; одоо задаргааны жагсаалтаа нээлттэй байлгаад журналуудыг зэрэгцүүлж
// нээж болно. Мөрүүд нь самбар дээр бодогдоод payload-аар шууд ирдэг
// (сервер fetch байхгүй — самбар шинэчлэгдээд дахин дарахад payload солигдоно).

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  openVoucherPanel,
  type DrillPanelPayload,
  type DrillPanelRow,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { fmtMnt } from "@/lib/reports/balances";

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Бичигдсэн",
  reversed: "Буцаагдсан",
};

export function DrillPanel({ panel }: { panel: PanelInstance }) {
  const payload = panel.payload as DrillPanelPayload;
  const rows = payload.rows ?? [];

  const columns = useMemo<ColDef<DrillPanelRow>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 104, cellClass: "font-mono text-xs" },
      { headerName: "Утга", field: "description", minWidth: 190, flex: 1 },
      { headerName: "Модуль", field: "module", width: 128, cellClass: "text-xs" },
      {
        headerName: "Мөр",
        field: "lineCount",
        width: 64,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 110,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellClass: "text-xs",
      },
    ],
    []
  );

  const total =
    Math.round(rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ea-text-3)]">
        <span>
          {rows.length} журнал · Σ{" "}
          <span className="font-mono font-medium text-[var(--ea-text-1)]">
            {fmtMnt(total)}
          </span>
          {payload.note ? ` · ${payload.note}` : ""}
        </span>
        {payload.link && (
          <Link
            href={payload.link.href}
            className="inline-flex items-center gap-1 font-medium text-[var(--ea-primary)]"
          >
            {payload.link.label}
            <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-[var(--ea-border)] px-3 py-6 text-center text-xs text-[var(--ea-text-4)]">
          Журнал олдсонгүй
        </p>
      ) : (
        <>
          <p className="text-[11px] text-[var(--ea-text-4)]">
            Мөр дээр дарахад журнал өөрийн панельд нээгдэнэ
          </p>
          <DataGridDynamic<DrillPanelRow>
            rowData={rows}
            columnDefs={columns}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onRowClicked={(event) => {
              if (event.data)
                openVoucherPanel(event.data.id, event.data.description);
            }}
          />
        </>
      )}
    </div>
  );
}
