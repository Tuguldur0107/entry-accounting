"use client";

import { useMemo, useState } from "react";
import type { ChartOfAccount, JournalVoucherWithLines, ReportLineMapping } from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  fmtMnt as fmt,
  isBalanced,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { BS_LINES, BS_LINE_BY_KEY } from "@/lib/reports/bs-lines";
import { ReportGrid, type ReportRow } from "./report-grid";
import { MappingDialog } from "./mapping-dialog";

const EPOCH = "1900-01-01";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
  mappings: ReportLineMapping[];
}

// Balance Sheet is an entity-level statement. Aggregate at the main-account
// (segment 3) level regardless of the user's `activeSegIds` configuration.
// Per-segment workpaper detail belongs in Trial Balance.
const BALANCE_SHEET_KEY: number[] = [3];

interface LineComputed {
  key: string;
  label: string;
  amount: number;
  accountNumbers: string[]; // accounts that contributed to this amount
}

interface GroupComputed {
  groupId: string;
  groupLabel: string;
  lines: LineComputed[];
  subtotal: number;
}

interface SectionComputed {
  sectionId: "assets" | "liabilities" | "equity";
  sectionLabel: string;
  groups: GroupComputed[];
  total: number;
}

// Resolve which account numbers contribute to a given line: user mapping
// wins when set; otherwise fall back to the line's default prefixes.
function resolveLineAccounts(
  lineKey: string,
  mappings: Map<string, string[]>,
  allAccounts: ChartOfAccount[]
): string[] {
  const override = mappings.get(lineKey);
  if (override !== undefined) return override;
  const line = BS_LINE_BY_KEY[lineKey];
  if (!line) return [];
  return allAccounts
    .filter((a) => line.defaultPrefixes.some((p) => a.number.startsWith(p)))
    .map((a) => a.number);
}

export function BalanceSheetView({
  vouchers,
  accounts,
  activeSegments,
  appliedTo,
  mappings,
}: Props) {
  // ── Mappings ──────────────────────────────────────────────────────────
  const mappingMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of mappings) {
      m.set(
        row.lineKey,
        row.accountNumbers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
    return m;
  }, [mappings]);

  // ── Raw balances at main-account level ────────────────────────────────
  const rows = useMemo(
    () => aggregateBalances(vouchers, accounts, BALANCE_SHEET_KEY, EPOCH, appliedTo),
    [vouchers, accounts, appliedTo],
  );

  // ── Aggregate balances per BS line per its account set ────────────────
  const data = useMemo(() => {
    const debitNet = (r: BalanceRow) => r.totals.closeDebit - r.totals.closeCredit;
    const creditNet = (r: BalanceRow) => r.totals.closeCredit - r.totals.closeDebit;
    const byMainAccount = new Map<string, BalanceRow>();
    for (const r of rows) byMainAccount.set(r.mainAccount, r);

    const computeLine = (lineKey: string): LineComputed => {
      const line = BS_LINE_BY_KEY[lineKey];
      const accountNumbers = resolveLineAccounts(lineKey, mappingMap, accounts);
      let amount = 0;
      for (const code of accountNumbers) {
        const r = byMainAccount.get(code);
        if (!r) continue;
        amount += line.sign === "debit" ? debitNet(r) : creditNet(r);
      }
      return { key: lineKey, label: line.label, amount, accountNumbers };
    };

    const groupBy = (section: "assets" | "liabilities" | "equity") => {
      const groups = new Map<string, GroupComputed>();
      for (const line of BS_LINES.filter((l) => l.section === section)) {
        if (!groups.has(line.group)) {
          groups.set(line.group, {
            groupId: line.group,
            groupLabel: line.groupLabel,
            lines: [],
            subtotal: 0,
          });
        }
        const computed = computeLine(line.key);
        const g = groups.get(line.group)!;
        g.lines.push(computed);
        g.subtotal += computed.amount;
      }
      return [...groups.values()];
    };

    const assetsGroups = groupBy("assets");
    const totalAssets = assetsGroups.reduce((s, g) => s + g.subtotal, 0);

    const liabGroups = groupBy("liabilities");
    const totalLiabilities = liabGroups.reduce((s, g) => s + g.subtotal, 0);

    const equityGroups = groupBy("equity");
    const totalEquityContrib = equityGroups.reduce((s, g) => s + g.subtotal, 0);

    const pnl = computeNetIncome(rows);
    const totalEquity = totalEquityContrib + pnl.netIncome;
    const totalLiabAndEquity = totalLiabilities + totalEquity;

    return {
      assets: { sectionId: "assets" as const, sectionLabel: "ХӨРӨНГӨ", groups: assetsGroups, total: totalAssets },
      liabilities: { sectionId: "liabilities" as const, sectionLabel: "ӨР ТӨЛБӨР", groups: liabGroups, total: totalLiabilities },
      equity: { sectionId: "equity" as const, sectionLabel: "ЭЗДИЙН ӨМЧ", groups: equityGroups, total: totalEquity },
      pnl,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabAndEquity,
    };
  }, [rows, accounts, mappingMap]);

  const balanced = isBalanced(data.totalAssets, data.totalLiabAndEquity);

  // ── Build the flat ReportRow[] ────────────────────────────────────────
  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];
    const emitSection = (sec: SectionComputed, totalLabel: string) => {
      out.push({ id: `sec-${sec.sectionId}`, kind: "section", label: sec.sectionLabel });
      // Hide groups that contain zero amounts entirely — keeps the
      // statement compact for a young ledger.
      const visibleGroups = sec.groups.filter((g) => g.subtotal !== 0 || g.lines.some((l) => l.amount !== 0));
      if (visibleGroups.length === 0) {
        out.push({ id: `empty-${sec.sectionId}`, kind: "empty", label: "Өгөгдөл байхгүй" });
      } else {
        for (const g of visibleGroups) {
          out.push({ id: `grp-${sec.sectionId}-${g.groupId}`, kind: "group", label: g.groupLabel });
          for (const line of g.lines) {
            // Skip zero lines unless they have an explicit user override
            // (so a user-pinned line stays visible even when its current
            // amount is zero).
            if (line.amount === 0 && !mappingMap.has(line.key)) continue;
            out.push({
              id: `det-${line.key}`,
              kind: "detail",
              name: line.label,
              amount: line.amount,
              lineKey: line.key,
            });
          }
          out.push({
            id: `sub-${sec.sectionId}-${g.groupId}`,
            kind: "subtotal",
            label: `${g.groupLabel} нийт`,
            amount: g.subtotal,
          });
        }
      }
      out.push({ id: `tot-${sec.sectionId}`, kind: "total", label: totalLabel, amount: sec.total });
    };

    emitSection(data.assets, "НИЙТ ХӨРӨНГӨ");
    emitSection(data.liabilities, "ӨР ТӨЛБӨРИЙН НИЙТ");

    // Equity is flat — items appear directly under the section header
    // (no intermediate group row) since SAS lists them at "group level"
    // (3.1, 3.2, 3.3, 3.4). Period P/L is a regular detail line but
    // intentionally omits `lineKey` so the Mapping column has nothing
    // to click — the P/L is computed off the 5/6/7/8 accounts, not a
    // user-mapped roll-up.
    out.push({ id: "sec-equity", kind: "section", label: data.equity.sectionLabel });
    const equityHasContent =
      data.equity.groups.some((g) => g.subtotal !== 0 || g.lines.some((l) => l.amount !== 0)) ||
      data.pnl.netIncome !== 0;
    if (!equityHasContent) {
      out.push({ id: "empty-equity", kind: "empty", label: "Өгөгдөл байхгүй" });
    } else {
      for (const g of data.equity.groups) {
        for (const line of g.lines) {
          if (line.amount === 0 && !mappingMap.has(line.key)) continue;
          out.push({
            id: `det-${line.key}`,
            kind: "detail",
            name: line.label,
            amount: line.amount,
            lineKey: line.key,
          });
        }
      }
      out.push({
        id: "det-current-period-pnl",
        kind: "detail",
        // No `lineKey` — this line is computed, not mappable.
        name: `Тайлант үеийн цэвэр ${data.pnl.netIncome >= 0 ? "ашиг" : "алдагдал"}`,
        amount: data.pnl.netIncome,
        amountSign: data.pnl.netIncome >= 0 ? "pos" : "neg",
      });
    }
    out.push({ id: "tot-equity", kind: "total", label: "ЭЗДИЙН ӨМЧИЙН НИЙТ", amount: data.totalEquity });

    out.push({
      id: "tot-le",
      kind: "total",
      label: "ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧИЙН НИЙТ",
      amount: data.totalLiabAndEquity,
    });

    return out;
  }, [data, mappingMap]);

  // ── Mapping dialog state ──────────────────────────────────────────────
  const [openLineKey, setOpenLineKey] = useState<string | null>(null);
  const openLine = openLineKey ? BS_LINE_BY_KEY[openLineKey] : null;
  const openLineAccounts = openLineKey
    ? resolveLineAccounts(openLineKey, mappingMap, accounts)
    : [];

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex-1 min-h-0">
        <ReportGrid
          activeSegments={activeSegments}
          rows={reportRows}
          hideAccount
          showLineNumbers
          onMappingClick={(key) => setOpenLineKey(key)}
        />
      </div>

      <div className="flex items-center justify-end gap-1.5 text-xs shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[var(--ea-success)]" : "bg-[var(--ea-danger)]"}`} />
        <span className={`font-medium ${balanced ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-danger-fg)]"}`}>
          {balanced
            ? "Баланс тэнцсэн"
            : `Зөрүү ${fmt(Math.abs(data.totalAssets - data.totalLiabAndEquity))}`}
        </span>
      </div>

      {openLine && (
        <MappingDialog
          open={!!openLineKey}
          onClose={() => setOpenLineKey(null)}
          reportType="balance-sheet"
          lineKey={openLine.key}
          lineLabel={openLine.label}
          initialAccounts={openLineAccounts}
          allAccounts={accounts}
        />
      )}
    </div>
  );
}
