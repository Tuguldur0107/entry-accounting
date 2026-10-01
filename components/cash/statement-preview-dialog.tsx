"use client";

// Банкны хуулгыг батлахаас ӨМНӨ бичилтийг харах цонх (docs/dev/arap.md §5l).
// Өгөгдөл нь /api/cash/statements/preview — saveBankStatement-ийн ЯГ ТЭР кодыг
// транзакц дотор ажиллуулаад буцаадаг тул энд харсан бичилт = батлах бичилт.
// Энд тооцоо хийхгүй (lib/cash/statement-preview.ts бүлэглэнэ), зөвхөн харуулна.

import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChips, PageTabs } from "@/components/ui/tabs";
import {
  PREVIEW_VOUCHER_LABELS,
  type BankStatementPreview,
  type PreviewAccountTotal,
  type PreviewVoucherKind,
} from "@/lib/cash/statement-preview";
import { col } from "@/lib/grid/columnTypes";
import { fmtMnt } from "@/lib/reports/balances";

type View = "accounts" | "rows";
type RowScope = "multi" | "all";

type TotalRow = PreviewAccountTotal & { id: string };

type LineRow = {
  id: string;
  rowNumber: number;
  /** Журналын эхний мөрөнд л — дараагийн мөрүүд хоосон (бүлэг мэт харагдана). */
  voucherLabel: string;
  /** Бүтэн 10 хэсэгт код — tooltip-д. */
  accountNumber: string;
  mainAccount: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
  multi: boolean;
  firstOfRow: boolean;
};

export function StatementPreviewDialog({
  preview,
  isPending,
  onConfirm,
  onClose,
}: {
  preview: BankStatementPreview;
  isPending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(preview.multiVoucherRows > 0 ? "rows" : "accounts");
  const [scope, setScope] = useState<RowScope>(preview.multiVoucherRows > 0 ? "multi" : "all");
  const [query, setQuery] = useState("");

  const totalRows = useMemo<TotalRow[]>(
    () => preview.totals.map((entry) => ({ ...entry, id: entry.mainAccount })),
    [preview]
  );
  const pinnedTotal = useMemo<TotalRow[]>(
    () => [
      {
        id: "total",
        mainAccount: "",
        accountName: "НИЙТ",
        debit: preview.debitTotal,
        credit: preview.creditTotal,
        net: Math.round((preview.debitTotal - preview.creditTotal) * 100) / 100,
      },
    ],
    [preview]
  );

  const lineRows = useMemo<LineRow[]>(() => {
    const vouchersPerRow = new Map<number, number>();
    for (const voucher of preview.vouchers)
      vouchersPerRow.set(voucher.rowNumber, (vouchersPerRow.get(voucher.rowNumber) ?? 0) + 1);
    return preview.vouchers.flatMap((voucher, voucherIndex) =>
      voucher.lines.map((line, lineIndex) => {
        return {
          id: `${voucherIndex}-${lineIndex}`,
          rowNumber: voucher.rowNumber,
          voucherLabel:
            lineIndex === 0
              ? `${PREVIEW_VOUCHER_LABELS[voucher.kind]}${voucher.reference ? ` · ${voucher.reference}` : ""}`
              : "",
          accountNumber: line.accountNumber,
          mainAccount: line.mainAccount,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
          multi: (vouchersPerRow.get(voucher.rowNumber) ?? 0) > 1,
          firstOfRow: lineIndex === 0,
        };
      })
    );
  }, [preview]);

  const visibleLines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lineRows.filter(
      (line) =>
        (scope === "all" || line.multi) &&
        (!needle ||
          String(line.rowNumber) === needle ||
          line.accountNumber.includes(needle) ||
          line.mainAccount.includes(needle) ||
          line.accountName.toLowerCase().includes(needle) ||
          line.description.toLowerCase().includes(needle))
    );
  }, [lineRows, scope, query]);

  const totalColumns = useMemo<ColDef<TotalRow>[]>(
    () => [
      col<TotalRow>({ eaType: "readonly-text", headerName: "Данс", field: "mainAccount", width: 120, cellClass: "font-mono" }),
      col<TotalRow>({ eaType: "readonly-text", headerName: "Нэр", field: "accountName", flex: 1, minWidth: 200 }),
      col<TotalRow>({ eaType: "readonly-money", headerName: "Дебет", field: "debit", width: 150 }),
      col<TotalRow>({ eaType: "readonly-money", headerName: "Кредит", field: "credit", width: 150 }),
      col<TotalRow>({
        eaType: "readonly-money",
        headerName: "Цэвэр (Дт − Кт)",
        field: "net",
        width: 160,
        headerTooltip: "Нэхэмжлэх үүсэж тэр даруй хаагдвал хяналтын данс 0 болно",
      }),
    ],
    []
  );

  const lineColumns = useMemo<ColDef<LineRow>[]>(
    () => [
      col<LineRow>({
        eaType: "readonly-text",
        headerName: "Мөр",
        field: "rowNumber",
        width: 64,
        valueFormatter: (params) => (params.data?.firstOfRow ? String(params.value) : ""),
        cellClass: "font-mono",
      }),
      col<LineRow>({
        eaType: "readonly-text",
        headerName: "Журнал",
        field: "voucherLabel",
        width: 300,
        cellClass: "text-xs font-medium text-[var(--ea-primary)]",
        tooltipField: "voucherLabel",
      }),
      col<LineRow>({
        eaType: "readonly-text",
        headerName: "Данс",
        field: "mainAccount",
        width: 120,
        cellClass: "font-mono",
        // Бүтэн сегмент код (компани, модуль, мөнгөн гүйлгээний код…) — 46 тэмдэгт тул tooltip-д.
        tooltipField: "accountNumber",
      }),
      col<LineRow>({ eaType: "readonly-text", headerName: "Нэр", field: "accountName", flex: 1, minWidth: 180, tooltipField: "accountName" }),
      col<LineRow>({ eaType: "readonly-money", headerName: "Дебет", field: "debit", width: 125 }),
      col<LineRow>({ eaType: "readonly-money", headerName: "Кредит", field: "credit", width: 125 }),
    ],
    []
  );

  const kindBadges = (Object.keys(preview.counts) as PreviewVoucherKind[]).filter(
    (kind) => preview.counts[kind] > 0
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Бичилтийг шалгах</DialogTitle>
          <DialogDescription>
            Батлахаас өмнөх харагдац — одоогоор юу ч бичигдээгүй. {preview.rowCount} мөр →{" "}
            {preview.vouchers.length} журнал.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5">
          {preview.balanced ? (
            <StatusBadge tone="success" size="sm" icon="success">
              Тэнцсэн · {fmtMnt(preview.debitTotal)}
            </StatusBadge>
          ) : (
            <StatusBadge tone="danger" size="sm" icon="error">
              Тэнцээгүй · Дт {fmtMnt(preview.debitTotal)} / Кт {fmtMnt(preview.creditTotal)}
            </StatusBadge>
          )}
          {preview.multiVoucherRows > 0 && (
            <StatusBadge tone="warning" size="sm" icon="warning">
              Давхар бичилттэй {preview.multiVoucherRows} мөр
            </StatusBadge>
          )}
          {kindBadges.map((kind) => (
            <StatusBadge key={kind} tone="muted" size="sm">
              {PREVIEW_VOUCHER_LABELS[kind]} {preview.counts[kind]}
            </StatusBadge>
          ))}
        </div>

        <PageTabs
          tabs={[
            { value: "rows", label: `Мөрөөр (${preview.vouchers.length} журнал)` },
            { value: "accounts", label: `Дансаар (${preview.totals.length})` },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Бичилтийн харагдац"
          trailing={
            view === "rows" ? (
              <FilterChips
                value={scope}
                onChange={setScope}
                options={[
                  { value: "multi", label: "Давхар бичилттэй", count: preview.multiVoucherRows },
                  { value: "all", label: "Бүгд", count: preview.rowCount },
                ]}
              />
            ) : null
          }
        />

        {view === "rows" ? (
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Мөрийн дугаар, данс, нэрээр хайх"
              className="w-full sm:w-72"
            />
            {visibleLines.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--ea-border)] px-3 py-8 text-center text-sm text-[var(--ea-text-3)]">
                {scope === "multi" ? "Давхар бичилттэй мөр алга" : "Хайлтад таарах бичилт алга"}
              </p>
            ) : (
              <DataGridDynamic<LineRow>
                rowData={visibleLines}
                columnDefs={lineColumns}
                getRowId={(params) => params.data.id}
                height={Math.min(460, 56 + visibleLines.length * 38)}
                wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                suppressCellFocus
              />
            )}
          </>
        ) : (
          <DataGridDynamic<TotalRow>
            rowData={totalRows}
            columnDefs={totalColumns}
            getRowId={(params) => params.data.id}
            pinnedBottomRowData={pinnedTotal}
            height={Math.min(460, 54 + (totalRows.length + 1) * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            <Icon name="undo" />
            Буцах
          </Button>
          <Button onClick={onConfirm} disabled={isPending || !preview.balanced}>
            <Icon name="approve" />
            {isPending ? "Батлаж байна…" : "Батлах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
