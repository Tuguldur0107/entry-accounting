"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";

const PAGE_SIZE = 20;

const fmt = (n: number) =>
  n.toLocaleString("mn-MN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
}

type Row = {
  number: string;
  name: string;
  openDebit: number;
  openCredit: number;
  periodDebit: number;
  periodCredit: number;
  closeDebit: number;
  closeCredit: number;
};

const columnHelper = createColumnHelper<Row>();

function SortIndicator({ dir }: { dir: false | "asc" | "desc" }) {
  if (dir === "asc") return <span className="ml-1 text-[#1E3A5F]">▲</span>;
  if (dir === "desc") return <span className="ml-1 text-[#1E3A5F]">▼</span>;
  return <span className="ml-1 text-[#D4D4CB]">▲▼</span>;
}

export function ReportsView({ vouchers, accounts, activeSegIds }: Props) {
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonth);
  const [appliedTo, setAppliedTo] = useState(today);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "number", desc: false },
  ]);

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.number, a.name])),
    [accounts]
  );

  function resolveAccountName(code: string): string {
    if (accountMap[code]) return accountMap[code];
    const parts = code.split(".");
    if (parts.length > 1) {
      const s3Pos = activeSegIds.indexOf(3);
      if (s3Pos !== -1 && parts.length === activeSegIds.length) {
        const name = accountMap[parts[s3Pos] ?? ""];
        if (name) return name;
      }
      for (const part of parts) {
        if (accountMap[part]) return accountMap[part];
      }
    }
    return "";
  }

  function handleSearch() {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  }

  const rows = useMemo<Row[]>(() => {
    const map: Record<
      string,
      { openD: number; openC: number; periodD: number; periodC: number }
    > = {};

    const ensure = (n: string) => {
      if (!map[n]) map[n] = { openD: 0, openC: 0, periodD: 0, periodC: 0 };
    };

    vouchers.forEach((v) => {
      const inPeriod = v.date >= appliedFrom && v.date <= appliedTo;
      const beforePeriod = v.date < appliedFrom;

      v.lines.forEach((l) => {
        const d = Number(l.debit);
        const c = Number(l.credit);
        ensure(l.accountNumber);

        if (beforePeriod) {
          map[l.accountNumber].openD += d;
          map[l.accountNumber].openC += c;
        } else if (inPeriod) {
          map[l.accountNumber].periodD += d;
          map[l.accountNumber].periodC += c;
        }
      });
    });

    return Object.entries(map).map(([number, t]) => {
      const openNet = t.openD - t.openC;
      const openDebit = openNet > 0 ? openNet : 0;
      const openCredit = openNet < 0 ? -openNet : 0;

      const closeNet = openNet + t.periodD - t.periodC;
      const closeDebit = closeNet > 0 ? closeNet : 0;
      const closeCredit = closeNet < 0 ? -closeNet : 0;

      return {
        number,
        name: resolveAccountName(number),
        openDebit,
        openCredit,
        periodDebit: t.periodD,
        periodCredit: t.periodC,
        closeDebit,
        closeCredit,
      };
    });
  }, [vouchers, appliedFrom, appliedTo, accountMap]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("number", {
        id: "number",
        sortingFn: (a, b) => a.original.number.localeCompare(b.original.number),
      }),
      columnHelper.accessor("openDebit", { id: "openDebit" }),
      columnHelper.accessor("openCredit", { id: "openCredit" }),
      columnHelper.accessor("periodDebit", { id: "periodDebit" }),
      columnHelper.accessor("periodCredit", { id: "periodCredit" }),
      columnHelper.accessor("closeDebit", { id: "closeDebit" }),
      columnHelper.accessor("closeCredit", { id: "closeCredit" }),
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const sortedRows = table.getRowModel().rows;
  const totalPages = table.getPageCount() || 1;
  const page = table.getState().pagination.pageIndex + 1;

  const periodVouchers = vouchers.filter(
    (v) => v.date >= appliedFrom && v.date <= appliedTo
  );
  const totalPeriodD = rows.reduce((s, r) => s + r.periodDebit, 0);
  const totalPeriodC = rows.reduce((s, r) => s + r.periodCredit, 0);
  const totalOpenD = rows.reduce((s, r) => s + r.openDebit, 0);
  const totalOpenC = rows.reduce((s, r) => s + r.openCredit, 0);
  const totalCloseD = rows.reduce((s, r) => s + r.closeDebit, 0);
  const totalCloseC = rows.reduce((s, r) => s + r.closeCredit, 0);

  function toggleSort(id: string) {
    table.getColumn(id)?.toggleSorting();
  }
  function sortDir(id: string): false | "asc" | "desc" {
    return table.getColumn(id)?.getIsSorted() ?? false;
  }

  const sortableThClass =
    "cursor-pointer select-none hover:bg-[#ECECE5] transition-colors";

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#333]">Тайлан</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Эхлэх огноо</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Дуусах огноо</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F]"
          />
        </div>
        <button
          onClick={handleSearch}
          className="h-8 px-4 text-sm font-medium bg-[#1E3A5F] text-white rounded-md hover:bg-[#15294A] transition-colors"
        >
          Хайх
        </button>
        <span className="ml-auto text-xs text-[#9A9A91]">{periodVouchers.length} бичилт · {rows.length} данс</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE] hover:bg-[#F4F4EE]">
              <TableHead
                className={`px-4 py-2.5 text-left ${sortableThClass}`}
                rowSpan={2}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("number")}
              >
                Данс
                <SortIndicator dir={sortDir("number")} />
              </TableHead>
              <TableHead
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Эхний үлдэгдэл
              </TableHead>
              <TableHead
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Гүйлгээ
              </TableHead>
              <TableHead
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
              >
                Эцсийн үлдэгдэл
              </TableHead>
            </TableRow>
            <TableRow className="bg-[#F4F4EE] text-xs text-[#666] font-medium hover:bg-[#F4F4EE]">
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("openDebit")}
              >
                Дебет
                <SortIndicator dir={sortDir("openDebit")} />
              </TableHead>
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("openCredit")}
              >
                Кредит
                <SortIndicator dir={sortDir("openCredit")} />
              </TableHead>
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("periodDebit")}
              >
                Дебет
                <SortIndicator dir={sortDir("periodDebit")} />
              </TableHead>
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("periodCredit")}
              >
                Кредит
                <SortIndicator dir={sortDir("periodCredit")} />
              </TableHead>
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                style={{ borderRight: "1px solid var(--ea-border)" }}
                onClick={() => toggleSort("closeDebit")}
              >
                Дебет
                <SortIndicator dir={sortDir("closeDebit")} />
              </TableHead>
              <TableHead
                className={`px-4 py-2 text-right w-[120px] ${sortableThClass}`}
                onClick={() => toggleSort("closeCredit")}
              >
                Кредит
                <SortIndicator dir={sortDir("closeCredit")} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="px-4 py-10 text-center text-[#aaa]">
                  Өгөгдөл байхгүй
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((r) => {
                const row = r.original;
                return (
                  <TableRow
                    key={row.number}
                    className="border-t border-[#E8E8E0] hover:bg-[#fafafa]"
                  >
                    <TableCell
                      className="px-4 py-2.5"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      <span className="font-mono text-[#555]">{row.number}</span>
                      {row.name && (
                        <span className="text-[#777] ml-2">— {row.name}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {row.openDebit > 0 ? fmt(row.openDebit) : ""}
                    </TableCell>
                    <TableCell
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {row.openCredit > 0 ? fmt(row.openCredit) : ""}
                    </TableCell>
                    <TableCell
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {row.periodDebit > 0 ? fmt(row.periodDebit) : ""}
                    </TableCell>
                    <TableCell
                      className="px-4 py-2.5 text-right tabular-nums"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {row.periodCredit > 0 ? fmt(row.periodCredit) : ""}
                    </TableCell>
                    <TableCell
                      className="px-4 py-2.5 text-right tabular-nums font-medium"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {row.closeDebit > 0 ? fmt(row.closeDebit) : ""}
                    </TableCell>
                    <TableCell className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {row.closeCredit > 0 ? fmt(row.closeCredit) : ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          <TableFooter style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
            <TableRow style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
              <TableCell
                className="px-4 py-2.5 text-sm font-semibold text-[#1E3A5F]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Нийт дүн
              </TableCell>
              <TableCell
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalOpenD)}
              </TableCell>
              <TableCell
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalOpenC)}
              </TableCell>
              <TableCell
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalPeriodD)}
              </TableCell>
              <TableCell
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalPeriodC)}
              </TableCell>
              <TableCell
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalCloseD)}
              </TableCell>
              <TableCell className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]">
                {fmt(totalCloseC)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-1 mt-3">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ‹
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => table.setPageIndex(p - 1)}
              className={`h-7 min-w-[28px] px-1.5 flex items-center justify-center rounded border text-sm transition-colors ${
                p === page
                  ? "bg-[#1E3A5F] text-white border-[#1E3A5F] font-medium"
                  : "border-[#E5E5DE] text-[#6B6B63] hover:bg-[#F4F4EE]"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ›
          </button>
        </div>
      )}
    </>
  );
}
