"use client";

import { useMemo } from "react";
import {
  deleteVoucher,
  postVoucher,
  unpostVoucher,
} from "@/lib/actions/gl";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import type {
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import { Pencil, Check, Trash2, Undo2 } from "lucide-react";

const PAGE_SIZE = 15;

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  initialStart?: string;
  initialEnd?: string;
}

type VoucherRow = JournalVoucherWithLines;

const LINE_HEIGHT = 22;
const ROW_PADDING = 16;

// Date range filter + "+ Журнал бичих" товч нь dashboard layout-д
// (components/layout/header-journal-search.tsx, new-journal-button.tsx)
// байх тул энэ компонент нь өөрөө toolbar render хийхгүй —
// зөвхөн `initialStart`/`initialEnd` URL search-param-аас filter хийнэ.
// URL-д огноо байхгүй үед HeaderJournalSearch-той ижил сарын default
// (1-нээс сүүлийн өдөр) хэрэглэнэ — header / жагсаалт зөрөхгүй.
// `accounts` prop одоогоор ашиглагдахгүй (page-level shape хадгална).
function defaultMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function JournalList({ vouchers, activeSegIds, initialStart, initialEnd }: Props) {
  const defaults = defaultMonthRange();
  const appliedStart = initialStart ?? defaults.start;
  const appliedEnd = initialEnd ?? defaults.end;
  async function handleDelete(id: string) {
    if (!confirm("Энэ бичилтийг устгах уу?")) return;
    try {
      await deleteVoucher(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Устгах үед алдаа гарлаа");
    }
  }

  async function handlePost(id: string) {
    if (!confirm("Энэ ноорогийг батлах уу?")) return;
    try {
      await postVoucher(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Батлах үед алдаа гарлаа");
    }
  }

  async function handleUnpost(id: string) {
    if (!confirm("Энэ батлагдсан журналыг ноорог болгож буцаах уу?")) return;
    try {
      await unpostVoucher(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Буцаах үед алдаа гарлаа");
    }
  }

  function handleEdit(id: string) {
    window.open(
      `/gl/journal/${id}/edit`,
      "_blank",
      "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
    );
  }

  const filtered = useMemo(
    () =>
      vouchers.filter((v) => {
        if (appliedStart && v.date < appliedStart) return false;
        if (appliedEnd && v.date > appliedEnd) return false;
        return true;
      }),
    [vouchers, appliedStart, appliedEnd]
  );

  const grandDebit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.debit), 0),
    0
  );
  const grandCredit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.credit), 0),
    0
  );
  const balanced = Math.abs(grandDebit - grandCredit) <= 0.01;

  const columnDefs = useMemo<ColDef<VoucherRow>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 110,
        cellClass: "font-mono text-xs",
        sortable: true,
      },
      {
        headerName: "ID",
        field: "id",
        width: 80,
        valueGetter: (p) => p.data?.id.slice(0, 8) ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <span
            className="font-mono text-[10px] text-[var(--ea-text-4)] select-all"
            title={p.data?.id}
          >
            {p.data?.id?.slice(0, 8) ?? ""}
          </span>
        ),
        sortable: true,
      },
      {
        headerName: "Утга",
        field: "description",
        flex: 1,
        minWidth: 180,
        sortable: true,
        autoHeight: true,
        cellClass: "text-xs font-medium",
      },
      {
        headerName: "Данс",
        colId: "lines.account",
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => fmtAccountDisplay(line.accountNumber, activeSegIds))
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px]">
            {p.data?.lines.map((l) => (
              <span key={l.id} className="font-mono text-xs text-[var(--ea-primary-500)] tracking-tight">
                {fmtAccountDisplay(l.accountNumber, activeSegIds)}
              </span>
            ))}
          </div>
        ),
      },
      {
        headerName: "Дебет",
        colId: "lines.debit",
        width: 130,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => Number(line.debit))
            .filter((amount) => amount !== 0)
            .map(fmtMnt)
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.debit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="tabular-nums text-xs font-mono text-[var(--ea-border-strong)]">
                  —
                </span>
              );
            })}
          </div>
        ),
      },
      {
        headerName: "Кредит",
        colId: "lines.credit",
        width: 130,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines
            .map((line) => Number(line.credit))
            .filter((amount) => amount !== 0)
            .map(fmtMnt)
            .join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.credit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="tabular-nums text-xs font-mono text-[var(--ea-border-strong)]">
                  —
                </span>
              );
            })}
          </div>
        ),
      },
      {
        headerName: "Тайлбар",
        colId: "lines.description",
        width: 160,
        sortable: false,
        valueGetter: (p) =>
          p.data?.lines.map((line) => line.description).join(" · ") ?? "",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px]">
            {p.data?.lines.map((l) => (
              <span key={l.id} className="text-xs text-[var(--ea-text-3)] truncate">
                {l.description}
              </span>
            ))}
          </div>
        ),
      },
      {
        headerName: "Статус",
        field: "status",
        width: 120,
        sortable: true,
        valueGetter: (p) => {
          if (p.data?.status === "posted") return "Бичигдсэн";
          if (p.data?.status === "reversed") return "Буцаагдсан";
          return "Ноорог";
        },
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => {
          const v = p.data;
          if (!v) return null;
          const statusInfo =
            v.status === "posted"
              ? { dot: "var(--ea-success)", text: "text-[var(--ea-success-fg)]", label: "Бичигдсэн" }
              : v.status === "reversed"
              ? { dot: "var(--ea-text-4)", text: "text-[var(--ea-text-3)]", label: "Буцаагдсан" }
              : { dot: "var(--ea-warning)", text: "text-[var(--ea-warning-fg)]", label: "Ноорог" };
          return (
            <div className="flex items-center justify-end gap-1.5 h-full">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: statusInfo.dot }}
              />
              <span className={`text-[11px] font-medium whitespace-nowrap ${statusInfo.text}`}>
                {statusInfo.label}
              </span>
            </div>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 120,
        sortable: false,
        filter: false,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => {
          const v = p.data;
          if (!v) return null;
          return (
            <div className="flex items-center justify-end gap-1 h-full">
              {v.status === "draft" && (
                <>
                  <button
                    onClick={() => handleEdit(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--primary"
                    title="Журнал засах"
                    aria-label="Журнал засах"
                  >
                    <Pencil />
                  </button>
                  <button
                    onClick={() => handlePost(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Батлах"
                    aria-label="Батлах"
                  >
                    <Check />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Устгах"
                    aria-label="Устгах"
                  >
                    <Trash2 />
                  </button>
                </>
              )}
              {v.status === "posted" && (
                <button
                  onClick={() => handleUnpost(v.id)}
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Ноорог болгож буцаах"
                  aria-label="Ноорог болгож буцаах"
                >
                  <Undo2 />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [activeSegIds]
  );

  if (filtered.length === 0) {
    return (
      <div className="bg-white border border-[var(--ea-border)] rounded-md py-16 text-center text-[var(--ea-text-4)] text-sm">
        Бичилт байхгүй
      </div>
    );
  }

  return (
    <>
      <DataGridDynamic<VoucherRow>
        rowData={filtered}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        getRowHeight={(p) =>
          Math.max(48, (p.data?.lines.length ?? 1) * LINE_HEIGHT + ROW_PADDING)
        }
        pagination
        paginationPageSize={PAGE_SIZE}
        paginationPageSizeSelector={false}
        height={Math.min(720, 48 + filtered.length * 48 + 56)}
        wrapperClassName="rounded-lg border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
        cellSelection={false}
      />

      {/* Footer — баганатай харалдаа. Grid template AG-Grid-н column width-тэй тааруулсан */}
      <div
        className="mt-3 text-xs"
        style={{
          background: "var(--ea-bg-2)",
          border: "1px solid var(--ea-border)",
          borderRadius: 6,
          display: "grid",
          gridTemplateColumns:
            "110px 80px minmax(180px,1fr) minmax(160px,1fr) 130px 130px 160px 120px 120px",
          alignItems: "center",
          padding: "10px 0",
        }}
      >
        {/* Огноо + ID — "Нийт дүн" label spanning */}
        <div className="pl-3 col-span-2 text-[var(--ea-text-3)] font-medium" style={{ gridColumn: "1 / span 2" }}>
          Нийт дүн
        </div>
        {/* Утга, Данс — empty */}
        <div />
        <div />
        {/* Дебет */}
        <div className="text-right pr-3 tabular-nums font-mono font-semibold text-[var(--ea-text-1)]">
          {fmtMnt(grandDebit)}
        </div>
        {/* Кредит */}
        <div className="text-right pr-3 tabular-nums font-mono font-semibold text-[var(--ea-text-1)]">
          {fmtMnt(grandCredit)}
        </div>
        {/* Тайлбар — empty */}
        <div />
        {/* Статус */}
        <div className="flex items-center justify-end gap-1.5 pr-3">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              balanced ? "bg-[var(--ea-success)]" : "bg-[var(--ea-danger)]"
            }`}
          />
          <span
            className={`font-medium ${
              balanced ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-danger-fg)]"
            }`}
          >
            {balanced ? "Тэнцсэн" : `Зөрүү ${fmtMnt(Math.abs(grandDebit - grandCredit))}`}
          </span>
        </div>
        {/* Үйлдэл — empty */}
        <div />
      </div>
    </>
  );
}
