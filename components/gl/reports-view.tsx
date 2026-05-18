"use client";

import { useState, useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";

type Tab = "trial-balance" | "variance" | "roll-forward";

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

export function ReportsView({ vouchers, accounts, activeSegIds }: Props) {
  const [tab, setTab] = useState<Tab>("trial-balance");
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonth);
  const [appliedTo, setAppliedTo] = useState(today);
  const [page, setPage] = useState(1);
  const [rfAccount, setRfAccount] = useState("");

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.number, a.name])),
    [accounts]
  );

  // Extract S3 account code from composite segment code, then look up name
  function resolveAccountName(code: string): string {
    if (accountMap[code]) return accountMap[code];
    const parts = code.split(".");
    if (parts.length > 1) {
      const s3Pos = activeSegIds.indexOf(3);
      // Position match when code parts count equals active segment count
      if (s3Pos !== -1 && parts.length === activeSegIds.length) {
        const name = accountMap[parts[s3Pos] ?? ""];
        if (name) return name;
      }
      // Fallback: try each part
      for (const part of parts) {
        if (accountMap[part]) return accountMap[part];
      }
    }
    return "";
  }

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

  // ─── Variance commentary ─────────────────────────────────────────────────────
  const VARIANCE_THRESHOLD = 0.05; // 5%

  const varianceRows = useMemo(() => {
    // Prior period: same length window immediately before appliedFrom
    const fromDate = new Date(appliedFrom);
    const toDate = new Date(appliedTo);
    const periodMs = toDate.getTime() - fromDate.getTime();
    const priorTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
    const priorFrom = new Date(priorTo.getTime() - periodMs);
    const priorFromStr = priorFrom.toISOString().slice(0, 10);
    const priorToStr = priorTo.toISOString().slice(0, 10);

    const curr: Record<string, { d: number; c: number }> = {};
    const prev: Record<string, { d: number; c: number }> = {};
    const ensure = (m: typeof curr, k: string) => { if (!m[k]) m[k] = { d: 0, c: 0 }; };

    vouchers.forEach((v) => {
      const inCurr = v.date >= appliedFrom && v.date <= appliedTo;
      const inPrev = v.date >= priorFromStr && v.date <= priorToStr;
      v.lines.forEach((l) => {
        const d = Number(l.debit), c = Number(l.credit);
        if (inCurr) { ensure(curr, l.accountNumber); curr[l.accountNumber].d += d; curr[l.accountNumber].c += c; }
        if (inPrev) { ensure(prev, l.accountNumber); prev[l.accountNumber].d += d; prev[l.accountNumber].c += c; }
      });
    });

    const allAccounts = new Set([...Object.keys(curr), ...Object.keys(prev)]);
    return Array.from(allAccounts)
      .map((num) => {
        const cNet = (curr[num]?.d ?? 0) - (curr[num]?.c ?? 0);
        const pNet = (prev[num]?.d ?? 0) - (prev[num]?.c ?? 0);
        const delta = cNet - pNet;
        const pctChange = pNet !== 0 ? delta / Math.abs(pNet) : cNet !== 0 ? 1 : 0;
        return { number: num, name: resolveAccountName(num), currNet: cNet, prevNet: pNet, delta, pctChange };
      })
      .filter((r) => Math.abs(r.pctChange) >= VARIANCE_THRESHOLD || Math.abs(r.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [vouchers, appliedFrom, appliedTo, accountMap]);

  // ─── Roll-forward ─────────────────────────────────────────────────────────────
  const rfRows = useMemo(() => {
    if (!rfAccount) return null;
    const lines = vouchers
      .filter((v) => v.date <= appliedTo)
      .flatMap((v) => v.lines.filter((l) => l.accountNumber === rfAccount).map((l) => ({ ...l, date: v.date, desc: v.description })));

    let openD = 0, openC = 0, periodD = 0, periodC = 0;
    lines.forEach((l) => {
      if (l.date < appliedFrom) { openD += Number(l.debit); openC += Number(l.credit); }
      else { periodD += Number(l.debit); periodC += Number(l.credit); }
    });
    const openNet = openD - openC;
    const closeNet = openNet + periodD - periodC;

    const periodEntries = lines
      .filter((l) => l.date >= appliedFrom && l.date <= appliedTo)
      .map((l) => ({ date: l.date, desc: l.desc, debit: Number(l.debit), credit: Number(l.credit) }));

    return { openNet, periodD, periodC, closeNet, periodEntries };
  }, [rfAccount, vouchers, appliedFrom, appliedTo]);

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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-medium text-[#333]">Тайлан</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[#E5E5DE]">
        {(["trial-balance", "variance", "roll-forward"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? "border-[#1E3A5F] text-[#1E3A5F]"
                : "border-transparent text-[#6B6B63] hover:text-[#333]"
            }`}
          >
            {t === "trial-balance" ? "Оборотная ведомость" : t === "variance" ? "Зөрүүний тайлбар" : "Roll-forward"}
          </button>
        ))}
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

      {tab === "trial-balance" && (
      <>
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
      )}

      {/* ── Variance commentary tab ── */}
      {tab === "variance" && (
        <div>
          <p className="text-xs text-[#9A9A91] mb-3">
            Сонгосон периодыг өмнөх ижил урттай периодтой харьцуулна. Өөрчлөлт ≥5% эсвэл ≥1₮ бүх данс харагдана.
          </p>
          {varianceRows.length === 0 ? (
            <div className="bg-white border border-[#E5E5DE] rounded-md px-6 py-10 text-center text-[#aaa] text-sm">
              Зөрүүтэй данс байхгүй — хоёр период дахь мэдээлэл нэг байна
            </div>
          ) : (
            <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
                    <th className="px-4 py-2.5 text-left" style={{ borderRight: "1px solid var(--ea-border)" }}>Данс</th>
                    <th className="px-4 py-2.5 text-right w-[140px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Өмнөх период</th>
                    <th className="px-4 py-2.5 text-right w-[140px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Одоогийн период</th>
                    <th className="px-4 py-2.5 text-right w-[120px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Зөрүү (₮)</th>
                    <th className="px-4 py-2.5 text-right w-[90px]">Зөрүү (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {varianceRows.map((r) => {
                    const up = r.delta > 0;
                    const pctStr = r.prevNet === 0 ? "шинэ" : `${up ? "+" : ""}${(r.pctChange * 100).toFixed(1)}%`;
                    return (
                      <tr key={r.number} className="border-t border-[#E8E8E0] hover:bg-[#fafafa]">
                        <td className="px-4 py-2.5" style={{ borderRight: "1px solid var(--ea-border)" }}>
                          <span className="font-mono text-[#555]">{r.number}</span>
                          {r.name && <span className="text-[#777] ml-2">— {r.name}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[#6B6B63]" style={{ borderRight: "1px solid var(--ea-border)" }}>
                          {fmt(r.prevNet)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>
                          {fmt(r.currNet)}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${r.delta > 0 ? "text-emerald-700" : "text-red-600"}`} style={{ borderRight: "1px solid var(--ea-border)" }}>
                          {r.delta > 0 ? "+" : ""}{fmt(r.delta)}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-xs font-medium ${r.delta > 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {pctStr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Roll-forward tab ── */}
      {tab === "roll-forward" && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <label className="text-xs text-[#6B6B63] whitespace-nowrap">Данс сонгох</label>
            <select
              value={rfAccount}
              onChange={(e) => setRfAccount(e.target.value)}
              className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[#1E3A5F] min-w-[240px]"
            >
              <option value="">— сонгоно уу —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.number}>{a.number} — {a.name}</option>
              ))}
            </select>
          </div>

          {!rfAccount ? (
            <div className="bg-white border border-[#E5E5DE] rounded-md px-6 py-10 text-center text-[#aaa] text-sm">
              Roll-forward харахын тулд данс сонгоно уу
            </div>
          ) : rfRows ? (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
                <div className="bg-[#F4F4EE] px-4 py-2.5 text-xs font-semibold text-[#1E3A5F] border-b border-[#E5E5DE]">
                  {rfAccount} — {accounts.find(a => a.number === rfAccount)?.name ?? ""} · {appliedFrom} → {appliedTo}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      { label: "Эхний үлдэгдэл", val: rfRows.openNet, bold: false },
                      { label: "+ Дебет гүйлгээ", val: rfRows.periodD, bold: false },
                      { label: "− Кредит гүйлгээ", val: -rfRows.periodC, bold: false },
                      { label: "Эцсийн үлдэгдэл", val: rfRows.closeNet, bold: true },
                    ].map(({ label, val, bold }) => (
                      <tr key={label} className={`border-t border-[#E8E8E0] ${bold ? "bg-[#F9F9F5]" : ""}`}>
                        <td className={`px-4 py-2.5 ${bold ? "font-semibold text-[#1E3A5F]" : "text-[#555]"}`} style={{ borderRight: "1px solid var(--ea-border)" }}>{label}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${bold ? "font-semibold text-[#1E3A5F]" : ""} ${val < 0 ? "text-red-600" : ""}`}>
                          {val < 0 ? "-" : ""}{fmt(Math.abs(val))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Detail entries */}
              {rfRows.periodEntries.length > 0 && (
                <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
                  <div className="bg-[#F4F4EE] px-4 py-2.5 text-xs font-semibold text-[#666] border-b border-[#E5E5DE]">
                    Период дотрох гүйлгээ ({rfRows.periodEntries.length})
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[#888] font-medium border-b border-[#E5E5DE]">
                        <th className="px-4 py-2 text-left" style={{ borderRight: "1px solid var(--ea-border)" }}>Огноо</th>
                        <th className="px-4 py-2 text-left" style={{ borderRight: "1px solid var(--ea-border)" }}>Тайлбар</th>
                        <th className="px-4 py-2 text-right w-[120px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Дебет</th>
                        <th className="px-4 py-2 text-right w-[120px]">Кредит</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rfRows.periodEntries.map((e, i) => (
                        <tr key={i} className="border-t border-[#E8E8E0] hover:bg-[#fafafa]">
                          <td className="px-4 py-2 font-mono text-xs text-[#6B6B63]" style={{ borderRight: "1px solid var(--ea-border)" }}>{e.date}</td>
                          <td className="px-4 py-2 text-[#555]" style={{ borderRight: "1px solid var(--ea-border)" }}>{e.desc}</td>
                          <td className="px-4 py-2 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>{e.debit > 0 ? fmt(e.debit) : ""}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.credit > 0 ? fmt(e.credit) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
