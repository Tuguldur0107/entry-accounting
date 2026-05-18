"use client";

import { useMemo } from "react";
import {
  deleteVoucher,
  postVoucher,
  unpostVoucher,
} from "@/lib/actions/gl";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import type {
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";

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
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <span
            className="font-mono text-[10px] text-[#ADADAD] select-all"
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
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.debit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="text-[var(--ea-border-strong)]">
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
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => (
          <div className="flex flex-col py-2 leading-[22px] items-end">
            {p.data?.lines.map((l) => {
              const n = Number(l.credit);
              return n !== 0 ? (
                <span key={l.id} className="tabular-nums text-xs font-mono">
                  {fmtMnt(n)}
                </span>
              ) : (
                <span key={l.id} className="text-[var(--ea-border-strong)]">
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
        width: 150,
        sortable: true,
        cellClass: "ag-right-aligned-cell",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (p: ICellRendererParams<VoucherRow>) => {
          const v = p.data;
          if (!v) return null;
          const statusInfo =
            v.status === "posted"
              ? { dot: "#059669", text: "text-[#047857]", label: "Бичигдсэн" }
              : v.status === "reversed"
              ? { dot: "#9A9A91", text: "text-[#6B6B63]", label: "Буцаагдсан" }
              : { dot: "#D97706", text: "text-[#B45309]", label: "Ноорог" };
          return (
            <div className="flex flex-col items-end gap-1.5 py-2">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: statusInfo.dot }}
                />
                <span className={`text-[11px] font-medium ${statusInfo.text}`}>
                  {statusInfo.label}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {v.status === "draft" && (
                  <>
                    <button
                      onClick={() => handleEdit(v.id)}
                      className="h-6 px-2 text-[11px] font-medium text-[#1E3A5F] border border-[#C7D8EE] rounded hover:bg-[#EEF3FF] transition-colors bg-white"
                    >
                      Засах
                    </button>
                    <button
                      onClick={() => handlePost(v.id)}
                      className="h-6 px-2 text-[11px] font-medium text-[#047857] border border-[#BBF7D0] rounded hover:bg-[#ECFDF5] transition-colors bg-white"
                    >
                      Батлах
                    </button>
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="h-6 w-6 flex items-center justify-center text-[#C4C4BC] border border-[#E5E5DE] rounded hover:text-[#B91C1C] hover:border-[#FECACA] hover:bg-[#FFF5F5] transition-colors bg-white text-sm leading-none"
                      title="Устгах"
                    >
                      ×
                    </button>
                  </>
                )}
                {v.status === "posted" && (
                  <button
                    onClick={() => handleUnpost(v.id)}
                    className="h-6 px-2 text-[11px] font-medium text-[#B45309] border border-[#FCD34D] rounded hover:bg-[#FFFBEB] transition-colors bg-white"
                  >
                    Буцаах
                  </button>
                )}
              </div>
            </div>
          );
        },
      },
    ],
    [activeSegIds]
  );

  if (filtered.length === 0) {
    return (
      <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
        Бичилт байхгүй
      </div>
    );
  }

  return (
    <>
      <EaGridDynamic<VoucherRow>
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

      <div
        className="mt-3 px-4 py-2.5 flex items-center justify-end gap-6 text-xs"
        style={{
          background: "var(--ea-bg-2)",
          border: "1px solid var(--ea-border)",
          borderRadius: 6,
        }}
      >
        <span className="text-[#6B6B63] font-medium">Нийт дүн:</span>
        <span className="tabular-nums font-semibold text-[#1A1A19]">
          Дебет {fmtMnt(grandDebit)}
        </span>
        <span className="tabular-nums font-semibold text-[#1A1A19]">
          Кредит {fmtMnt(grandCredit)}
        </span>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              balanced ? "bg-[#059669]" : "bg-[#DC2626]"
            }`}
          />
          <span className={`font-medium ${balanced ? "text-[#047857]" : "text-[#B91C1C]"}`}>
            {balanced ? "Тэнцсэн" : `Зөрүү ${fmtMnt(Math.abs(grandDebit - grandCredit))}`}
          </span>
        </div>
      </div>
    </>
  );
}
