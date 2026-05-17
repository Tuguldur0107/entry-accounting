"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { deleteVoucher, postVoucher } from "@/lib/actions/gl";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";

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
}

export function JournalList({ vouchers, accounts, activeSegIds }: Props) {
  const today = new Date();
  const defaultStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const defaultEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [appliedStart, setAppliedStart] = useState(defaultStart);
  const [appliedEnd, setAppliedEnd] = useState(defaultEnd);
  const [page, setPage] = useState(1);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
    if (!confirm("Энэ бичилтийг устгах уу?")) return;
    await deleteVoucher(id);
  }

  async function handlePost(id: string) {
    if (!confirm("Энэ ноорогийг батлах уу?")) return;
    await postVoucher(id);
  }

  function handleEdit(id: string) {
    window.open(
      `/gl/journal/${id}/edit`,
      "_blank",
      "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
    );
  }

  function handleSearch() {
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setPage(1);
  }

  const filtered = useMemo(() => {
    return vouchers.filter((v) => {
      if (appliedStart && v.date < appliedStart) return false;
      if (appliedEnd && v.date > appliedEnd) return false;
      return true;
    });
  }, [vouchers, appliedStart, appliedEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#1A1A19]">Журналын жагсаалт</h1>
        <Button
          className="bg-[#1E3A5F] hover:bg-[#15294A] text-white text-sm h-9 px-4 rounded-md"
          onClick={() =>
            window.open(
              "/gl/journal/new",
              "_blank",
              "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no"
            )
          }
        >
          + Журнал бичих
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Эхлэх огноо</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Дуусах огноо</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F]"
          />
        </div>
        <button
          onClick={handleSearch}
          className="h-8 px-4 text-sm font-medium bg-[#1E3A5F] text-white rounded-md hover:bg-[#15294A] transition-colors"
        >
          Хайх
        </button>
        {(appliedStart || appliedEnd) && (
          <button
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setAppliedStart("");
              setAppliedEnd("");
              setPage(1);
            }}
            className="h-8 px-3 text-sm text-[#6B6B63] border border-[#E5E5DE] rounded-md hover:bg-[#F4F4EE] transition-colors"
          >
            Цэвэрлэх
          </button>
        )}
        <span className="ml-auto text-xs text-[#9A9A91]">{filtered.length} бичилт</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
          Бичилт байхгүй
        </div>
      ) : (
        <>
          <div className="bg-white border border-[#E5E5DE] rounded-lg overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F4F4EE] text-[11px] font-semibold text-[#9A9A91] uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left w-[90px] border-b border-[#E5E5DE]">Огноо</th>
                  <th className="px-3 py-2.5 text-left w-[64px] border-b border-[#E5E5DE]">ID</th>
                  <th className="px-3 py-2.5 text-left w-[190px] border-b border-[#E5E5DE]">Утга</th>
                  <th className="px-3 py-2.5 text-left border-b border-[#E5E5DE]">Данс</th>
                  <th className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Дебет</th>
                  <th className="px-3 py-2.5 text-right w-[120px] border-b border-[#E5E5DE]">Кредит</th>
                  <th className="px-3 py-2.5 text-left w-[150px] border-b border-[#E5E5DE]">Тайлбар</th>
                  <th className="px-3 py-2.5 w-[120px] border-b border-[#E5E5DE]" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((v) => {
                  const isHovered = hoveredId === v.id;
                  const rowBg = isHovered ? "#F7F8FC" : "transparent";

                  return (
                    <React.Fragment key={v.id}>
                      {v.lines.map((l, li) => (
                        <tr
                          key={l.id}
                          style={{ background: rowBg }}
                          className={`transition-colors ${
                            li === 0
                              ? "border-t-2 border-[#D4D4CB]"
                              : "border-t border-[#F0F0EA]"
                          }`}
                          onMouseEnter={() => setHoveredId(v.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          {/* Огноо */}
                          {li === 0 ? (
                            <td
                              className="px-3 py-2 font-mono text-xs text-[#6B6B63] whitespace-nowrap align-top"
                              rowSpan={v.lines.length}
                            >
                              {v.date}
                            </td>
                          ) : null}

                          {/* ID */}
                          {li === 0 ? (
                            <td className="px-3 py-2 align-top" rowSpan={v.lines.length}>
                              <span
                                className="font-mono text-[10px] text-[#ADADAD] select-all cursor-default"
                                title={v.id}
                              >
                                {v.id.slice(0, 8)}
                              </span>
                            </td>
                          ) : null}

                          {/* Утга */}
                          {li === 0 ? (
                            <td
                              className="px-3 py-2 align-top"
                              rowSpan={v.lines.length}
                            >
                              <span className="text-xs font-medium text-[#1A1A19] leading-snug block">
                                {v.description}
                              </span>
                            </td>
                          ) : null}

                          {/* Данс */}
                          <td className="px-3 py-2">
                            <AccountCell code={l.accountNumber} />
                          </td>

                          {/* Дебет */}
                          <td className="px-3 py-2 text-right tabular-nums text-xs">
                            {Number(l.debit) > 0 ? (
                              <span className="text-[#1A1A19]">{fmt(l.debit)}</span>
                            ) : (
                              <span className="text-[#D4D4CB]">—</span>
                            )}
                          </td>

                          {/* Кредит */}
                          <td className="px-3 py-2 text-right tabular-nums text-xs">
                            {Number(l.credit) > 0 ? (
                              <span className="text-[#1A1A19]">{fmt(l.credit)}</span>
                            ) : (
                              <span className="text-[#D4D4CB]">—</span>
                            )}
                          </td>

                          {/* Мөрийн тайлбар */}
                          <td className="px-3 py-2 text-xs text-[#9A9A91] leading-snug">
                            {l.description}
                          </td>

                          {/* Статус + үйлдэл */}
                          {li === 0 ? (
                            <td
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
                                        : "bg-[#D97706]"
                                    }`}
                                  />
                                  <span
                                    className={`text-[11px] font-medium ${
                                      v.status === "posted"
                                        ? "text-[#047857]"
                                        : "text-[#B45309]"
                                    }`}
                                  >
                                    {v.status === "posted" ? "Бичигдсэн" : "Ноорог"}
                                  </span>
                                </div>

                                {/* Actions */}
                                <div
                                  className="flex items-center gap-1 transition-opacity duration-150"
                                  style={{ opacity: isHovered ? 1 : 0 }}
                                >
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
                                </div>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
                  <td colSpan={4} className="px-3 py-2.5 text-xs font-semibold text-[#1E3A5F]">
                    Нийт дүн
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">
                    {fmt(grandDebit)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">
                    {fmt(grandCredit)}
                  </td>
                  <td colSpan={2} className="px-3 py-2.5">
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
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-end gap-1 mt-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
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
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-7 w-7 flex items-center justify-center rounded border border-[#E5E5DE] text-[#6B6B63] text-sm hover:bg-[#F4F4EE] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
