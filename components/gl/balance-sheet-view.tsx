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

// ─── IAS 1 / Mongolian SAS Balance Sheet structure ─────────────────────────
// Assets       — current (1XX) and non-current (2XX)
// Liabilities  — current (31*, 32*) and non-current (33*)  ← IAS 1 §60
// Equity       — paid-in capital (41), OCI reserves (42, 43),
//                retained earnings (44), plus the current-period P/L
//                computed off revenue / expense accounts.
// Empty sub-groups are omitted to keep the statement compact.

const ASSET_GROUPS: { prefixes: string[]; label: string }[] = [
  { prefixes: ["1"], label: "Эргэлтийн хөрөнгө" },
  { prefixes: ["2"], label: "Эргэлтийн бус хөрөнгө" },
];

const LIABILITY_GROUPS: { prefixes: string[]; label: string }[] = [
  { prefixes: ["31", "32"], label: "Богино хугацаат өр төлбөр" },
  { prefixes: ["33"], label: "Урт хугацаат өр төлбөр" },
];

const EQUITY_GROUPS: { prefixes: string[]; label: string }[] = [
  { prefixes: ["41"], label: "Эздийн оруулсан өмч" },
  { prefixes: ["42", "43"], label: "Нөөц (OCI)" },
  { prefixes: ["44"], label: "Хуримтлагдсан ашиг" },
];

function matchesAnyPrefix(mainAccount: string, prefixes: string[]): boolean {
  return prefixes.some((p) => mainAccount.startsWith(p));
}

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
    // Sign convention: assets carry a debit balance, liabilities + equity a
    // credit balance. Each helper net-zeros the other side per row before
    // dropping zero rows.
    const debitNet = (r: BalanceRow) => r.totals.closeDebit - r.totals.closeCredit;
    const creditNet = (r: BalanceRow) => r.totals.closeCredit - r.totals.closeDebit;

    const collect = (
      prefixes: string[],
      signed: (r: BalanceRow) => number
    ): Line[] =>
      rows
        .filter((r) => matchesAnyPrefix(r.mainAccount, prefixes))
        .map((r) => ({
          activeKey: r.activeKey,
          segmentParts: r.segmentParts,
          mainAccount: r.mainAccount,
          name: r.name,
          amount: signed(r),
        }))
        .filter((r) => Math.abs(r.amount) > 0.005)
        .sort((a, b) => a.mainAccount.localeCompare(b.mainAccount));

    const buildAssetGroup = (def: typeof ASSET_GROUPS[number]): Group => {
      const items = collect(def.prefixes, debitNet);
      return {
        label: def.label,
        items,
        subtotal: items.reduce((s, i) => s + i.amount, 0),
      };
    };
    const buildCreditGroup = (
      def: typeof LIABILITY_GROUPS[number]
    ): Group => {
      const items = collect(def.prefixes, creditNet);
      return {
        label: def.label,
        items,
        subtotal: items.reduce((s, i) => s + i.amount, 0),
      };
    };

    const assets = ASSET_GROUPS.map(buildAssetGroup);
    const totalAssets = assets.reduce((s, g) => s + g.subtotal, 0);

    const liabilities = LIABILITY_GROUPS.map(buildCreditGroup);
    const totalLiabilities = liabilities.reduce((s, g) => s + g.subtotal, 0);

    const equityContrib = EQUITY_GROUPS.map(buildCreditGroup);
    const totalEquityContrib = equityContrib.reduce((s, g) => s + g.subtotal, 0);

    const pnl = computeNetIncome(rows);
    const totalEquity = totalEquityContrib + pnl.netIncome;
    const totalLiabAndEquity = totalLiabilities + totalEquity;

    return {
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equityContrib,
      totalEquityContrib,
      pnl,
      totalEquity,
      totalLiabAndEquity,
    };
  }, [rows]);

  const balanced = isBalanced(data.totalAssets, data.totalLiabAndEquity);

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    // Helper: emit a group only if it has items. Empty sub-groups are
    // skipped so the statement doesn't get cluttered with placeholders.
    const emitGroup = (g: Group, idPrefix: string) => {
      if (g.items.length === 0) return;
      out.push({ id: `grp-${idPrefix}`, kind: "group", label: g.label });
      g.items.forEach((it) =>
        out.push({
          id: `det-${idPrefix}-${it.activeKey}`,
          kind: "detail",
          segs: it.segmentParts,
          name: it.name,
          amount: it.amount,
        })
      );
      out.push({
        id: `sub-${idPrefix}`,
        kind: "subtotal",
        label: `${g.label} нийт`,
        amount: g.subtotal,
      });
    };

    // ── ASSETS ────────────────────────────────────────────────────────────
    out.push({ id: "sec-assets", kind: "section", label: "ХӨРӨНГӨ" });
    if (data.assets.every((g) => g.items.length === 0)) {
      out.push({ id: "empty-assets", kind: "empty", label: "Өгөгдөл байхгүй" });
    } else {
      data.assets.forEach((g, gi) => emitGroup(g, `asset-${gi}`));
    }
    out.push({
      id: "tot-assets",
      kind: "total",
      label: "НИЙТ ХӨРӨНГӨ",
      amount: data.totalAssets,
    });

    // ── LIABILITIES + EQUITY ──────────────────────────────────────────────
    out.push({ id: "sec-le", kind: "section", label: "ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧ" });

    // Liabilities (current vs non-current) — IAS 1 §60
    data.liabilities.forEach((g, gi) => emitGroup(g, `liab-${gi}`));
    if (data.liabilities.some((g) => g.items.length > 0)) {
      out.push({
        id: "sub-liab-all",
        kind: "subtotal",
        label: "Өр төлбөрийн нийт",
        amount: data.totalLiabilities,
      });
    }

    // Equity — paid-in capital, OCI reserves, retained earnings, +period P/L
    data.equityContrib.forEach((g, gi) => emitGroup(g, `eq-${gi}`));
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
      label: "ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧИЙН НИЙТ",
      amount: data.totalLiabAndEquity,
    });

    return out;
  }, [data]);

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex-1 min-h-0">
        <ReportGrid activeSegments={activeSegments} rows={reportRows} hideAccount />
      </div>

      <div className="flex items-center justify-end gap-1.5 text-xs shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[var(--ea-success)]" : "bg-[var(--ea-danger)]"}`} />
        <span className={`font-medium ${balanced ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-danger-fg)]"}`}>
          {balanced
            ? "Баланс тэнцсэн"
            : `Зөрүү ${fmt(Math.abs(data.totalAssets - data.totalLiabAndEquity))}`}
        </span>
      </div>
    </div>
  );
}
