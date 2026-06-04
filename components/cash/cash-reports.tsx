"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { CF_CATEGORIES, type CfCategory } from "@/lib/constants/cash";
import type { BankAccount, BankTransaction } from "@/lib/db/schema";

const fmt = (n: number) =>
  n.toLocaleString("mn-MN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";

interface Props {
  txns: BankTransaction[];
  banks: BankAccount[];
}

type Tab = "balances" | "direct";

export function CashReports({ txns, banks }: Props) {
  const [tab, setTab] = useState<Tab>("balances");
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonth);
  const [appliedTo, setAppliedTo] = useState(today);

  // ── Balances: opening + all posted movements up to `to`, period within range ──
  const balanceRows = useMemo(() => {
    return banks.map((b) => {
      const accountTxns = txns.filter((t) => t.bankAccountId === b.id);
      const opening = Number(b.openingBalance);
      // movements strictly before appliedFrom → carried into opening
      const before = accountTxns.filter((t) => t.date < appliedFrom);
      const openingAdj = before.reduce(
        (s, t) => s + (t.direction === "inflow" ? Number(t.amount) : -Number(t.amount)),
        0
      );
      const periodTxns = accountTxns.filter((t) => t.date >= appliedFrom && t.date <= appliedTo);
      const inflow = periodTxns.filter((t) => t.direction === "inflow").reduce((s, t) => s + Number(t.amount), 0);
      const outflow = periodTxns.filter((t) => t.direction === "outflow").reduce((s, t) => s + Number(t.amount), 0);
      const openBal = opening + openingAdj;
      return {
        id: b.id,
        name: b.name,
        currency: b.currency,
        opening: openBal,
        inflow,
        outflow,
        closing: openBal + inflow - outflow,
      };
    });
  }, [banks, txns, appliedFrom, appliedTo]);

  const totals = balanceRows.reduce(
    (acc, r) => ({
      opening: acc.opening + r.opening,
      inflow: acc.inflow + r.inflow,
      outflow: acc.outflow + r.outflow,
      closing: acc.closing + r.closing,
    }),
    { opening: 0, inflow: 0, outflow: 0, closing: 0 }
  );

  // ── Direct cash flow: group period txns by cf_category ──
  const cfRows = useMemo(() => {
    const period = txns.filter((t) => t.date >= appliedFrom && t.date <= appliedTo);
    return CF_CATEGORIES.map((c) => {
      const cat = period.filter((t) => t.cfCategory === c.value);
      const inflow = cat.filter((t) => t.direction === "inflow").reduce((s, t) => s + Number(t.amount), 0);
      const outflow = cat.filter((t) => t.direction === "outflow").reduce((s, t) => s + Number(t.amount), 0);
      return { value: c.value as CfCategory, label: c.label, inflow, outflow, net: inflow - outflow };
    });
  }, [txns, appliedFrom, appliedTo]);

  const cfNet = cfRows.reduce((s, r) => s + r.net, 0);

  function search() {
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-medium text-[#333]">Мөнгөн гүйлгээний тайлан</h1>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 border-b border-[#E5E5DE] mb-4">
        {([["balances", "Үлдэгдэл"], ["direct", "Мөнгөн гүйлгээ (шууд арга)"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === k ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-[#888] hover:text-[#333]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Эхлэх огноо</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:border-[#1E3A5F]" />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[#6B6B63] whitespace-nowrap">Дуусах огноо</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 px-2 text-sm border border-[#E5E5DE] rounded-md bg-white text-[#1A1A19] focus:outline-none focus:border-[#1E3A5F]" />
        </div>
        <button onClick={search} className="h-8 px-4 text-sm font-medium bg-[#1E3A5F] text-white rounded-md hover:bg-[#15294A] transition-colors">Хайх</button>
        <span className="ml-auto text-xs text-[#9A9A91]">Зөвхөн бичигдсэн гүйлгээ</span>
      </div>

      {/* Balances tab */}
      {tab === "balances" && (
        <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
                <th className="px-4 py-2.5 text-left">Данс</th>
                <th className="px-4 py-2.5 text-left w-[70px]">Валют</th>
                <th className="px-4 py-2.5 text-right w-[150px]">Эхний үлдэгдэл</th>
                <th className="px-4 py-2.5 text-right w-[150px]">Орлого</th>
                <th className="px-4 py-2.5 text-right w-[150px]">Зарлага</th>
                <th className="px-4 py-2.5 text-right w-[150px]">Эцсийн үлдэгдэл</th>
              </tr>
            </thead>
            <tbody>
              {balanceRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-[#aaa]">Данс байхгүй</td></tr>
              ) : (
                balanceRows.map((r) => (
                  <tr key={r.id} className="border-t border-[#E8E8E0] hover:bg-[#fafafa]">
                    <td className="px-4 py-2.5 text-[#1A1A19]">{r.name}</td>
                    <td className="px-4 py-2.5 text-[#555]">{r.currency}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.opening)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#047857]">{r.inflow ? fmt(r.inflow) : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#B91C1C]">{r.outflow ? fmt(r.outflow) : ""}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmt(r.closing)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {balanceRows.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
                  <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-[#1E3A5F]">Нийт дүн</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(totals.opening)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#047857]">{fmt(totals.inflow)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#B91C1C]">{fmt(totals.outflow)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{fmt(totals.closing)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Direct cash flow tab */}
      {tab === "direct" && (
        <div className="bg-white border border-[#E5E5DE] rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
                <th className="px-4 py-2.5 text-left">Ангилал (IAS 7)</th>
                <th className="px-4 py-2.5 text-right w-[170px]">Орсон</th>
                <th className="px-4 py-2.5 text-right w-[170px]">Гарсан</th>
                <th className="px-4 py-2.5 text-right w-[170px]">Цэвэр гүйлгээ</th>
              </tr>
            </thead>
            <tbody>
              {cfRows.map((r) => (
                <tr key={r.value} className="border-t border-[#E8E8E0] hover:bg-[#fafafa]">
                  <td className="px-4 py-2.5 text-[#1A1A19]">{r.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#047857]">{r.inflow ? fmt(r.inflow) : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#B91C1C]">{r.outflow ? fmt(r.outflow) : ""}</td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", r.net < 0 && "text-[#B91C1C]")}>{fmt(r.net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
                <td className="px-4 py-2.5 text-sm font-semibold text-[#1E3A5F]">Мөнгөн хөрөнгийн цэвэр өөрчлөлт</td>
                <td colSpan={2} />
                <td className={cn("px-4 py-2.5 text-right tabular-nums font-semibold", cfNet < 0 && "text-[#B91C1C]")}>{fmt(cfNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
