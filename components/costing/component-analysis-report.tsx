"use client";

// Өртгийн бүрэлдэхүүний задаргаа — docs/cost §4.
// Барааны Орлогын дүн юунаас бүрдсэнийг үзүүлнэ: худалдан авах үнэ +
// хуваарилагдсан бүрэлдэхүүнүүд. Бараа тус бүрээр бүлэглэж, §4.3-ын
// хяналтыг (бүрэлдэхүүний нийлбэр = Орлогын дүн) мөрөөр гаргана.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { ArrowUpRight } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ComponentAnalysisRow } from "@/lib/costing/component-analysis-types";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtPeriodCode } from "@/lib/periods/period";
import { openVoucherPanel } from "@/lib/store/panel-store";

interface Props {
  periodCode: string;
  periodOptions: string[];
  rows: ComponentAnalysisRow[];
}

export function ComponentAnalysisReport({
  periodCode,
  periodOptions,
  rows,
}: Props) {
  const router = useRouter();

  function changePeriod(next: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("period", next);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }

  const columns = useMemo<ColDef<ComponentAnalysisRow>[]>(
    () => [
      {
        headerName: "Барааны код",
        field: "itemCode",
        width: 140,
        cellClass: "font-mono text-xs",
        rowGroup: false,
      },
      { headerName: "Барааны нэр", field: "itemName", minWidth: 180, flex: 1 },
      {
        headerName: "Агуулах",
        field: "warehouseLabel",
        width: 150,
        cellClass: "text-xs",
      },
      {
        headerName: "Бүрэлдэхүүн",
        colId: "component",
        width: 200,
        valueGetter: (params) =>
          params.data
            ? `${params.data.componentCode} · ${params.data.componentName}`
            : "",
        cellClass: "text-xs",
      },
      {
        headerName: "Эх баримт",
        field: "sourceDocumentNo",
        width: 170,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Хуваарилалт",
        field: "allocationDocumentNo",
        width: 180,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => params.value ?? "—",
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Нэгжид нөлөө",
        field: "unitCostImpact",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value == null
            ? "—"
            : Number(params.value).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              }),
      },
      {
        headerName: "Дебет",
        colId: "debit",
        width: 200,
        valueGetter: (params) => {
          const row = params.data;
          if (!row?.debitAccountCode) return "—";
          return `${row.debitAccountCode} ${row.debitAccountName ?? ""}`.trim();
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Кредит",
        colId: "credit",
        width: 200,
        valueGetter: (params) => {
          const row = params.data;
          if (!row?.creditAccountCode) return "—";
          return `${row.creditAccountCode} ${row.creditAccountName ?? ""}`.trim();
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төлөв",
        field: "glStatus",
        width: 140,
        cellRenderer: (params: { data?: ComponentAnalysisRow }) => {
          const status = params.data?.glStatus;
          if (!status) return null;
          return (
            <div className="flex h-full items-center">
              <StatusBadge tone={status === "posted" ? "success" : "warning"}>
                {status === "posted" ? "Бичигдсэн" : "GL-д бичигдээгүй"}
              </StatusBadge>
            </div>
          );
        },
      },
      {
        headerName: "Журнал",
        colId: "journal",
        width: 120,
        cellRenderer: (params: { data?: ComponentAnalysisRow }) => {
          const row = params.data;
          if (!row?.voucherId) return <span className="text-xs">—</span>;
          return (
            <button
              type="button"
              onClick={() =>
                openVoucherPanel(row.voucherId!, row.sourceDocumentNo)
              }
              className="inline-flex items-center gap-1 font-mono text-xs text-[var(--ea-primary)] hover:underline"
            >
              {row.journalNo}
              <ArrowUpRight size={11} />
            </button>
          );
        },
      },
    ],
    []
  );

  const total = rows.reduce((sum, row) => sum + row.amount, 0);

  // §4.3 хяналт — бараа тус бүрийн бүрэлдэхүүний нийлбэр.
  const byItem = useMemo(() => {
    const map = new Map<
      string,
      { label: string; total: number; components: number }
    >();
    for (const row of rows) {
      const key = `${row.itemCode}|${row.warehouseLabel}`;
      const current = map.get(key);
      if (current) {
        current.total += row.amount;
        current.components += 1;
      } else
        map.set(key, {
          label: `${row.itemCode} · ${row.itemName} — ${row.warehouseLabel}`,
          total: row.amount,
          components: 1,
        });
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const pinnedBottom = useMemo<ComponentAnalysisRow[]>(
    () => [
      {
        id: "__total__",
        periodCode,
        itemCode: "",
        itemName: "Нийт",
        warehouseLabel: "",
        componentCode: "",
        componentName: "",
        sourceDocumentType: "",
        sourceDocumentNo: "",
        allocationDocumentNo: null,
        amount: total,
        unitCostImpact: null,
        debitAccountCode: null,
        debitAccountName: null,
        creditAccountCode: null,
        creditAccountName: null,
        glStatus: "posted",
        journalNo: null,
        voucherId: null,
      },
    ],
    [periodCode, total]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Өртгийн бүрэлдэхүүний задаргаа
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Барааны Орлогын дүн юунаас бүрдсэн — худалдан авах үнэ + тээвэр,
            гааль, даатгал зэрэг хуваарилагдсан бүрэлдэхүүнүүд.
          </p>
        </div>
        <select
          className="h-8 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]"
          value={periodCode}
          onChange={(event) => changePeriod(event.target.value)}
        >
          {periodOptions.length === 0 && (
            <option value={periodCode}>{fmtPeriodCode(periodCode)}</option>
          )}
          {periodOptions.map((code) => (
            <option key={code} value={code}>
              {fmtPeriodCode(code)}
            </option>
          ))}
        </select>
      </div>

      {byItem.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {byItem.slice(0, 6).map((entry) => (
            <span
              key={entry.label}
              className="rounded-md border border-[var(--ea-border)] px-2 py-1 text-[11px] text-[var(--ea-text-3)]"
            >
              {entry.label} ·{" "}
              <span className="font-mono font-medium text-[var(--ea-text-1)]">
                {fmtMnt(entry.total)}
              </span>{" "}
              ({entry.components} бүрэлдэхүүн)
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] px-6 text-center text-sm text-[var(--ea-text-4)]">
          {periodCode} сард орлогын өртгийн бичилт алга. Орлого үнэлж,
          &quot;Зардлын хуваарилалт&quot; хийсний дараа задаргаа харагдана.
        </div>
      ) : (
        <DataGridDynamic<ComponentAnalysisRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          pinnedBottomRowData={pinnedBottom}
          suppressCellFocus
        />
      )}
    </div>
  );
}
