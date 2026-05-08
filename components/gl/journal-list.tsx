"use client";

import { useState, useMemo } from "react";
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
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");
  const [page, setPage] = useState(1);

  // Extract S3 account code from composite segment code
  function extractS3(code: string): string {
    const parts = code.split(".");
    if (parts.length === 1) return code;
    const s3Pos = activeSegIds.indexOf(3);
    // If code parts match active segment count, use position mapping
    if (s3Pos !== -1 && parts.length === activeSegIds.length) return parts[s3Pos] ?? code;
    // Otherwise try each part against chartOfAccounts
    for (const part of parts) {
      if (accounts.find((x) => x.number === part)) return part;
    }
    return code;
  }

  function AccountCell({ code }: { code: string }) {
    const exact = accounts.find((x) => x.number === code);
    if (exact) {
      return (
        <div className="flex items-baseline gap-2">
          <span className="font-mono font-semibold text-[#1E3A5F] shrink-0">{exact.number}</span>
          <span className="text-[#666] truncate">{exact.name}</span>
        </div>
      );
    }
    const s3Code = extractS3(code);
    const match = accounts.find((x) => x.number === s3Code);
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-mono font-semibold text-[#1E3A5F] shrink-0">{code}</span>
        {match && <span className="text-[#666] truncate">{match.name}</span>}
      </div>
    );
  }

  async function handleDelete(id: string) {
    if (!confirm("Энэ бичилтийг устгах уу?")) return;
    await deleteVoucher(id);
  }

  async function handlePost(id: string) {
    if (!confirm("Энэ ноорогийг бичигдсэн болгох уу?")) return;
    await postVoucher(id);
  }

  function handleEdit(id: string) {
    window.open(`/gl/journal/${id}/edit`, "_blank", "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no");
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

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#1A1A19]">Журналын жагсаалт</h1>
        <Button
          className="bg-[#1E3A5F] hover:bg-[#15294A] text-white text-sm h-9 px-4 rounded-md"
          onClick={() => window.open("/gl/journal/new", "_blank", "width=1280,height=800,menubar=no,toolbar=no,location=no,status=no")}
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
            onClick={() => { setStartDate(""); setEndDate(""); setAppliedStart(""); setAppliedEnd(""); setPage(1); }}
            className="h-8 px-3 text-sm text-[#6B6B63] border border-[#E5E5DE] rounded-md hover:bg-[#F4F4EE] transition-colors"
          >
            Цэвэрлэх
          </button>
        )}
        <span className="ml-auto text-xs text-[#9A9A91]">{filtered.length} бичилт</span>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-[#E5E5DE] rounded-md py-16 text-center text-[#aaa] text-sm">
          Бичилт байхгүй
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginated.map((v) => {
              const vDebit = v.lines.reduce((s, l) => s + Number(l.debit), 0);
              const vCredit = v.lines.reduce((s, l) => s + Number(l.credit), 0);
              return (
                <div
                  key={v.id}
                  className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden"
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-[#F4F4EE] border-b border-[#E5E5DE]">
                    <span className="text-xs font-mono text-[#6B6B63] min-w-[86px]">{v.date}</span>
                    <span className="text-sm font-medium text-[#1A1A19] flex-1 truncate">{v.description}</span>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
                        v.status === "posted"
                          ? "bg-[#ECFDF5] text-[#047857] border-[#BBF7D0]"
                          : "bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]"
                      }`}
                    >
                      {v.status === "posted" ? "Бичигдсэн" : "Ноорог"}
                    </span>
                    {v.status === "draft" && (
                      <>
                        <button
                          onClick={() => handleEdit(v.id)}
                          className="text-xs font-medium text-[#1E3A5F] hover:bg-[#EEF3FF] px-2 py-0.5 rounded border border-[#C7D8EE] transition-colors ml-1"
                          title="Засах"
                        >
                          Засах
                        </button>
                        <button
                          onClick={() => handlePost(v.id)}
                          className="text-xs font-medium text-[#047857] hover:bg-[#ECFDF5] px-2 py-0.5 rounded border border-[#BBF7D0] transition-colors"
                          title="Бичигдсэн болгох"
                        >
                          Бичигдсэн болгох
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(v.id)}
                      className="text-[#D4D4CB] hover:text-[#B91C1C] hover:bg-red-50 w-6 h-6 flex items-center justify-center rounded text-base leading-none transition-colors ml-1"
                      title="Устгах"
                    >
                      ×
                    </button>
                  </div>

                  {/* Lines table */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#EDEDE6]">
                        <th className="px-4 py-1.5 text-left text-xs font-medium text-[#9A9A91] w-[280px]">Данс</th>
                        <th className="px-4 py-1.5 text-right text-xs font-medium text-[#9A9A91] w-[130px]">Дебет</th>
                        <th className="px-4 py-1.5 text-right text-xs font-medium text-[#9A9A91] w-[130px]">Кредит</th>
                        <th className="px-4 py-1.5 text-left text-xs font-medium text-[#9A9A91]">Тайлбар</th>
                      </tr>
                    </thead>
                    <tbody>
                      {v.lines.map((l) => (
                        <tr key={l.id} className="border-t border-[#F0F0E8] hover:bg-[#FAFAF7]">
                          <td className="px-4 py-2.5"><AccountCell code={l.accountNumber} /></td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1A19]">
                            {Number(l.debit) > 0 ? fmt(l.debit) : <span className="text-[#E5E5DE]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-[#1A1A19]">
                            {Number(l.credit) > 0 ? fmt(l.credit) : <span className="text-[#E5E5DE]">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-sm text-[#6B6B63]">{l.description || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[#E5E5DE] bg-[#F4F4EE]">
                        <td className="px-4 py-2 text-xs font-semibold text-[#6B6B63] text-right">Дүн</td>
                        <td className="px-4 py-2 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">{fmt(vDebit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-sm font-semibold text-[#1A1A19]">{fmt(vCredit)}</td>
                        <td className="px-4 py-2">
                          {Math.abs(vDebit - vCredit) < 0.005 ? (
                            <span className="text-xs text-[#047857]">✓ тэнцсэн</span>
                          ) : (
                            <span className="text-xs text-[#B91C1C]">зөрүү {fmt(Math.abs(vDebit - vCredit))}</span>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })}
          </div>

          {/* Footer: totals + pagination */}
          <div className="mt-3 flex items-center justify-between border-t-2 border-[#D4D4CB] pt-3" style={{ background: "var(--ea-bg-2)", borderRadius: 6, padding: "10px 16px" }}>
            {/* Grand totals */}
            <div className="flex items-center gap-6 text-sm">
              <span className="font-semibold text-[#1E3A5F]">Нийт дүн</span>
              <span>
                <span className="text-xs text-[#6B6B63] mr-1">Дебет</span>
                <span className="font-semibold tabular-nums text-[#1A1A19]">{fmt(grandDebit)}</span>
              </span>
              <span>
                <span className="text-xs text-[#6B6B63] mr-1">Кредит</span>
                <span className="font-semibold tabular-nums text-[#1A1A19]">{fmt(grandCredit)}</span>
              </span>
              <span className={Math.abs(grandDebit - grandCredit) < 0.005 ? "text-xs font-medium text-[#047857]" : "text-xs font-medium text-[#B91C1C]"}>
                {Math.abs(grandDebit - grandCredit) < 0.005 ? "Тэнцсэн" : `Зөрүү ${fmt(Math.abs(grandDebit - grandCredit))}`}
              </span>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
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
          </div>
        </>
      )}
    </>
  );
}
