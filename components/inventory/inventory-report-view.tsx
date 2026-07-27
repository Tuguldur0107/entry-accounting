"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
export function InventoryReportView({ rows, start, end }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [startInput, setStartInput] = useState(start);
  const [endInput, setEndInput] = useState(end);

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

  function refresh() {
    const params = new URLSearchParams();
    if (startInput) params.set("start", startInput);
    if (endInput) params.set("end", endInput);
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Тоо хэмжээний тайлан
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {start} — {end} · зөвхөн баталсан хөдөлгөөнөөр
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="h-8 w-40"
            value={startInput}
            onChange={(event) => setStartInput(event.target.value)}
          />
          <span className="text-xs text-[var(--ea-text-4)]">—</span>
          <Input
            type="date"
            className="h-8 w-40"
            value={endInput}
            onChange={(event) => setEndInput(event.target.value)}
          />
          <Button size="sm" onClick={refresh}>
            Шинэчлэх
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Хөдөлгөөн байхгүй
        </div>
      ) : (
        <DataGridDynamic<QtyFlowRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.key}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </div>
  );
}
