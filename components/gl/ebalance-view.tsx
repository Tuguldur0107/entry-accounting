"use client";

// e-Balance маягтын санхүүгийн тайлан — НЭГ тайлангийн 4 зүсэлт (СТ-1 … СТ-4),
// хуудас доторх таб = зүсэлт («Тайлангийн стандарт» 2). Дүн бүр серверт
// lib/reports/ebalance.ts-ээр бодогдож ирнэ; Excel нь 4 хуудастай нэг файл —
// нягтлан e-Balance-д шивэхдээ мөрийн дугаараар хуулна.

import { useMemo, useState } from "react";
import type { CellStyle, ColDef, RowClassParams } from "ag-grid-community";
import { toast } from "sonner";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { PageTabs } from "@/components/ui/tabs";
import { ReportToolbar } from "@/components/reports/report-layout";
import { col } from "@/lib/grid/columnTypes";
import { downloadWorkbookSheets, type ExportColumn } from "@/lib/excel/core";
import type { EbalanceReport, EbalanceRow, EbalanceStatement, EbalanceStatementKey } from "@/lib/reports/ebalance";

interface Props {
  report: EbalanceReport;
}

type GridRow = EbalanceRow & { cellValues: Record<string, number | null> };

const TAB_OPTIONS: readonly { value: EbalanceStatementKey; label: string }[] = [
  { value: "bs", label: "СТ-1 Баланс" },
  { value: "is", label: "СТ-2 Орлого" },
  { value: "equity", label: "СТ-3 Өмчийн өөрчлөлт" },
  { value: "cf", label: "СТ-4 Мөнгөн гүйлгээ" },
];

/** Маягтын мөр → grid мөр: тоон баганууд `c0…cN` түлхүүрээр (equity олон баганатай). */
function toGridRows(statement: EbalanceStatement): GridRow[] {
  return statement.rows.map((row) => {
    const cellValues: Record<string, number | null> = {};
    if (row.cells) row.cells.forEach((value, index) => (cellValues[`c${index}`] = value));
    else if (statement.key === "bs") {
      cellValues.c0 = row.opening ?? null;
      cellValues.c1 = row.amount;
    } else cellValues.c0 = row.amount;
    return { ...row, cellValues };
  });
}

function numericValue(row: GridRow, index: number): number | null {
  const value = row.cellValues[`c${index}`];
  return value === undefined ? null : value;
}

export function EbalanceView({ report }: Props) {
  const [active, setActive] = useState<EbalanceStatementKey>("bs");
  const statement = report.statements.find((s) => s.key === active) ?? report.statements[0];
  const rows = useMemo(() => toGridRows(statement), [statement]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(() => {
    const defs: ColDef<GridRow>[] = [
      col<GridRow>({ eaType: "readonly-text", field: "code", headerName: "Мөр", width: 90 }),
      col<GridRow>({
        eaType: "readonly-text",
        field: "label",
        headerName: "Үзүүлэлт",
        flex: 2,
        minWidth: 260,
        cellStyle: (params): CellStyle | null =>
          params.data?.kind === "header"
            ? { fontWeight: 600 }
            : params.data?.kind === "line"
              ? { paddingLeft: 24 }
              : null,
      }),
    ];
    statement.columns.forEach((header, index) => {
      defs.push(
        col<GridRow>({
          eaType: "readonly-money",
          headerName: header,
          colId: `c${index}`,
          width: 160,
          valueGetter: (params) => (params.data ? numericValue(params.data, index) : null),
        })
      );
    });
    defs.push(
      col<GridRow>({
        eaType: "readonly-text",
        headerName: "Entry-ийн эх",
        flex: 2,
        minWidth: 220,
        valueGetter: (params) => params.data?.sources.join(", ") ?? "",
        tooltipValueGetter: (params) => params.data?.sources.join(", ") ?? "",
      }),
      col<GridRow>({
        eaType: "readonly-text",
        field: "note",
        headerName: "Тэмдэглэл",
        flex: 2,
        minWidth: 220,
        tooltipField: "note",
        cellStyle: { color: "var(--ea-warning-fg)" },
      })
    );
    return defs;
  }, [statement]);

  const rowClassRules = useMemo(
    () => ({
      "font-semibold": (params: RowClassParams<GridRow>) =>
        params.data?.kind === "subtotal" || params.data?.kind === "total",
    }),
    []
  );

  async function exportExcel() {
    try {
      await downloadWorkbookSheets({
        slug: `entry-ebalance-${report.from}-${report.to}`,
        sheets: report.statements.map((s) => {
          const columns: ExportColumn[] = [
            { header: "Мөр", width: 10 },
            { header: "Үзүүлэлт", width: 56 },
            ...s.columns.map((header) => ({ header, width: 20, kind: "number" as const })),
            { header: "Entry-ийн эх", width: 40 },
            { header: "Тэмдэглэл", width: 48 },
          ];
          const gridRows = toGridRows(s);
          const boldRows: number[] = [];
          const rowsOut = gridRows.map((row, index) => {
            if (row.kind !== "line") boldRows.push(index);
            return [
              row.code,
              row.label,
              ...s.columns.map((_, i) => (row.kind === "header" ? null : numericValue(row, i))),
              row.sources.join(", "),
              row.note ?? "",
            ];
          });
          for (const note of s.notes) rowsOut.push(["", `⚠ ${note}`, ...s.columns.map(() => null), "", ""]);
          return { sheetName: `${s.form} ${s.title}`, columns, rows: rowsOut, boldRows };
        }),
      });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Excel үүсгэж чадсангүй");
    }
  }

  return (
    <>
      <ReportToolbar
        views={
          <PageTabs
            tabs={TAB_OPTIONS}
            value={active}
            onChange={setActive}
            ariaLabel="e-Balance маягт"
            trailing={
              <Button type="button" variant="outline" size="sm" onClick={() => void exportExcel()}>
                Excel (4 маягт)
              </Button>
            }
          />
        }
      />
      {statement.notes.length > 0 ? (
        <ul className="space-y-1 text-xs text-[var(--ea-warning-fg)]">
          {statement.notes.map((note) => (
            <li key={note}>⚠ {note}</li>
          ))}
        </ul>
      ) : null}
      <DataGridDynamic<GridRow>
        rowData={rows}
        columnDefs={columnDefs}
        rowClassRules={rowClassRules}
        getRowId={(params) => params.data.code}
        height="flex"
      />
    </>
  );
}
