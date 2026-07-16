"use client";

// Dialog/drawer доторх GL воучерын мөрийн нэгдсэн хүснэгт — хүснэгтийн
// стандартын дагуу DataGridDynamic ашиглана (<table> хориотой). Дебет/кредит
// нийлбэрийг pinned доод мөрөөр үзүүлнэ. Cash болон Costing-ийн дэлгэрэнгүй
// drawer хоёулаа энийг ашиглана.

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay } from "@/lib/grid/segments";

export interface VoucherLineRow {
  accountNumber: string;
  debit: number;
  credit: number;
  description: string | null;
}

interface Props {
  lines: VoucherLineRow[];
  activeSegIds: number[];
  glName: (mainAccount: string) => string;
}

type Row = VoucherLineRow & { key: string; isTotal?: boolean };

export function VoucherLinesTable({ lines, activeSegIds, glName }: Props) {
  const rows: Row[] = useMemo(
    () => lines.map((line, index) => ({ ...line, key: String(index) })),
    [lines]
  );
  const totals: Row[] = useMemo(
    () => [
      {
        key: "total",
        isTotal: true,
        accountNumber: "",
        description: "Нийт",
        debit: lines.reduce((sum, line) => sum + line.debit, 0),
        credit: lines.reduce((sum, line) => sum + line.credit, 0),
      },
    ],
    [lines]
  );

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: "Данс",
        colId: "account",
        minWidth: 220,
        flex: 1,
        sortable: false,
        filter: false,
        valueGetter: (params) => {
          const row = params.data;
          if (!row || row.isTotal) return "";
          const parts = row.accountNumber.split(".");
          const main = parts.length === 10 ? parts[2] : row.accountNumber;
          return `${fmtAccountDisplay(row.accountNumber, activeSegIds)} ${glName(main)}`;
        },
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Гүйлгээний утга",
        field: "description",
        minWidth: 160,
        flex: 1,
        sortable: false,
        filter: false,
        valueFormatter: (params) =>
          params.data?.isTotal ? "Нийт" : String(params.value ?? "—"),
        cellClass: (params) =>
          params.data?.isTotal
            ? "font-semibold text-right"
            : "text-[var(--ea-text-2)]",
      },
      {
        headerName: "Дебет",
        field: "debit",
        width: 130,
        sortable: false,
        filter: false,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) !== 0 || params.data?.isTotal
            ? fmtMnt(Number(params.value ?? 0))
            : "—",
      },
      {
        headerName: "Кредит",
        field: "credit",
        width: 130,
        sortable: false,
        filter: false,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) !== 0 || params.data?.isTotal
            ? fmtMnt(Number(params.value ?? 0))
            : "—",
      },
    ],
    [activeSegIds, glName]
  );

  return (
    <DataGridDynamic<Row>
      rowData={rows}
      columnDefs={columns}
      getRowId={(params) => params.data.key}
      pinnedBottomRowData={totals}
      height={86 + Math.min(rows.length, 8) * 34 + 34}
      wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
      suppressCellFocus
    />
  );
}
