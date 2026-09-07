"use client";

// Тайлангийн үзүүлэлтийн задаргаа — тухайн мөрийг бүрдүүлэгч данс бүрийн
// үлдэгдэл. Мөр дээр давхар дарахад тухайн дансны хуулга (журналуудын
// жагсаалт) дараагийн drill панелиар нээгдэж, тэндээс журнал руу орно —
// баланс → данс → журнал гэсэн хамгийн гүн задаргааны гинж.

import { useMemo, useState } from "react";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { getAccountDrillRows } from "@/lib/actions/report-drill";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openDrillPanel,
  type PanelInstance,
  type ReportLineAccountRow,
  type ReportLineDrillPayload,
} from "@/lib/store/panel-store";

export function ReportLinePanel({ panel }: { panel: PanelInstance }) {
  const payload = panel.payload as ReportLineDrillPayload;
  const rows = payload.rows ?? [];
  const [busyMain, setBusyMain] = useState<string | null>(null);

  const columns = useMemo<ColDef<ReportLineAccountRow>[]>(
    () => [
      {
        headerName: "Данс",
        field: "main",
        width: 110,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Дансны нэр", field: "name", minWidth: 200, flex: 1 },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  async function openLedger(row: ReportLineAccountRow) {
    if (busyMain) return;
    setBusyMain(row.main);
    const result = await getAccountDrillRows({
      mainAccount: row.main,
      from: payload.from,
      to: payload.to,
    });
    setBusyMain(null);
    if (result.error || !result.rows) {
      toast.error(result.error ?? "Дансны задаргаа ачаалагдсангүй");
      return;
    }
    openDrillPanel({
      title: `${row.main} · ${row.name}`,
      note: `${payload.from} — ${payload.to} · Эхний үлдэгдэл ${fmtMnt(result.opening)} · Эцсийн үлдэгдэл ${fmtMnt(result.closing)}`,
      rows: result.rows,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
      <p className="text-[11px] text-[var(--ea-text-4)]">
        {payload.from} — {payload.to} · Мөр дээр давхар дарахад дансны хуулга
        (журналуудын жагсаалт) нээгдэнэ
        {busyMain ? ` · ${busyMain} ачаалж байна…` : ""}
      </p>
      <DataGridDynamic<ReportLineAccountRow>
        rowData={rows}
        columnDefs={columns}
        getRowId={(params) => params.data.main}
        height="flex"
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
        pinnedBottomRowData={[
          { main: "", name: "Нийт", amount: payload.total },
        ]}
        onRowDoubleClicked={(event) => {
          if (event.node.rowPinned) return;
          if (event.data) void openLedger(event.data);
        }}
      />
    </div>
  );
}
