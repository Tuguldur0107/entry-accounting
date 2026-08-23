"use client";

// ХХОАТ / НДШ хуудсын сарын нэгтгэлийн хүснэгт — payroll бодолтоос
// нэгтгэсэн тоог харуулна (тооцоолол payroll модульд). Хүснэгтийн стандарт:
// DataGridDynamic (AG Grid) — өөрийн table markup хориотой.

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/grid/formatters";
import { fmtPeriodCode } from "@/lib/periods/period";
import type { PayrollTaxMonth } from "@/lib/tax/payroll-summary";

const moneyCol: Partial<ColDef<PayrollTaxMonth>> = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params) => (params.value != null ? fmtMnt(params.value) : ""),
};

export function PayrollTaxGrid({
  rows,
  variant,
}: {
  rows: PayrollTaxMonth[];
  /** pit — ХХОАТ багана, si — НДШ (ажилтан/ажил олгогч) баганууд. */
  variant: "pit" | "si";
}) {
  const columnDefs = useMemo<ColDef<PayrollTaxMonth>[]>(() => {
    const base: ColDef<PayrollTaxMonth>[] = [
      {
        headerName: "Сар",
        field: "periodMonth",
        width: 110,
        valueFormatter: (params) =>
          params.value ? fmtPeriodCode(params.value) : "",
      },
      { headerName: "Ажилтан", field: "employees", width: 100 },
      { headerName: "Нийт олголт", field: "earnings", flex: 1, minWidth: 150, ...moneyCol },
    ];
    const taxCols: ColDef<PayrollTaxMonth>[] =
      variant === "pit"
        ? [{ headerName: "ХХОАТ суутгал", field: "pit", flex: 1, minWidth: 150, ...moneyCol }]
        : [
            {
              headerName: "НДШ (ажилтан)",
              field: "employeeSi",
              flex: 1,
              minWidth: 150,
              ...moneyCol,
            },
            {
              headerName: "НДШ (ажил олгогч)",
              field: "employerSi",
              flex: 1,
              minWidth: 160,
              ...moneyCol,
            },
            {
              headerName: "Нийт НДШ",
              flex: 1,
              minWidth: 150,
              ...moneyCol,
              valueGetter: (params) =>
                params.data
                  ? params.data.employeeSi + params.data.employerSi
                  : null,
            },
          ];
    return [
      ...base,
      ...taxCols,
      {
        headerName: "GL журнал",
        field: "voucherCreated",
        width: 120,
        valueFormatter: (params) => (params.value ? "Үүссэн" : "Үүсээгүй"),
        cellClass: (params) =>
          params.value ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-text-3)]",
      },
    ];
  }, [variant]);

  return (
    <DataGridDynamic<PayrollTaxMonth>
      rowData={rows}
      columnDefs={columnDefs}
      getRowId={(params) => params.data.periodMonth}
      height="flex"
      wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
      suppressCellFocus
    />
  );
}
