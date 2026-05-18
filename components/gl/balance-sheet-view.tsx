"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  fmtMnt as fmt,
  isBalanced,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";

const EPOCH = "1900-01-01";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
}

interface Line {
  activeKey: string;
  segmentParts: Record<number, string>;
  mainAccount: string;
  name: string;
  amount: number;
}

interface Group {
  label: string;
  items: Line[];
  subtotal: number;
}

const ASSET_GROUPS = [
  { prefix: "1", label: "Эргэлтийн хөрөнгө" },
  { prefix: "2", label: "Эргэлтийн бус хөрөнгө" },
];

export function BalanceSheetView({
  vouchers,
  accounts,
  activeSegIds,
  activeSegments,
  appliedFrom: _appliedFrom,
  appliedTo,
}: Props) {
  // Balance sheet uses point-in-time closing through appliedTo.
  const rows = useMemo(
    () => aggregateBalances(vouchers, accounts, activeSegIds, EPOCH, appliedTo),
    [vouchers, accounts, activeSegIds, appliedTo],
  );

  const data = useMemo(() => {
    const debitNet = (r: BalanceRow) => r.totals.closeDebit - r.totals.closeCredit;
    const creditNet = (r: BalanceRow) => r.totals.closeCredit - r.totals.closeDebit;

    const buildAssetGroup = (prefix: string, label: string): Group => {
      const items = rows
        .filter((r) => r.mainAccount.startsWith(prefix))
        .map((r) => ({
          activeKey: r.activeKey,
          segmentParts: r.segmentParts,
          mainAccount: r.mainAccount,
          name: r.name,
          amount: debitNet(r),
        }))
        .filter((r) => Math.abs(r.amount) > 0.005);
      return { label, items, subtotal: items.reduce((s, i) => s + i.amount, 0) };
    };

    const buildCreditGroup = (prefix: string, label: string): Group => {
      const items = rows
        .filter((r) => r.mainAccount.startsWith(prefix))
        .map((r) => ({
          activeKey: r.activeKey,
          segmentParts: r.segmentParts,
          mainAccount: r.mainAccount,
          name: r.name,
          amount: creditNet(r),
        }))
        .filter((r) => Math.abs(r.amount) > 0.005);
      return { label, items, subtotal: items.reduce((s, i) => s + i.amount, 0) };
    };

    const assets = ASSET_GROUPS.map((g) => buildAssetGroup(g.prefix, g.label));
    const totalAssets = assets.reduce((s, g) => s + g.subtotal, 0);

    const liabilities = buildCreditGroup("3", "Өр төлбөр");
    const equity = buildCreditGroup("4", "Эздийн өмч");
    const pnl = computeNetIncome(rows);
    const totalEquity = equity.subtotal + pnl.netIncome;
    const totalLiabAndEquity = liabilities.subtotal + totalEquity;

    return { assets, totalAssets, liabilities, equity, pnl, totalEquity, totalLiabAndEquity };
  }, [rows]);

  const balanced = isBalanced(data.totalAssets, data.totalLiabAndEquity);
  const segCount = activeSegments.length;
  const colCount = segCount + 2; // segments + name + amount

  return (
    <>
      <div className="bg-white border border-[#E5E5DE] rounded-md overflow-x-auto text-sm">
        <table className="w-full">
          <thead className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
            <tr>
              {activeSegments.map((s) => (
                <th
                  key={s.id}
                  className="px-3 py-2.5 text-left whitespace-nowrap"
                  style={{ borderRight: "1px solid var(--ea-border)" }}
                >
                  {s.nameMn}
                </th>
              ))}
              <th
                className="px-3 py-2.5 text-left"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Үндсэн дансны нэр
              </th>
              <th className="px-3 py-2.5 text-right w-[160px]">Дүн</th>
            </tr>
          </thead>
          <tbody>
            <BigSection label="ХӨРӨНГӨ" colCount={colCount} />
            {data.assets.map((g) => (
              <GroupRows
                key={g.label}
                group={g}
                activeSegments={activeSegments}
                colCount={colCount}
                subtotalLabel={`${g.label} нийт`}
              />
            ))}
            <TotalRow
              label="ХӨРӨНГИЙН НИЙТ"
              value={data.totalAssets}
              colCount={colCount}
            />

            <BigSection label="ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧ" colCount={colCount} />
            <GroupRows
              group={data.liabilities}
              activeSegments={activeSegments}
              colCount={colCount}
              subtotalLabel="Өр төлбөрийн нийт"
            />
            <GroupRows
              group={data.equity}
              activeSegments={activeSegments}
              colCount={colCount}
              subtotalLabel="Эзний оруулсан өмчийн нийт"
            />
            <tr className="border-t border-[#F0F0EA]">
              <td
                colSpan={colCount - 1}
                className="px-3 py-2 pl-6 italic text-[#6B6B63]"
              >
                Тайлант үеийн цэвэр {data.pnl.netIncome >= 0 ? "ашиг" : "алдагдал"}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${data.pnl.netIncome >= 0 ? "text-[#047857]" : "text-[#B91C1C]"}`}
              >
                {fmt(data.pnl.netIncome)}
              </td>
            </tr>
            <tr className="border-t border-[#D4D4CB] bg-[#FAFAF5]">
              <td
                colSpan={colCount - 1}
                className="px-3 py-2 pl-6 font-medium text-[#1A1A19]"
              >
                Эздийн өмчийн нийт
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1A1A19]">
                {fmt(data.totalEquity)}
              </td>
            </tr>
            <TotalRow
              label="ӨР ТӨЛБӨР БА ӨМЧИЙН НИЙТ"
              value={data.totalLiabAndEquity}
              colCount={colCount}
            />
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-3 text-xs">
        <span
          className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[#059669]" : "bg-[#DC2626]"}`}
        />
        <span className={`font-medium ${balanced ? "text-[#047857]" : "text-[#B91C1C]"}`}>
          {balanced
            ? "Баланс тэнцсэн"
            : `Зөрүү ${fmt(Math.abs(data.totalAssets - data.totalLiabAndEquity))}`}
        </span>
      </div>
    </>
  );
}

function BigSection({ label, colCount }: { label: string; colCount: number }) {
  return (
    <tr className="bg-[#EEF0F4] border-t-2 border-[#1E3A5F]">
      <td
        colSpan={colCount}
        className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#1E3A5F]"
      >
        {label}
      </td>
    </tr>
  );
}

function TotalRow({
  label,
  value,
  colCount,
}: {
  label: string;
  value: number;
  colCount: number;
}) {
  return (
    <tr className="border-t-2 border-[#1E3A5F] bg-[#F7F8FC]">
      <td
        colSpan={colCount - 1}
        className="px-3 py-2.5 font-semibold text-[#1E3A5F]"
      >
        {label}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#1A1A19]">
        {fmt(value)}
      </td>
    </tr>
  );
}

function GroupRows({
  group,
  activeSegments,
  colCount,
  subtotalLabel,
}: {
  group: Group;
  activeSegments: SegmentDef[];
  colCount: number;
  subtotalLabel: string;
}) {
  return (
    <>
      <tr className="bg-[#FAFAF5] border-t border-[#E5E5DE]">
        <td
          colSpan={colCount}
          className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#6B6B63]"
        >
          {group.label}
        </td>
      </tr>
      {group.items.length === 0 ? (
        <tr>
          <td
            colSpan={colCount}
            className="px-3 py-2 pl-8 text-xs italic text-[#aaa]"
          >
            Өгөгдөл байхгүй
          </td>
        </tr>
      ) : (
        group.items.map((r) => (
          <tr key={r.activeKey} className="border-t border-[#F0F0EA]">
            {activeSegments.map((s) => (
              <td
                key={s.id}
                className="px-3 py-2 font-mono text-xs text-[#555] whitespace-nowrap"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {r.segmentParts[s.id] ?? ""}
              </td>
            ))}
            <td
              className="px-3 py-2 text-[#1A1A19]"
              style={{ borderRight: "1px solid var(--ea-border)" }}
            >
              {r.name || <span className="text-[#aaa]">—</span>}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-[#1A1A19]">
              {fmt(r.amount)}
            </td>
          </tr>
        ))
      )}
      <tr className="border-t border-[#D4D4CB] bg-[#FAFAF5]">
        <td
          colSpan={colCount - 1}
          className="px-3 py-2 pl-6 font-medium text-[#1A1A19]"
        >
          {subtotalLabel}
        </td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1A1A19]">
          {fmt(group.subtotal)}
        </td>
      </tr>
    </>
  );
}
