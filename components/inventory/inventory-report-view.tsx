"use client";

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  ReportEmpty,
  ReportHeader,
  ReportPage,
  reportRangeLabel,
} from "@/components/reports/report-layout";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

export type QtyFlowRow = {
  key: string;
  itemLabel: string;
  unit: string;
  warehouseName: string;
  opening: number;
  inQty: number;
  outQty: number;
  closing: number;
};

interface Props {
  rows: QtyFlowRow[];
  start: string;
  end: string;
}

// Тоо хэмжээний хөдөлгөөний тайлан: эхний үлдэгдэл + орлого − зарлага = эцсийн.
// Огнооны муж ЗӨВХӨН топбарын периодоос (тайлангийн стандарт) — энд талбаргүй.
export function InventoryReportView({ rows, start, end }: Props) {
  const columns = useMemo<ColDef<QtyFlowRow>[]>(() => {
    const qtyCol = (
      field: keyof QtyFlowRow & string,
      headerName: string,
      strong = false
    ): ColDef<QtyFlowRow> => ({
      headerName,
      field,
      width: 130,
      cellClass: `ag-right-aligned-cell font-mono${strong ? " font-semibold" : ""}`,
      headerClass: "ag-right-aligned-header",
      valueFormatter: (params) => fmtQty(Number(params.value ?? 0)),
    });
    return [
      { headerName: "Бараа", field: "itemLabel", minWidth: 200, flex: 1 },
      { headerName: "Агуулах", field: "warehouseName", minWidth: 140, flex: 1 },
      { headerName: "Хэмжих нэгж", field: "unit", width: 110 },
      qtyCol("opening", "Эхний үлдэгдэл"),
      qtyCol("inQty", "Орлого"),
      qtyCol("outQty", "Зарлага"),
      qtyCol("closing", "Эцсийн үлдэгдэл", true),
    ];
  }, []);

  // Хөл дүн: хэмжих нэгж НЭГ бол л нийлбэр утгатай (ширхэг + кг нэмэхгүй).
  const units = new Set(rows.map((row) => row.unit));
  const pinned: QtyFlowRow[] | undefined =
    rows.length > 0 && units.size === 1
      ? [
          {
            key: "__total",
            itemLabel: "Нийт",
            unit: rows[0].unit,
            warehouseName: "",
            opening: sumQty(rows, "opening"),
            inQty: sumQty(rows, "inQty"),
            outQty: sumQty(rows, "outQty"),
            closing: sumQty(rows, "closing"),
          },
        ]
      : undefined;

  return (
    <ReportPage>
      <ReportHeader
        title="Тоо хэмжээний урсгал"
        meta={`${reportRangeLabel(start, end)} · эхний үлдэгдэл + орлого − зарлага = эцсийн; зөвхөн баталсан хөдөлгөөнөөр${
          units.size > 1 ? " · хэмжих нэгж холимог тул нийт дүнгүй" : ""
        }`}
      />
      {rows.length === 0 ? (
        <ReportEmpty
          icon="report"
          title="Хөдөлгөөн байхгүй"
          description="Сонгосон мужид баталсан хөдөлгөөн алга — топбараас периодоо солиод үзнэ үү."
        />
      ) : (
        <DataGridDynamic<QtyFlowRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.key}
          pinnedBottomRowData={pinned}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </ReportPage>
  );
}

function sumQty(rows: QtyFlowRow[], field: "opening" | "inQty" | "outQty" | "closing") {
  return Math.round(rows.reduce((sum, row) => sum + row[field], 0) * 10000) / 10000;
}
