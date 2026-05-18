"use client";

import React, { useState, useMemo } from "react";
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
import { deleteVoucher, postVoucher, unpostVoucher } from "@/lib/actions/gl";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { useConfirm } from "@/components/ui/confirm-dialog";

const PAGE_SIZE = 15;

const fmt = (n: number | string) =>
  Number(n || 0).toLocaleString("mn-MN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  initialStart?: string;
  initialEnd?: string;
}

const columnHelper = createColumnHelper<JournalVoucherWithLines>();

function SortIndicator({ dir }: { dir: false | "asc" | "desc" }) {
  if (dir === "asc") return <span className="ml-1 text-[#1E3A5F]">▲</span>;
  if (dir === "desc") return <span className="ml-1 text-[#1E3A5F]">▼</span>;
  return <span className="ml-1 text-[#D4D4CB] opacity-60">▲▼</span>;
}

export function JournalList({ vouchers, accounts, activeSegIds, initialStart, initialEnd }: Props) {
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const defaultEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const appliedStart = initialStart ?? defaultStart;
  const appliedEnd = initialEnd ?? defaultEnd;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "date", desc: true },
  ]);
  const { confirm, dialog: confirmDialog } = useConfirm();

  function AccountCell({ code }: { code: string }) {
    const parts = code.split(".");
    const display =
      parts.length === 10
        ? activeSegIds.map((id) => parts[id - 1]).join(".")
        : code;
    return (
      <span className="font-mono text-xs text-[#1E3A5F] tracking-tight">
        {display}
      </span>
    );
  }

  async function handleDelete(id: string) {
    console.log("[handleDelete] click", id);
    const ok = await confirm({
      title: "Бичилтийг устгах уу?",
      description: "Энэ үйлдлийг буцаах боломжгүй.",
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await deleteVoucher(id);
      console.log("[handleDelete] result", r);
    } catch (e) {
      console.error("[handleDelete] error", e);
      alert(e instanceof Error ? e.message : "Устгах үед алдаа гарлаа");
    }
  }

  async function handlePost(id: string) {
    console.log("[handlePost] click", id);
    const ok = await confirm({
      title: "Ноорогийг батлах уу?",
      description: "Батласны дараа засах бол ноорог руу буцаах хэрэгтэй.",
      confirmText: "Батлах",
    });
    if (!ok) return;
    try {
      const r = await postVoucher(id);
      console.log("[handlePost] result", r);
    } catch (e) {
      console.error("[handlePost] error", e);
      alert(e instanceof Error ? e.message : "Батлах үед алдаа гарлаа");
    }
  }

  async function handleUnpost(id: string) {
    console.log("[handleUnpost] click", id);
    const ok = await confirm({
      title: "Ноорог руу буцаах уу?",
      description: "Батлагдсан журналыг ноорог төлөвт буцаана.",
      confirmText: "Буцаах",
    });
    if (!ok) return;
    try {
      const r = await unpostVoucher(id);
      console.log("[handleUnpost] result", r);
    } catch (e) {
      console.error("[handleUnpost] error", e);
      alert(e instanceof Error ? e.message : "Буцаах үед алдаа гарлаа");
    }
  }

  function handleEdit(id: string) {
    console.log("[handleEdit] click", id);
    window.open(
      `/gl/journal/${id}/edit`,
      "_blank",
      "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
    );
  }

  const filtered = useMemo(() => {
    return vouchers.filter((v) => {
      if (appliedStart && v.date < appliedStart) return false;
      if (appliedEnd && v.date > appliedEnd) return false;
      return true;
    });
  }, [vouchers, appliedStart, appliedEnd]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("date", { id: "date" }),
      columnHelper.accessor("id", { id: "id" }),
      columnHelper.accessor("description", { id: "description" }),
      columnHelper.accessor("status", { id: "status" }),
    ],
    []
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const sortedVouchers = table.getRowModel().rows.map((r) => r.original);
  const totalPages = table.getPageCount() || 1;
  const page = table.getState().pagination.pageIndex + 1;

  function toggleSort(id: string) {
    table.getColumn(id)?.toggleSorting();
  }
  function sortDir(id: string): false | "asc" | "desc" {
    return table.getColumn(id)?.getIsSorted() ?? false;
  }

  const sortableThClass =
    "cursor-pointer select-none hover:bg-[#ECECE5] transition-colors";

  const grandDebit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.debit), 0),
    0
  );
  const grandCredit = filtered.reduce(
    (s, v) => s + v.lines.reduce((ls, l) => ls + Number(l.credit), 0),
    0
  );
  const balanced = Math.abs(grandDebit - grandCredit) <= 0.01;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium text-[#1A1A19]">Журналын жагсаалт</h1>
        <span className="text-xs text-[#9A9A91]">{filtered.length} бичилт</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
          Бичилт байхгүй
        </div>
      ) : (
        <>
          <div className="bg-white border border-[#E5E5DE] rounded-lg overflow-hidden">
            <Table className="border-collapse">
              <TableHeader className="[&_tr]:border-0">
                <TableRow className="bg-[#F4F4EE] text-[11px] font-semibold text-[#9A9A91] uppercase tracking-wide hover:bg-[#F4F4EE]">
                  <TableHead
                    className={`px-3 py-2.5 text-left w-[90px] border-b border-[#E5E5DE] ${sortableThClass}`}
                    onClick={() => toggleSort("date")}
                  >
                    Огноо
                    <SortIndicator dir={sortDir("date")} />
                  </TableHead>
                  <TableHead
                    className={`px-3 py-2.5 text-left w-[64px] border-b border-[#E5E5DE] ${sortableThClass}`}
                    onClick={() => toggleSort("id")}
                  >
                    ID
                    <SortIndicator dir={sortDir("id")} />
                  </TableHead>
                  <TableHead
                    className={`px-3 py-2.5 text-left w-[190px] border-b border-[#E5E5DE] ${sortableThClass}`}
                    onClick={() => toggleSort("description")}
                  >
                    Утга
                    <SortIndicator dir={sortDir("description")} />
                  </TableHead>
                  <TableHead className="px-3 py-2.5 text-left border-b border-[#E5E5DE]">Данс</TableHead>
                  <TableHead className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Дебет</TableHead>
                  <TableHead className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Кредит</TableHead>
                  <TableHead className="px-3 py-2.5 text-left w-[150px] border-b border-[#E5E5DE]">Тайлбар</TableHead>
                  <TableHead
                    className={`px-3 py-2.5 w-[120px] border-b border-[#E5E5DE] text-right ${sortableThClass}`}
                    onClick={() => toggleSort("status")}
                  >
                    Статус
                    <SortIndicator dir={sortDir("status")} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVouchers.map((v) => {
                  const isHovered = hoveredId === v.id;
                  const rowBg = isHovered ? "#F7F8FC" : "transparent";

                  return (
                    <React.Fragment key={v.id}>
                      {v.lines.map((l, li) => (
                        <TableRow
                          key={l.id}
                          style={{ background: rowBg }}
                          className={`transition-colors hover:bg-transparent ${
                            li === 0
                              ? "border-t-2 border-[#D4D4CB]"
                              : "border-t border-[#F0F0EA]"
                          }`}
                          onMouseEnter={() => setHoveredId(v.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Огноо */}
                          {li === 0 ? (
                            <TableCell
                              className="px-3 py-2 font-mono text-xs text-[#6B6B63] whitespace-nowrap align-top"
                              rowSpan={v.lines.length}
                            >
                              {v.date}
                            </TableCell>
                          ) : null}

                          {/* ID */}
                          {li === 0 ? (
                            <TableCell className="px-3 py-2 align-top" rowSpan={v.lines.length}>
                              <span
                                className="font-mono text-[10px] text-[#ADADAD] select-all cursor-default"
                                title={v.id}
                              >
                                {v.id.slice(0, 8)}
                              </span>
                            </TableCell>
                          ) : null}

                          {/* Утга */}
                          {li === 0 ? (
                            <TableCell
                              className="px-3 py-2 align-top"
                              rowSpan={v.lines.length}
                            >
                              <span className="text-xs font-medium text-[#1A1A19] leading-snug block">
                                {v.description}
                              </span>
                            </TableCell>
                          ) : null}

                          {/* Данс */}
                          <TableCell className="px-3 py-2">
                            <AccountCell code={l.accountNumber} />
                          </TableCell>

                          {/* Дебет */}
                          <TableCell className="px-3 py-2 text-right tabular-nums text-xs">
                            {Number(l.debit) !== 0 ? (
                              <span className={Number(l.debit) < 0 ? "text-[#B91C1C]" : "text-[#1A1A19]"}>{fmt(l.debit)}</span>
                            ) : (
                              <span className="text-[#D4D4CB]">—</span>
                            )}
                          </TableCell>

                          {/* Кредит */}
                          <TableCell className="px-3 py-2 text-right tabular-nums text-xs">
                            {Number(l.credit) !== 0 ? (
                              <span className={Number(l.credit) < 0 ? "text-[#B91C1C]" : "text-[#1A1A19]"}>{fmt(l.credit)}</span>
                            ) : (
                              <span className="text-[#D4D4CB]">—</span>
                            )}
                          </TableCell>

                          {/* Мөрийн тайлбар */}
                          <TableCell className="px-3 py-2 text-xs text-[#9A9A91] leading-snug">
                            {l.description}
                          </TableCell>

                          {/* Статус + үйлдэл */}
                          {li === 0 ? (
                            <TableCell
                              className="px-3 py-2 align-top"
                              rowSpan={v.lines.length}
                            >
                              <div className="flex flex-col items-end gap-2">
                                {/* Status */}
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                      v.status === "posted"
                                        ? "bg-[#059669]"
                                        : v.status === "reversed"
                                        ? "bg-[#9A9A91]"
                                        : "bg-[#D97706]"
                                    }`}
                                  />
                                  <span
                                    className={`text-[11px] font-medium ${
                                      v.status === "posted"
                                        ? "text-[#047857]"
                                        : v.status === "reversed"
                                        ? "text-[#6B6B63]"
                                        : "text-[#B45309]"
                                    }`}
                                  >
                                    {v.status === "posted"
                                      ? "Бичигдсэн"
                                      : v.status === "reversed"
                                      ? "Буцаагдсан"
                                      : "Ноорог"}
                                  </span>
                                </div>

                                {/* Actions */}
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
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </React.Fragment>
                  );
                })}
              </TableBody>
              <TableFooter style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
                <TableRow
                  className="hover:bg-transparent"
                  style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}
                >
                  <TableCell colSpan={4} className="px-3 py-2.5 text-xs font-semibold text-[#1E3A5F]">
                    Нийт дүн
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">
                    {fmt(grandDebit)}
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">
                    {fmt(grandCredit)}
                  </TableCell>
                  <TableCell colSpan={2} className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[#059669]" : "bg-[#DC2626]"}`}
                      />
                      <span
                        className={`text-xs font-medium ${balanced ? "text-[#047857]" : "text-[#B91C1C]"}`}
                      >
                        {balanced
                          ? "Тэнцсэн"
                          : `Зөрүү ${fmt(Math.abs(grandDebit - grandCredit))}`}
                      </span>
                    </div>
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
      )}
      {confirmDialog}
    </>
  );
}
