"use client";

// Хуулга хадгалахаас ӨМНӨ мөр бүрээс үүсэх давхар бичилтийн урьдчилсан
// харагдац (docs/dev/arap.md §5l). Тооцоо нь ЦЭВЭР previewBankRowPostings —
// сервер (lib/cash/import-statement.ts) ижил дүрмээр бичнэ; энд юу ч
// бичигдэхгүй. ₮ дүнгээр (baseAmount).

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  previewBankRowPostings,
  type PreviewContext,
} from "@/lib/cash/bank-row-preview";
import type { ParsedBankStatementRow } from "@/lib/cash/bank-statement-types";
import { col } from "@/lib/grid/columnTypes";

type GridRow = {
  id: string;
  rowNumber: number | null;
  voucher: string;
  account: string;
  accountName: string;
  debit: number;
  credit: number;
};

export function BankRowPreviewDialog({
  open,
  onOpenChange,
  rows,
  context,
  accountName,
  scopeLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ParsedBankStatementRow[];
  context: PreviewContext;
  accountName: (main: string) => string;
  /** «Сонгосон 3 мөр» / «Бүх 19 мөр» г.м. */
  scopeLabel: string;
}) {
  const { gridRows, notes, totals } = useMemo(() => {
    const gridRows: GridRow[] = [];
    const notes: { rowNumber: number; text: string }[] = [];
    let debit = 0;
    let credit = 0;
    for (const row of rows) {
      const preview = previewBankRowPostings(row, context);
      preview.lines.forEach((line, index) => {
        gridRows.push({
          id: `${row.id}:${index}`,
          rowNumber: row.rowNumber,
          voucher: line.voucher,
          account: line.account || "—",
          accountName: line.account ? accountName(line.account) : "Данс дутуу",
          debit: line.debit,
          credit: line.credit,
        });
        debit += line.debit;
        credit += line.credit;
      });
      for (const text of preview.notes) notes.push({ rowNumber: row.rowNumber, text });
    }
    return {
      gridRows,
      notes,
      totals: { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 },
    };
  }, [rows, context, accountName]);

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { headerName: "Мөр", field: "rowNumber", width: 70, cellClass: "font-mono" },
      { headerName: "Баримт", field: "voucher", width: 190 },
      { headerName: "Данс", field: "account", width: 110, cellClass: "font-mono" },
      { headerName: "Дансны нэр", field: "accountName", flex: 1, minWidth: 160 },
      col<GridRow>({ eaType: "readonly-money", headerName: "Дебит", field: "debit", width: 140 }),
      col<GridRow>({ eaType: "readonly-money", headerName: "Кредит", field: "credit", width: 140 }),
    ],
    []
  );

  const balanced = Math.abs(totals.debit - totals.credit) <= 0.01;
  const pinnedBottom = useMemo<GridRow[]>(
    () => [
      {
        id: "total",
        rowNumber: null,
        voucher: "Нийт",
        account: "",
        accountName: "",
        debit: totals.debit,
        credit: totals.credit,
      },
    ],
    [totals]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Бичилтийн урьдчилсан харагдац</DialogTitle>
          <DialogDescription>
            {scopeLabel} хадгалахад үүсэх журнал (₮). «Авлага үүсгэж борлуулалтад» мөр
            эхлээд борлуулалтын нэхэмжлэх, дараа нь түүнийг хаах банкны гүйлгээ болно.
            Одоогоор юу ч бичигдээгүй.
          </DialogDescription>
        </DialogHeader>

        <DataGridDynamic<GridRow>
          rowData={gridRows}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          pinnedBottomRowData={pinnedBottom}
          height={Math.min(460, 96 + gridRows.length * 34)}
          suppressCellFocus
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge tone={balanced ? "success" : "danger"} size="sm" icon={balanced ? "success" : "error"}>
            {balanced ? "Дебит = Кредит" : "Тэнцээгүй"}
          </StatusBadge>
          {notes.length > 0 && (
            <StatusBadge tone="warning" size="sm" icon="warning">
              {notes.length} анхааруулга
            </StatusBadge>
          )}
        </div>
        {notes.length > 0 && (
          <ul className="max-h-32 space-y-0.5 overflow-auto text-xs text-[var(--ea-warning-fg)]">
            {notes.map((note, index) => (
              <li key={index}>
                {note.rowNumber}-р мөр: {note.text}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Хаах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
