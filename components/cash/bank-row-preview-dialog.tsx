"use client";

// Хуулга хадгалахаас ӨМНӨ мөрөөс үүсэх давхар бичилтийн урьдчилсан харагдац
// (docs/dev/arap.md §5l): хүснэгтийн доорх сонгосон мөрийн хэсэг
// (BankRowPreviewStrip) ба олон мөрийн цонх (BankRowPreviewDialog) — хоёулаа
// НЭГ PreviewLinesGrid. Тооцоо нь ЦЭВЭР previewBankRowPostings — сервер
// (lib/cash/import-statement.ts) ижил дүрмээр бичнэ; энд юу ч бичигдэхгүй. ₮.

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
import { Icon } from "@/components/ui/icon";
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

type PreviewProps = {
  rows: ParsedBankStatementRow[];
  context: PreviewContext;
  accountName: (main: string) => string;
};

function usePreview({ rows, context, accountName }: PreviewProps) {
  return useMemo(() => {
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
    const totals = { debit: Math.round(debit * 100) / 100, credit: Math.round(credit * 100) / 100 };
    return { gridRows, notes, totals, balanced: Math.abs(totals.debit - totals.credit) <= 0.01 };
  }, [rows, context, accountName]);
}

function PreviewLinesGrid({
  preview,
  showRowNumber,
  maxHeight,
}: {
  preview: ReturnType<typeof usePreview>;
  showRowNumber: boolean;
  maxHeight: number;
}) {
  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      ...(showRowNumber
        ? [{ headerName: "Мөр", field: "rowNumber" as const, width: 70, cellClass: "font-mono" }]
        : []),
      { headerName: "Баримт", field: "voucher", width: 190 },
      { headerName: "Данс", field: "account", width: 110, cellClass: "font-mono" },
      { headerName: "Дансны нэр", field: "accountName", flex: 1, minWidth: 160 },
      col<GridRow>({ eaType: "readonly-money", headerName: "Дебит", field: "debit", width: 140 }),
      col<GridRow>({ eaType: "readonly-money", headerName: "Кредит", field: "credit", width: 140 }),
    ],
    [showRowNumber]
  );
  const pinnedBottom = useMemo<GridRow[]>(
    () => [
      {
        id: "total",
        rowNumber: null,
        voucher: "Нийт",
        account: "",
        accountName: "",
        debit: preview.totals.debit,
        credit: preview.totals.credit,
      },
    ],
    [preview.totals]
  );
  return (
    <DataGridDynamic<GridRow>
      rowData={preview.gridRows}
      columnDefs={columnDefs}
      getRowId={(params) => params.data.id}
      pinnedBottomRowData={pinnedBottom}
      height={Math.min(maxHeight, 96 + preview.gridRows.length * 34)}
      suppressCellFocus
      wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
    />
  );
}

function PreviewStatus({
  preview,
  showRowNumber,
}: {
  preview: ReturnType<typeof usePreview>;
  showRowNumber: boolean;
}) {
  return (
    <>
      <StatusBadge
        tone={preview.balanced ? "success" : "danger"}
        size="sm"
        icon={preview.balanced ? "success" : "error"}
      >
        {preview.balanced ? "Дебит = Кредит" : "Тэнцээгүй"}
      </StatusBadge>
      {preview.notes.map((note, index) => (
        <StatusBadge key={index} tone="warning" size="sm" icon="warning">
          {showRowNumber ? `${note.rowNumber}-р мөр: ` : ""}
          {note.text}
        </StatusBadge>
      ))}
    </>
  );
}

/**
 * Хүснэгтийн ДООРХ хэсэг — идэвхтэй (сонгосон / курсортой) мөрийн бичилт.
 * Нэхэмжлэх үүсгэх мөрд нэхэмжлэхийн журнал + түүнийг хаах банкны гүйлгээ.
 */
export function BankRowPreviewStrip({
  row,
  context,
  accountName,
  onClose,
}: {
  row: ParsedBankStatementRow;
  context: PreviewContext;
  accountName: (main: string) => string;
  onClose: () => void;
}) {
  const rows = useMemo(() => [row], [row]);
  const preview = usePreview({ rows, context, accountName });
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface-raised)] p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Icon name="journal" size="sm" className="text-[var(--ea-primary)]" />
        <span className="font-semibold text-[var(--ea-text-1)]">
          {row.rowNumber}-р мөрийн бичилт
        </span>
        <span className="min-w-0 max-w-80 truncate text-[var(--ea-text-3)]" title={row.description}>
          {row.description}
        </span>
        <span className="text-[var(--ea-text-4)]">· хадгалахад үүснэ, одоогоор бичигдээгүй</span>
        <PreviewStatus preview={preview} showRowNumber={false} />
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          title="Бичилтийн хэсгийг хаах"
          aria-label="Бичилтийн хэсгийг хаах"
          onClick={onClose}
        >
          <Icon name="close" size="sm" />
        </Button>
      </div>
      <PreviewLinesGrid preview={preview} showRowNumber={false} maxHeight={280} />
    </div>
  );
}

/** Олон мөрийн бичилт — сонгосон мөрүүд, эс бөгөөс бүх мөр. */
export function BankRowPreviewDialog({
  open,
  onOpenChange,
  rows,
  context,
  accountName,
  scopeLabel,
}: PreviewProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** «Сонгосон 3 мөрийг» / «Бүх 19 мөрийг» г.м. */
  scopeLabel: string;
}) {
  const preview = usePreview({ rows, context, accountName });
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
        <PreviewLinesGrid preview={preview} showRowNumber maxHeight={460} />
        <div className="flex max-h-32 flex-wrap items-center gap-2 overflow-auto text-xs">
          <PreviewStatus preview={preview} showRowNumber />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Хаах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
