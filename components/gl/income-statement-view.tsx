"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { ReportGrid, type ReportRow } from "./report-grid";

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

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    out.push({ id: "sec-rev", kind: "section", label: "ОРЛОГО" });
    if (data.revenueRows.length === 0) {
      out.push({ id: "empty-rev", kind: "empty", label: "Орлогын бичилт байхгүй" });
    } else {
      data.revenueRows.forEach((r) =>
        out.push({
          id: `det-rev-${r.activeKey}`,
          kind: "detail",
          segs: r.segmentParts,
          name: r.name,
          amount: r.amount,
        })
      );
    }
    out.push({
      id: "sub-rev",
      kind: "subtotal",
      label: "Орлогын нийт",
      amount: data.pnl.revenue,
    });

    out.push({ id: "sec-exp", kind: "section", label: "ЗАРДАЛ" });
    data.expenseGroups.forEach((g, gi) => {
      if (g.items.length === 0) return;
      out.push({ id: `grp-exp-${gi}`, kind: "group", label: g.label });
      g.items.forEach((it) =>
        out.push({
          id: `det-exp-${it.activeKey}`,
          kind: "detail",
          segs: it.segmentParts,
          name: it.name,
          amount: it.amount,
        })
      );
      out.push({
        id: `sub-exp-${gi}`,
        kind: "subtotal",
        label: `${g.label} нийт`,
        amount: g.subtotal,
      });
    });
    out.push({
      id: "sub-exp-all",
      kind: "subtotal",
      label: "Зардлын нийт",
      amount: data.pnl.expense,
    });

    out.push({
      id: "tot-ni",
      kind: "total",
      label: `ТАЙЛАНТ ҮЕИЙН ЦЭВЭР ${data.pnl.netIncome >= 0 ? "АШИГ" : "АЛДАГДАЛ"}`,
      amount: data.pnl.netIncome,
      amountSign: data.pnl.netIncome >= 0 ? "pos" : "neg",
    });

    return out;
  }, [data]);

  return (
    <div className="flex-1 min-h-0">
      <ReportGrid activeSegments={activeSegments} rows={reportRows} />
    </div>
  );
}
