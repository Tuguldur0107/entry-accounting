"use client";

// Гүйлгээний дэлгэрэнгүй (өртөг ба данстай) + Бараа материал ↔ GL тулгалт.
// docs/cost 03-report-specifications §3, §5.
//
// §3.9: GL-д ороогүй мөрийн дансны багана хоосон байж БОЛНО, гэхдээ төлөв
// нь ил байх ёстой. §5.6: гараар бичсэн GL бичилт дэд дэвтрийг өөрчлөхгүй —
// зөрүү болж харагдана, автоматаар нөхөгдөхгүй.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ColGroupDef, ICellRendererParams } from "ag-grid-community";
import { AlertTriangle, ArrowUpRight } from "lucide-react";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  GL_BOUND_LABELS,
  type GlBoundStatus,
  type ReconciliationRow,
  type TransactionDetailRow,
} from "@/lib/costing/detail-types";
import { fmtMnt } from "@/lib/reports/balances";
import { openVoucherPanel } from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

const STATUS_TONES: Record<GlBoundStatus, StatusTone> = {
  "not-valued": "muted",
  pending: "warning",
  posted: "success",
  reversed: "muted",
};

type Tab = "detail" | "reconciliation";

interface Props {
  from: string;
  to: string;
  rows: TransactionDetailRow[];
  reconciliation: ReconciliationRow[];
  pendingCount: number;
  pendingAmount: number;
}

const QTY = {
  width: 100,
  cellClass: "ag-right-aligned-cell font-mono text-xs",
  headerClass: "ag-right-aligned-header",
  valueFormatter: (params: { value: unknown }) =>
    params.value == null
      ? ""
      : Number(params.value).toLocaleString("en-US", {
          maximumFractionDigits: 4,
        }),
} satisfies Partial<ColDef<TransactionDetailRow>>;

export function TransactionDetailReport({
  from,
  to,
  rows,
  reconciliation,
  pendingCount,
  pendingAmount,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("detail");
  const [range, setRange] = useState({ from, to });

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    const params = new URLSearchParams(window.location.search);
    params.set("from", next.from);
    params.set("to", next.to);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }

  const columnDefs = useMemo<
    (ColDef<TransactionDetailRow> | ColGroupDef<TransactionDetailRow>)[]
  >(
    () => [
      {
        headerName: "Хугацаа",
        children: [
          {
            headerName: "Огноо",
            field: "date",
            width: 110,
            pinned: "left",
            cellClass: "font-mono text-xs",
          },
          {
            headerName: "Бичсэн",
            field: "postingDate",
            width: 110,
            cellClass: "font-mono text-xs text-[var(--ea-text-3)]",
            columnGroupShow: "open",
          },
        ],
      },
      {
        headerName: "Эх баримт",
        children: [
          {
            headerName: "Дугаар",
            field: "sourceDocumentNo",
            width: 170,
            pinned: "left",
            cellClass: "font-mono text-xs",
          },
          {
            headerName: "Төрөл",
            field: "sourceType",
            width: 130,
            cellClass: "text-xs",
            columnGroupShow: "open",
          },
        ],
      },
      {
        headerName: "Гүйлгээ",
        children: [
          { headerName: "Төрөл", field: "movementType", width: 140, cellClass: "text-xs" },
        ],
      },
      {
        headerName: "Бараа",
        children: [
          { headerName: "Код", field: "itemCode", width: 130, cellClass: "font-mono text-xs" },
          { headerName: "Нэр", field: "itemName", minWidth: 170, flex: 1 },
          {
            headerName: "Агуулах",
            field: "warehouseLabel",
            width: 150,
            cellClass: "text-xs",
          },
        ],
      },
      {
        headerName: "Тоо хэмжээ",
        children: [
          { headerName: "Орлого", field: "qtyIn", ...QTY },
          { headerName: "Зарлага", field: "qtyOut", ...QTY },
          {
            headerName: "Хэмжих нэгж",
            field: "unit",
            width: 110,
            cellClass: "text-xs",
            columnGroupShow: "open",
          },
        ],
      },
      {
        headerName: "Өртөг",
        children: [
          {
            headerName: "Нэгж өртөг",
            field: "unitCost",
            width: 128,
            cellClass: "ag-right-aligned-cell font-mono text-xs",
            headerClass: "ag-right-aligned-header",
            valueFormatter: (params) =>
              params.value == null
                ? "—"
                : Number(params.value).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4,
                  }),
          },
          {
            headerName: "Дүн",
            field: "amount",
            width: 140,
            cellClass: "ag-right-aligned-cell font-mono",
            headerClass: "ag-right-aligned-header",
            valueFormatter: (params) =>
              params.value == null ? "—" : fmtMnt(Number(params.value)),
          },
          {
            headerName: "Өртгийн арга",
            field: "costMethod",
            width: 190,
            cellClass: "text-xs",
            columnGroupShow: "open",
          },
        ],
      },
      {
        headerName: "Ангилал",
        children: [
          {
            headerName: "Зарлагын төрөл",
            field: "issueType",
            width: 170,
            cellClass: "text-xs",
            valueFormatter: (params) => params.value ?? "—",
          },
          {
            headerName: "Өртгийн бүрэлдэхүүн",
            field: "costComponent",
            width: 180,
            cellClass: "text-xs",
            valueFormatter: (params) => params.value ?? "—",
            columnGroupShow: "open",
          },
        ],
      },
      {
        headerName: "Данс",
        children: [
          {
            headerName: "Дебет",
            colId: "debit",
            width: 210,
            valueGetter: (params) => {
              const row = params.data;
              if (!row?.debitAccountCode) return "—";
              return `${row.debitAccountCode} ${row.debitAccountName ?? ""}`.trim();
            },
            cellClass: "font-mono text-xs",
          },
          {
            headerName: "Кредит",
            colId: "credit",
            width: 210,
            valueGetter: (params) => {
              const row = params.data;
              if (!row?.creditAccountCode) return "—";
              return `${row.creditAccountCode} ${row.creditAccountName ?? ""}`.trim();
            },
            cellClass: "font-mono text-xs",
          },
        ],
      },
      {
        headerName: "GL",
        children: [
          {
            headerName: "Төлөв",
            field: "glStatus",
            width: 150,
            cellRenderer: (params: ICellRendererParams<TransactionDetailRow>) => {
              const status = params.data?.glStatus;
              if (!status) return null;
              return (
                <div className="flex h-full items-center">
                  <StatusBadge tone={STATUS_TONES[status]}>
                    {GL_BOUND_LABELS[status]}
                  </StatusBadge>
                </div>
              );
            },
          },
          {
            headerName: "Журнал",
            colId: "journal",
            width: 120,
            cellRenderer: (params: ICellRendererParams<TransactionDetailRow>) => {
              const row = params.data;
              if (!row?.voucherId) return <span className="text-xs">—</span>;
              return (
                <button
                  type="button"
                  onClick={() =>
                    openVoucherPanel(row.voucherId!, row.sourceDocumentNo)
                  }
                  className="inline-flex items-center gap-1 font-mono text-xs text-[var(--ea-primary)] hover:underline"
                >
                  {row.journalNo}
                  <ArrowUpRight size={11} />
                </button>
              );
            },
          },
        ],
      },
      {
        headerName: "Аудит",
        children: [
          {
            headerName: "Үүсгэсэн",
            field: "createdAt",
            width: 140,
            cellClass: "font-mono text-xs text-[var(--ea-text-3)]",
            columnGroupShow: "open",
          },
        ],
      },
    ],
    []
  );

  // §3.8 — Орлого, Зарлага, Дүнг нийтэлнэ. Нэгж өртгийг НИЙТЛЭХГҮЙ.
  const totals = useMemo(() => {
    let qtyIn = 0;
    let qtyOut = 0;
    let amount = 0;
    for (const row of rows) {
      qtyIn += row.qtyIn ?? 0;
      qtyOut += row.qtyOut ?? 0;
      amount += row.amount ?? 0;
    }
    return { qtyIn, qtyOut, amount };
  }, [rows]);

  const pinnedBottom = useMemo<TransactionDetailRow[]>(
    () => [
      {
        id: "__total__",
        date: "",
        postingDate: null,
        sourceType: "",
        sourceDocumentNo: "Нийт",
        sourceId: null,
        movementId: "",
        movementType: "",
        direction: "neutral",
        itemCode: "",
        itemName: "",
        warehouseLabel: "",
        unit: "",
        qtyIn: totals.qtyIn,
        qtyOut: totals.qtyOut,
        unitCost: null,
        amount: totals.amount,
        costMethod: "",
        costComponent: null,
        issueType: null,
        debitAccountCode: null,
        debitAccountName: null,
        creditAccountCode: null,
        creditAccountName: null,
        glStatus: "posted",
        journalNo: null,
        voucherId: null,
        costEntryId: null,
        createdAt: "",
      },
    ],
    [totals]
  );

  const reconColumns = useMemo<ColDef<ReconciliationRow>[]>(
    () => [
      {
        headerName: "Данс",
        field: "accountNumber",
        width: 140,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Дансны нэр", field: "accountName", minWidth: 200, flex: 1 },
      {
        headerName: "Дэд дэвтэр",
        field: "subledgerAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "GL",
        field: "glAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Зөрүү",
        field: "difference",
        width: 150,
        cellClass: (params) =>
          cn(
            "ag-right-aligned-cell font-mono font-semibold",
            Math.abs(Number(params.value ?? 0)) > 0.005 &&
              "text-[var(--ea-danger)]"
          ),
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Холбоогүй GL мөр",
        field: "unlinkedGlLines",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Холбоогүй дүн",
        field: "unlinkedGlAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const diffCount = reconciliation.filter(
    (row) => Math.abs(row.difference) > 0.005
  ).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Гүйлгээний дэлгэрэнгүй — өртөг ба данс
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Бараа материал, өртөг, GL гурвын гүүр. Үнэлэгдээгүй болон GL-д
            ороогүй хөдөлгөөн ч энд бүрэн харагдана.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={range.from}
            onChange={(event) =>
              applyRange({ ...range, from: event.target.value })
            }
            className="h-8 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]"
          />
          <span className="text-xs text-[var(--ea-text-4)]">—</span>
          <input
            type="date"
            value={range.to}
            onChange={(event) => applyRange({ ...range, to: event.target.value })}
            className="h-8 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-xs text-[var(--ea-text-1)]"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setTab("detail")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "detail"
              ? "bg-[var(--ea-primary)] text-white"
              : "text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
          )}
        >
          Гүйлгээний дэлгэрэнгүй ({rows.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("reconciliation")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            tab === "reconciliation"
              ? "bg-[var(--ea-primary)] text-white"
              : "text-[var(--ea-text-3)] hover:bg-[var(--ea-bg-2)] hover:text-[var(--ea-text-1)]"
          )}
        >
          GL тулгалт
          {diffCount > 0 ? ` · ${diffCount} зөрүү` : ""}
        </button>
      </div>

      {tab === "detail" ? (
        rows.length === 0 ? (
          <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Энэ хугацаанд хөдөлгөөн алга
          </div>
        ) : (
          <DataGridDynamic<TransactionDetailRow>
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height="flex"
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            pinnedBottomRowData={pinnedBottom}
            suppressCellFocus
          />
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {(diffCount > 0 || pendingCount > 0) && (
            <div className="flex items-start gap-2 rounded-md border border-[var(--ea-warning)]/40 bg-[var(--ea-warning)]/8 px-3 py-2 text-xs text-[var(--ea-warning-fg,var(--ea-text-1))]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                {diffCount > 0 && (
                  <p>
                    {diffCount} дансанд зөрүү байна. Зөрүүг автоматаар
                    нөхөхгүй — эх үүсвэрийг нь тодруулна уу (ихэвчлэн дэд
                    дэвтрийн лавлагаагүй, гараар бичсэн GL бичилт).
                  </p>
                )}
                {pendingCount > 0 && (
                  <p>
                    {pendingCount} ноорог өртгийн бичилт GL-д ороогүй байна
                    (нийт {fmtMnt(pendingAmount)}) — эдгээр нь дээрх зөрүүнд
                    ОРООГҮЙ.
                  </p>
                )}
              </div>
            </div>
          )}

          {reconciliation.length === 0 ? (
            <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
              Энэ хугацаанд тулгах бичилт алга
            </div>
          ) : (
            <DataGridDynamic<ReconciliationRow>
              rowData={reconciliation}
              columnDefs={reconColumns}
              getRowId={(params) => params.data.accountNumber}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </div>
      )}
    </div>
  );
}
