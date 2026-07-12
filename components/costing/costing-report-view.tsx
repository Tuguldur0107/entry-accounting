"use client";

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import type { TieOutRow, ValuationRow } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  valuation: ValuationRow[];
  tieOut: TieOutRow[];
}

// Үнэлгээний тайлан (batalgдсан бичилтээр qty × дундаж өртөг) + GL тулгалт.
export function CostingReportView({ valuation, tieOut }: Props) {
  const valuationColumns = useMemo<ColDef<ValuationRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      {
        headerName: "Үлдэгдэл",
        field: "quantity",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.data ? `${fmtQty(params.data.quantity)} ${params.data.unit}` : "",
      },
      {
        headerName: "Дундаж өртөг",
        field: "avgCost",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үнэлгээ",
        field: "value",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const tieOutColumns = useMemo<ColDef<TieOutRow>[]>(
    () => [
      {
        headerName: "GL данс",
        colId: "account",
        minWidth: 220,
        flex: 1,
        valueGetter: (params) =>
          params.data
            ? `${params.data.accountNumber} ${params.data.accountName}`
            : "",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Subledger (өртгийн бичилт)",
        field: "subledgerValue",
        width: 190,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "GL үлдэгдэл",
        field: "glBalance",
        width: 170,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Зөрүү",
        field: "difference",
        width: 150,
        headerClass: "ag-right-aligned-header",
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono font-semibold",
            Math.abs(Number(params.value ?? 0)) > 0.01 && "text-[var(--ea-danger)]"
          ),
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const totalValue = valuation.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Өртгийн тайлан
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Батлагдсан өртгийн бичилтээр — нийт үнэлгээ{" "}
          <span className="font-mono font-semibold">{fmtMnt(totalValue)}</span>
        </p>
      </div>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Нөөцийн үнэлгээ (qty × дундаж өртөг)
        </h2>
        {valuation.length === 0 ? (
          <EmptyBox text="Батлагдсан өртгийн бичилт байхгүй" />
        ) : (
          <DataGridDynamic<ValuationRow>
            rowData={valuation}
            columnDefs={valuationColumns}
            getRowId={(params) => params.data.itemId}
            height={Math.min(480, 86 + valuation.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>

      <section className="min-w-0">
        <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          GL тулгалт (14-бүлгийн данс)
        </h2>
        <p className="mb-2 text-[11px] text-[var(--ea-text-4)]">
          Subledger = батлагдсан өртгийн бичилтийн цэвэр дүн; GL = журналын
          үлдэгдэл. Зөрүү нь гараар бичсэн журнал эсвэл үнэлэгдээгүй хөдөлгөөнийг
          илтгэнэ.
        </p>
        {tieOut.length === 0 ? (
          <EmptyBox text="14-бүлгийн данс ашиглагдаагүй байна" />
        ) : (
          <DataGridDynamic<TieOutRow>
            rowData={tieOut}
            columnDefs={tieOutColumns}
            getRowId={(params) => params.data.accountNumber}
            height={Math.min(360, 86 + tieOut.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </section>
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
      {text}
    </div>
  );
}
