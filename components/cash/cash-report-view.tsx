"use client";

import { useMemo } from "react";
import type { ColDef } from "ag-grid-community";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import type { CashMovementRow } from "@/lib/cash/balances";

interface Props {
  rows: CashMovementRow[];
  periodStart: string;
  periodEnd: string;
}

const MONEY: Partial<ColDef<CashMovementRow>> = {
  cellClass: "ag-right-aligned-cell font-mono tabular-nums",
  headerClass: "ag-right-aligned-header",
  width: 150,
  valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
};

// Per-account cash movement statement for the selected period:
//   Эхний үлдэгдэл + Орлого − Зарлага = Эцсийн үлдэгдэл
// Multi-currency accounts are shown with their currency so totals aren't
// blindly summed across currencies — the footer totals MNT rows only.
export function CashReportView({ rows, periodStart, periodEnd }: Props) {
  const columnDefs = useMemo<ColDef<CashMovementRow>[]>(
    () => [
      { headerName: "Данс", field: "accountName", flex: 1, minWidth: 200 },
      { headerName: "Валют", field: "currency", width: 90 },
      { headerName: "Эхний үлдэгдэл", field: "opening", ...MONEY },
      {
        headerName: "Орлого",
        field: "receipts",
        ...MONEY,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага",
        field: "payments",
        ...MONEY,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Эцсийн үлдэгдэл",
        field: "closing",
        ...MONEY,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
    ],
    []
  );

  // Pinned total row — sum per currency would be ideal, but for a single-
  // currency ledger a straight sum is the common case; we sum MNT rows and
  // leave the label noting the currency scope.
  const mntRows = rows.filter((r) => r.currency === "MNT");
  const totals = mntRows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      receipts: acc.receipts + r.receipts,
      payments: acc.payments + r.payments,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, receipts: 0, payments: 0, closing: 0 }
  );

  const pinnedBottom = useMemo<CashMovementRow[]>(
    () => [
      {
        accountId: "__total__",
        accountName: "Нийт (MNT)",
        currency: "",
        opening: totals.opening,
        receipts: totals.receipts,
        payments: totals.payments,
        closing: totals.closing,
      },
    ],
    [totals]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
          Мөнгөн хөрөнгийн тайлан
        </h1>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          {periodStart} – {periodEnd} · Данс тус бүрийн орлого, зарлага, үлдэгдэл
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Касс, банкны данс үүсгээгүй байна
        </div>
      ) : (
        <DataGridDynamic<CashMovementRow>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={(p) => p.data.accountId}
          pinnedBottomRowData={pinnedBottom}
          height={Math.min(600, 100 + rows.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </section>
  );
}
