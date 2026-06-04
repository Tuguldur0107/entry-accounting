"use client";

import { useState, useMemo } from "react";
import { extractMainAccount } from "@/lib/segments";
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

export function ReportsView({ vouchers, accounts }: Props) {
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonth);
  const [appliedTo, setAppliedTo] = useState(today);
  const [page, setPage] = useState(1);

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.number, a.name])),
    [accounts]
  );

  function handleSearch() {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
    setPage(1);
  }

  const rows = useMemo<Row[]>(() => {
    // Aggregate per account
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
        // Тайлан сегментийг ашиглахгүй — үндсэн данс (S3)-аар нийлбэрлэнэ.
        const acct = extractMainAccount(l.accountNumber);
        ensure(acct);

        if (beforePeriod) {
          map[acct].openD += d;
          map[acct].openC += c;
        } else if (inPeriod) {
          map[acct].periodD += d;
          map[acct].periodC += c;
        }
      });
    });

    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([number, t]) => {
        const openNet = t.openD - t.openC;
        const openDebit = openNet > 0 ? openNet : 0;
        const openCredit = openNet < 0 ? -openNet : 0;

        const closeNet = openNet + t.periodD - t.periodC;
        const closeDebit = closeNet > 0 ? closeNet : 0;
        const closeCredit = closeNet < 0 ? -closeNet : 0;

        return {
          number,
          name: accountMap[number] ?? "",
          openDebit,
          openCredit,
          periodDebit: t.periodD,
          periodCredit: t.periodC,
          closeDebit,
          closeCredit,
        };
      });
  }, [vouchers, appliedFrom, appliedTo, accountMap]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paginated = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stats for period
  const periodVouchers = vouchers.filter(
    (v) => v.date >= appliedFrom && v.date <= appliedTo
  );
  const totalPeriodD = rows.reduce((s, r) => s + r.periodDebit, 0);
  const totalPeriodC = rows.reduce((s, r) => s + r.periodCredit, 0);
  const totalOpenD = rows.reduce((s, r) => s + r.openDebit, 0);
  const totalOpenC = rows.reduce((s, r) => s + r.openCredit, 0);
  const totalCloseD = rows.reduce((s, r) => s + r.closeDebit, 0);
  const totalCloseC = rows.reduce((s, r) => s + r.closeCredit, 0);

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
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
              <th
                className="px-4 py-2.5 text-left"
                rowSpan={2}
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Данс
              </th>
              <th
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Эхний үлдэгдэл
              </th>
              <th
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Гүйлгээ
              </th>
              <th
                colSpan={2}
                className="px-4 py-2 text-center border-b border-[#E5E5DE]"
              >
                Эцсийн үлдэгдэл
              </th>
            </tr>
            <tr className="bg-[#F4F4EE] text-xs text-[#666] font-medium">
              <th
                className="px-4 py-2 text-right w-[120px]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Дебет
              </th>
              <th
                className="px-4 py-2 text-right w-[120px]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Кредит
              </th>
              <th
                className="px-4 py-2 text-right w-[120px]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Дебет
              </th>
              <th
                className="px-4 py-2 text-right w-[120px]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Кредит
              </th>
              <th
                className="px-4 py-2 text-right w-[120px]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Дебет
              </th>
              <th className="px-4 py-2 text-right w-[120px]">Кредит</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-[#aaa]"
                >
                  Өгөгдөл байхгүй
                </td>
              </tr>
            ) : (
              paginated.map((r) => (
                <tr
                  key={r.number}
                  className="border-t border-[#E8E8E0] hover:bg-[#fafafa]"
                >
                  <td
                    className="px-4 py-2.5"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    <span className="font-mono text-[#555]">{r.number}</span>
                    {r.name && (
                      <span className="text-[#777] ml-2">— {r.name}</span>
                    )}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.openDebit > 0 ? fmt(r.openDebit) : ""}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.openCredit > 0 ? fmt(r.openCredit) : ""}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.periodDebit > 0 ? fmt(r.periodDebit) : ""}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.periodCredit > 0 ? fmt(r.periodCredit) : ""}
                  </td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums font-medium"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.closeDebit > 0 ? fmt(r.closeDebit) : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                    {r.closeCredit > 0 ? fmt(r.closeCredit) : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
              <td
                className="px-4 py-2.5 text-sm font-semibold text-[#1E3A5F]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Нийт дүн
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalOpenD)}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalOpenC)}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalPeriodD)}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalPeriodC)}
              </td>
              <td
                className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {fmt(totalCloseD)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]">
                {fmt(totalCloseC)}
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
  );
}
