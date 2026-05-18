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
import { ReportGrid, type ReportRow } from "./report-grid";

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

// Balance sheet is point-in-time at `appliedTo` and ignores `appliedFrom`.
export function BalanceSheetView({
  vouchers,
  accounts,
  activeSegIds,
  activeSegments,
  appliedTo,
}: Props) {
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

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    out.push({ id: "sec-assets", kind: "section", label: "ХӨРӨНГӨ" });
    data.assets.forEach((g, gi) => {
      out.push({ id: `grp-asset-${gi}`, kind: "group", label: g.label });
      if (g.items.length === 0) {
        out.push({ id: `empty-asset-${gi}`, kind: "empty", label: "Өгөгдөл байхгүй" });
      } else {
        g.items.forEach((it) =>
          out.push({
            id: `det-asset-${it.activeKey}`,
            kind: "detail",
            segs: it.segmentParts,
            name: it.name,
            amount: it.amount,
          })
        );
      }
      out.push({
        id: `sub-asset-${gi}`,
        kind: "subtotal",
        label: `${g.label} нийт`,
        amount: g.subtotal,
      });
    });
    out.push({
      id: "tot-assets",
      kind: "total",
      label: "ХӨРӨНГИЙН НИЙТ",
      amount: data.totalAssets,
    });

    out.push({ id: "sec-le", kind: "section", label: "ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧ" });

    out.push({ id: "grp-liab", kind: "group", label: data.liabilities.label });
    if (data.liabilities.items.length === 0) {
      out.push({ id: "empty-liab", kind: "empty", label: "Өгөгдөл байхгүй" });
    } else {
      data.liabilities.items.forEach((it) =>
        out.push({
          id: `det-liab-${it.activeKey}`,
          kind: "detail",
          segs: it.segmentParts,
          name: it.name,
          amount: it.amount,
        })
      );
    }
    out.push({
      id: "sub-liab",
      kind: "subtotal",
      label: "Өр төлбөрийн нийт",
      amount: data.liabilities.subtotal,
    });

    out.push({ id: "grp-equity", kind: "group", label: data.equity.label });
    if (data.equity.items.length === 0) {
      out.push({ id: "empty-equity", kind: "empty", label: "Өгөгдөл байхгүй" });
    } else {
      data.equity.items.forEach((it) =>
        out.push({
          id: `det-equity-${it.activeKey}`,
          kind: "detail",
          segs: it.segmentParts,
          name: it.name,
          amount: it.amount,
        })
      );
    }
    out.push({
      id: "sub-equity-contrib",
      kind: "subtotal",
      label: "Эзний оруулсан өмчийн нийт",
      amount: data.equity.subtotal,
    });
    out.push({
      id: "pnl",
      kind: "footnote",
      label: `Тайлант үеийн цэвэр ${data.pnl.netIncome >= 0 ? "ашиг" : "алдагдал"}`,
      amount: data.pnl.netIncome,
      amountSign: data.pnl.netIncome >= 0 ? "pos" : "neg",
    });
    out.push({
      id: "sub-equity-total",
      kind: "subtotal",
      label: "Эздийн өмчийн нийт",
      amount: data.totalEquity,
    });
    out.push({
      id: "tot-le",
      kind: "total",
      label: "ӨР ТӨЛБӨР БА ӨМЧИЙН НИЙТ",
      amount: data.totalLiabAndEquity,
    });

    return out;
  }, [data]);

  return (
    <>
      <ReportGrid activeSegments={activeSegments} rows={reportRows} />

      <div className="flex items-center justify-end gap-1.5 mt-3 text-xs">
        <span className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[#059669]" : "bg-[#DC2626]"}`} />
        <span className={`font-medium ${balanced ? "text-[#047857]" : "text-[#B91C1C]"}`}>
          {balanced
            ? "Баланс тэнцсэн"
            : `Зөрүү ${fmt(Math.abs(data.totalAssets - data.totalLiabAndEquity))}`}
        </span>
      </div>
    </>
  );
}
