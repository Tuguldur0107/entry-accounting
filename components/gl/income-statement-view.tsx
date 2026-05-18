"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  fmtMnt as fmt,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";

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

interface ExpenseGroup {
  prefix: string;
  label: string;
  items: Line[];
  subtotal: number;
}

const EXPENSE_GROUPS = [
  { prefix: "6", label: "Борлуулсан бараа/үйлчилгээний өртөг" },
  { prefix: "7", label: "Үйл ажиллагааны зардал" },
  { prefix: "8", label: "Санхүүгийн зардал" },
];

export function IncomeStatementView({
  vouchers,
  accounts,
  activeSegIds,
  activeSegments,
  appliedFrom,
  appliedTo,
}: Props) {
  const rows = useMemo(
    () => aggregateBalances(vouchers, accounts, activeSegIds, appliedFrom, appliedTo),
    [vouchers, accounts, activeSegIds, appliedFrom, appliedTo],
  );

  const data = useMemo(() => {
    const toRevenueLine = (r: BalanceRow): Line => ({
      activeKey: r.activeKey,
      segmentParts: r.segmentParts,
      mainAccount: r.mainAccount,
      name: r.name,
      amount: r.totals.periodCredit - r.totals.periodDebit,
    });
    const toExpenseLine = (r: BalanceRow): Line => ({
      activeKey: r.activeKey,
      segmentParts: r.segmentParts,
      mainAccount: r.mainAccount,
      name: r.name,
      amount: r.totals.periodDebit - r.totals.periodCredit,
    });

    const revenueRows = rows
      .filter((r) => r.cls === "revenue")
      .map(toRevenueLine)
      .filter((r) => Math.abs(r.amount) > 0.005);

    const expenseGroups: ExpenseGroup[] = EXPENSE_GROUPS.map((g) => {
      const items = rows
        .filter((r) => r.mainAccount.startsWith(g.prefix))
        .map(toExpenseLine)
        .filter((r) => Math.abs(r.amount) > 0.005);
      return { ...g, items, subtotal: items.reduce((s, i) => s + i.amount, 0) };
    });

    const pnl = computeNetIncome(rows);
    return { revenueRows, expenseGroups, pnl };
  }, [rows]);

  const segCount = activeSegments.length;
  const colCount = segCount + 2; // segments + name + amount

  return (
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
          <BigSection label="ОРЛОГО" colCount={colCount} />
          {data.revenueRows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-3 pl-8 italic text-[#aaa]">
                Орлогын бичилт байхгүй
              </td>
            </tr>
          ) : (
            data.revenueRows.map((r) => (
              <Row key={r.activeKey} line={r} activeSegments={activeSegments} />
            ))
          )}
          <SubtotalRow
            label="Орлогын нийт"
            value={data.pnl.revenue}
            colCount={colCount}
          />

          <BigSection label="ЗАРДАЛ" colCount={colCount} />
          {data.expenseGroups.map((g) =>
            g.items.length === 0 ? null : (
              <ExpenseGroupRows
                key={g.prefix}
                group={g}
                activeSegments={activeSegments}
                colCount={colCount}
              />
            ),
          )}
          <SubtotalRow
            label="Зардлын нийт"
            value={data.pnl.expense}
            colCount={colCount}
          />

          <tr className="border-t-2 border-[#1E3A5F] bg-[#F7F8FC]">
            <td
              colSpan={colCount - 1}
              className="px-3 py-3 font-semibold text-[#1E3A5F]"
            >
              ТАЙЛАНТ ҮЕИЙН ЦЭВЭР {data.pnl.netIncome >= 0 ? "АШИГ" : "АЛДАГДАЛ"}
            </td>
            <td
              className={`px-3 py-3 text-right tabular-nums font-semibold ${data.pnl.netIncome >= 0 ? "text-[#047857]" : "text-[#B91C1C]"}`}
            >
              {fmt(data.pnl.netIncome)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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

function SubtotalRow({
  label,
  value,
  colCount,
}: {
  label: string;
  value: number;
  colCount: number;
}) {
  return (
    <tr className="border-t border-[#D4D4CB] bg-[#FAFAF5]">
      <td
        colSpan={colCount - 1}
        className="px-3 py-2 pl-6 font-medium text-[#1A1A19]"
      >
        {label}
      </td>
      <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1A1A19]">
        {fmt(value)}
      </td>
    </tr>
  );
}

function Row({
  line,
  activeSegments,
}: {
  line: Line;
  activeSegments: SegmentDef[];
}) {
  return (
    <tr className="border-t border-[#F0F0EA]">
      {activeSegments.map((s) => (
        <td
          key={s.id}
          className="px-3 py-2 pl-3 font-mono text-xs text-[#555] whitespace-nowrap"
          style={{ borderRight: "1px solid var(--ea-border)" }}
        >
          {line.segmentParts[s.id] ?? ""}
        </td>
      ))}
      <td
        className="px-3 py-2 text-[#1A1A19]"
        style={{ borderRight: "1px solid var(--ea-border)" }}
      >
        {line.name || <span className="text-[#aaa]">—</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[#1A1A19]">
        {fmt(line.amount)}
      </td>
    </tr>
  );
}

function ExpenseGroupRows({
  group,
  activeSegments,
  colCount,
}: {
  group: ExpenseGroup;
  activeSegments: SegmentDef[];
  colCount: number;
}) {
  return (
    <>
      <tr className="border-t border-[#F0F0EA] bg-[#FAFAF5]">
        <td
          colSpan={colCount}
          className="px-3 py-2 pl-4 text-xs font-medium text-[#6B6B63]"
        >
          {group.label}
        </td>
      </tr>
      {group.items.map((r) => (
        <Row key={r.activeKey} line={r} activeSegments={activeSegments} />
      ))}
      <tr className="border-t border-[#E8E8E0]">
        <td
          colSpan={colCount - 1}
          className="px-3 py-2 pl-8 text-xs italic text-[#6B6B63]"
        >
          {group.label} нийт
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-[#1A1A19] font-medium">
          {fmt(group.subtotal)}
        </td>
      </tr>
    </>
  );
}
