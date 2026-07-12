"use client";

import { useMemo, useRef, useState } from "react";
import type { ColDef } from "ag-grid-community";
import { Download, Search } from "lucide-react";

import {
  DataGridDynamic,
  type DataGridHandle,
} from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { fmtMnt } from "@/lib/reports/balances";
import type { CashDetailRow, CashMovementRow } from "@/lib/cash/balances";

interface Props {
  rows: CashMovementRow[];
  detailRows: CashDetailRow[];
  periodStart: string;
  periodEnd: string;
}

function moneyCol<T>(): Partial<ColDef<T>> {
  return {
    cellClass: "ag-right-aligned-cell font-mono tabular-nums",
    headerClass: "ag-right-aligned-header",
    width: 150,
    valueFormatter: (p) => fmtMnt(Number(p.value ?? 0)),
  };
}

const TYPE_LABELS: Record<string, string> = {
  opening: "Эхний үлдэгдэл",
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};

// Per-account cash movement statement for the selected period:
//   Эхний үлдэгдэл + Орлого − Зарлага = Эцсийн үлдэгдэл
// Multi-currency accounts are shown with their currency so totals aren't
// blindly summed across currencies — the footer totals MNT rows only.
export function CashReportView({
  rows,
  detailRows,
  periodStart,
  periodEnd,
}: Props) {
  const detailGridRef = useRef<DataGridHandle>(null);
  const [quickFilter, setQuickFilter] = useState("");

  const movementColumnDefs = useMemo<ColDef<CashMovementRow>[]>(
    () => [
      { headerName: "Данс", field: "accountName", flex: 1, minWidth: 200 },
      { headerName: "Валют", field: "currency", width: 90 },
      { headerName: "Эхний үлдэгдэл", field: "opening", ...moneyCol<CashMovementRow>() },
      {
        headerName: "Орлого",
        field: "receipts",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага",
        field: "payments",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Эцсийн үлдэгдэл",
        field: "closing",
        ...moneyCol<CashMovementRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
    ],
    []
  );

  const detailColumnDefs = useMemo<ColDef<CashDetailRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        pinned: "left",
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Данс",
        field: "accountName",
        minWidth: 190,
        pinned: "left",
      },
      {
        headerName: "Төрөл",
        field: "documentType",
        width: 130,
        valueGetter: (params) =>
          TYPE_LABELS[params.data?.documentType ?? ""] ??
          params.data?.documentType ??
          "",
      },
      {
        headerName: "Баримтын №",
        field: "documentNo",
        minWidth: 170,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Утга", field: "description", minWidth: 220, flex: 1 },
      {
        headerName: "Харилцагч",
        field: "counterparty",
        minWidth: 160,
      },
      {
        headerName: "Харьцсан GL",
        field: "counterAccountNumber",
        minWidth: 150,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "CF ангилал",
        field: "cashFlowCode",
        width: 120,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Валют", field: "currency", width: 92 },
      {
        headerName: "Ханш",
        field: "exchangeRate",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono tabular-nums",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => {
          const value = Number(params.value ?? 0);
          return value > 0 ? fmtMnt(value) : "";
        },
      },
      {
        headerName: "Орлого",
        field: "receipt",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-success-fg)]",
      },
      {
        headerName: "Зарлага",
        field: "payment",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums text-[var(--ea-danger-fg)]",
      },
      {
        headerName: "Үлдэгдэл",
        field: "runningBalance",
        ...moneyCol<CashDetailRow>(),
        cellClass: "ag-right-aligned-cell font-mono tabular-nums font-semibold",
      },
      {
        headerName: "Орлого MNT",
        field: "baseReceipt",
        ...moneyCol<CashDetailRow>(),
      },
      {
        headerName: "Зарлага MNT",
        field: "basePayment",
        ...moneyCol<CashDetailRow>(),
      },
      {
        headerName: "Журналын баримт",
        field: "voucherId",
        minWidth: 220,
        cellClass: "font-mono text-xs",
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

  const detailTotals = useMemo(
    () => {
      const nativeMntRows = detailRows.filter((row) => row.currency === "MNT");
      const nativeMnt = nativeMntRows.reduce(
        (acc, row) => ({
          receipt: acc.receipt + row.receipt,
          payment: acc.payment + row.payment,
        }),
        { receipt: 0, payment: 0 }
      );
      const baseMnt = detailRows.reduce(
        (acc, row) => ({
          baseReceipt: acc.baseReceipt + row.baseReceipt,
          basePayment: acc.basePayment + row.basePayment,
        }),
        { baseReceipt: 0, basePayment: 0 }
      );
      return { ...nativeMnt, ...baseMnt };
    },
    [detailRows]
  );

  const detailPinnedBottom = useMemo<CashDetailRow[]>(
    () => [
      {
        id: "__detail_total__",
        accountId: "__total__",
        accountName: "Нийт (MNT)",
        accountType: "",
        bankName: null,
        accountNumber: null,
        currency: "",
        date: "",
        documentNo: "",
        documentType: "",
        counterparty: null,
        counterAccountNumber: null,
        cashFlowCode: null,
        description: "",
        receipt: detailTotals.receipt,
        payment: detailTotals.payment,
        baseReceipt: detailTotals.baseReceipt,
        basePayment: detailTotals.basePayment,
        exchangeRate: 0,
        runningBalance: 0,
        status: "",
        voucherId: null,
      },
    ],
    [detailTotals]
  );

  function exportDetails() {
    detailGridRef.current?.api?.exportDataAsCsv({
      fileName: `cash-detail-${periodStart}-${periodEnd}.csv`,
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-5">
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
          columnDefs={movementColumnDefs}
          getRowId={(p) => p.data.accountId}
          pinnedBottomRowData={pinnedBottom}
          height={Math.min(600, 100 + rows.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <div className="flex flex-col gap-3 border-t border-[var(--ea-border)] pt-4">
        <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Мөнгөн хөрөнгийн дэлгэрэнгүй
            </h2>
            <p className="mt-1 text-xs text-[var(--ea-text-3)]">
              Эхний үлдэгдэл, баримтын мөр бүрийн орлого/зарлага, ханш, MNT дүн,
              гүйлгээний дараах үлдэгдэл
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <label className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--ea-text-4)]" />
              <span className="sr-only">Дэлгэрэнгүй тайлангаас хайх</span>
              <input
                value={quickFilter}
                onChange={(event) => setQuickFilter(event.target.value)}
                placeholder="Хайх..."
                className="h-9 w-full rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] pl-8 pr-3 text-xs text-[var(--ea-text-1)] focus:border-[var(--ea-primary)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)]"
              />
            </label>
            <Button type="button" variant="outline" onClick={exportDetails}>
              <Download />
              CSV
            </Button>
          </div>
        </div>

        {detailRows.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Тайлангийн мөр байхгүй
          </div>
        ) : (
          <DataGridDynamic<CashDetailRow>
            ref={detailGridRef}
            rowData={detailRows}
            columnDefs={detailColumnDefs}
            getRowId={(p) => p.data.id}
            pinnedBottomRowData={detailPinnedBottom}
            quickFilterText={quickFilter}
            height={Math.min(720, 116 + detailRows.length * 38)}
            pagination={detailRows.length > 50}
            paginationPageSize={50}
            paginationPageSizeSelector={false}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
          />
        )}
      </div>
    </section>
  );
}
