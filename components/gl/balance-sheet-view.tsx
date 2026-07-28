"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import type { ChartOfAccount, JournalVoucherWithLines, ReportLineMapping } from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  fmtMnt as fmt,
  isBalanced,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { BS_LINES, type BsSection, type BsSign } from "@/lib/reports/bs-lines";
import { ReportGrid, type ReportRow } from "./report-grid";
import { MappingDialog } from "./mapping-dialog";
import { AddLineDialog } from "./add-line-dialog";
import {
  setLineHidden,
  removeCustomLine,
} from "@/lib/actions/report-mappings";

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

// Balance Sheet is an entity-level statement — main-account aggregation
// regardless of `activeSegIds`. Per-segment workpaper view lives in Trial
// Balance.
const BALANCE_SHEET_KEY: number[] = [3];

// Group → section + sign lookup. Custom lines pick their sign from the
// section their group belongs to.
const GROUP_META: Record<string, { section: BsSection; sign: BsSign; groupLabel: string }> = {};
for (const line of BS_LINES) {
  if (!GROUP_META[line.group]) {
    GROUP_META[line.group] = {
      section: line.section,
      sign: line.sign,
      groupLabel: line.groupLabel,
    };
  }
}

// Group options offered when the user opens "+ Шинэ мөр".
const GROUP_OPTIONS = Object.entries(GROUP_META).map(([value, meta]) => ({
  value,
  label: meta.groupLabel,
}));

const COLLAPSE_STORAGE_KEY = "ea-balance-sheet-collapsed";

interface ResolvedLine {
  key: string;
  section: BsSection;
  group: string;
  groupLabel: string;
  label: string;
  accountNumbers: string[];
  sign: BsSign;
  isHidden: boolean;
  isCustom: boolean;
  sortOrder: number;
}

interface ComputedLine extends ResolvedLine {
  amount: number;
}

interface GroupComputed {
  groupId: string;
  groupLabel: string;
  lines: ComputedLine[];
  subtotal: number; // sum of visible lines only
}

interface SectionComputed {
  sectionId: BsSection;
  sectionLabel: string;
  groups: GroupComputed[];
  total: number;
}

const SECTION_LABEL: Record<BsSection, string> = {
  assets: "ХӨРӨНГӨ",
  liabilities: "ӨР ТӨЛБӨР",
  equity: "ЭЗДИЙН ӨМЧ",
};

export function BalanceSheetView({
  vouchers,
  accounts,
  activeSegments,
  appliedTo,
  mappings,
}: Props) {
  // ── Toolbar / dialog state ────────────────────────────────────────────
  const [showHidden, setShowHidden] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [openLineKey, setOpenLineKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // ── Mapping rows indexed by lineKey for fast lookup ───────────────────
  const mappingByKey = useMemo(() => {
    const m = new Map<string, ReportLineMapping>();
    for (const row of mappings) m.set(row.lineKey, row);
    return m;
  }, [mappings]);

  // ── Resolve all lines (built-in + custom) with overrides applied ──────
  const resolvedLines = useMemo<ResolvedLine[]>(() => {
    const out: ResolvedLine[] = [];

    // Built-in lines from BS_LINES, with any mapping overrides applied.
    BS_LINES.forEach((line, idx) => {
      const m = mappingByKey.get(line.key);
      const override = m?.accountNumbers
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const accountNumbers =
        override !== undefined
          ? override
          : accounts
              .filter((a) => line.defaultPrefixes.some((p) => a.number.startsWith(p)))
              .map((a) => a.number);
      out.push({
        key: line.key,
        section: line.section,
        group: line.group,
        groupLabel: line.groupLabel,
        label: m?.customLabel?.trim() || line.label,
        accountNumbers,
        sign: line.sign,
        isHidden: !!m?.isHidden,
        isCustom: false,
        // Built-in lines keep their authoring order via index; custom
        // sortOrder uses 10/20/30/… so we can interleave later if needed.
        sortOrder: idx,
      });
    });

    // Custom user-added lines (lineKey starts with "custom-").
    for (const m of mappings) {
      if (!m.lineKey.startsWith("custom-")) continue;
      const group = m.customGroup ?? "current-assets";
      const meta = GROUP_META[group];
      if (!meta) continue; // unknown group — skip defensively
      out.push({
        key: m.lineKey,
        section: meta.section,
        group,
        groupLabel: meta.groupLabel,
        label: m.customLabel?.trim() || "Нэргүй мөр",
        accountNumbers: m.accountNumbers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        sign: meta.sign,
        isHidden: m.isHidden,
        isCustom: true,
        sortOrder: m.sortOrder,
      });
    }

    return out;
  }, [mappings, mappingByKey, accounts]);

  // ── Raw balances at main-account level ────────────────────────────────
  const rows = useMemo(
    () => aggregateBalances(vouchers, accounts, BALANCE_SHEET_KEY, EPOCH, appliedTo),
    [vouchers, accounts, appliedTo],
  );

  // ── Per-account closing balances (for the MappingDialog) ──────────────
  const accountBalances = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      map.set(r.mainAccount, r.totals.closeDebit - r.totals.closeCredit);
    }
    return map;
  }, [rows]);

  // ── Per-line amount + grouped structure ───────────────────────────────
  const data = useMemo(() => {
    const debitNet = (r: BalanceRow) => r.totals.closeDebit - r.totals.closeCredit;
    const creditNet = (r: BalanceRow) => r.totals.closeCredit - r.totals.closeDebit;
    const byMainAccount = new Map<string, BalanceRow>();
    for (const r of rows) byMainAccount.set(r.mainAccount, r);

    const computeAmount = (line: ResolvedLine): number => {
      let amount = 0;
      for (const code of line.accountNumbers) {
        const r = byMainAccount.get(code);
        if (!r) continue;
        amount += line.sign === "debit" ? debitNet(r) : creditNet(r);
      }
      return amount;
    };

    const groupBySection: Record<BsSection, Map<string, GroupComputed>> = {
      assets: new Map(),
      liabilities: new Map(),
      equity: new Map(),
    };

    for (const line of resolvedLines) {
      const amount = computeAmount(line);
      const groupMap = groupBySection[line.section];
      if (!groupMap.has(line.group)) {
        groupMap.set(line.group, {
          groupId: line.group,
          groupLabel: line.groupLabel,
          lines: [],
          subtotal: 0,
        });
      }
      const g = groupMap.get(line.group)!;
      g.lines.push({ ...line, amount });
      // Subtotal includes hidden lines too — hiding only affects display.
      g.subtotal += amount;
    }

    // Sort within each group by sortOrder.
    Object.values(groupBySection).forEach((groupMap) =>
      groupMap.forEach((g) => g.lines.sort((a, b) => a.sortOrder - b.sortOrder))
    );

    const buildSection = (s: BsSection): SectionComputed => {
      const groups = [...groupBySection[s].values()];
      const total = groups.reduce((sum, g) => sum + g.subtotal, 0);
      return { sectionId: s, sectionLabel: SECTION_LABEL[s], groups, total };
    };

    const assets = buildSection("assets");
    const liabilities = buildSection("liabilities");
    const equity = buildSection("equity");

    const pnl = computeNetIncome(rows);
    const totalEquity = equity.total + pnl.netIncome;
    const totalLiabAndEquity = liabilities.total + totalEquity;

    return {
      assets,
      liabilities,
      equity,
      pnl,
      totalAssets: assets.total,
      totalLiabilities: liabilities.total,
      totalEquity,
      totalLiabAndEquity,
    };
  }, [rows, resolvedLines]);

  const balanced = isBalanced(data.totalAssets, data.totalLiabAndEquity);

  // ── Build the flat ReportRow[] ────────────────────────────────────────
  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    // Whether a line should be visible at all (not just hidden styling).
    const lineVisible = (line: ComputedLine): boolean => {
      if (line.isHidden) return showHidden;
      // Zero amount → show only if explicitly mapped (user-pinned) or custom.
      if (line.amount === 0 && !mappingByKey.has(line.key) && !line.isCustom) return false;
      return true;
    };

    const emitSection = (
      sec: SectionComputed,
      totalLabel: string,
      opts: { useGroups: boolean }
    ) => {
      const sectionRowId = `sec-${sec.sectionId}`;
      out.push({ id: sectionRowId, kind: "section", label: sec.sectionLabel });

      const allLinesFlat = sec.groups.flatMap((g) => g.lines);
      const anyVisible = allLinesFlat.some(lineVisible);
      if (!anyVisible) {
        out.push({
          id: `empty-${sec.sectionId}`,
          kind: "empty",
          label: "Өгөгдөл байхгүй",
          parentSectionId: sectionRowId,
        });
      } else if (opts.useGroups) {
        for (const g of sec.groups) {
          const visibleLines = g.lines.filter(lineVisible);
          if (visibleLines.length === 0) continue;
          const groupRowId = `grp-${sec.sectionId}-${g.groupId}`;
          out.push({
            id: groupRowId,
            kind: "group",
            label: g.groupLabel,
            parentSectionId: sectionRowId,
          });
          for (const line of visibleLines) {
            out.push({
              id: `det-${line.key}`,
              kind: "detail",
              name: line.label,
              amount: line.amount,
              lineKey: line.key,
              isHidden: line.isHidden,
              isCustom: line.isCustom,
              parentSectionId: sectionRowId,
              parentGroupId: groupRowId,
            });
          }
          out.push({
            id: `sub-${sec.sectionId}-${g.groupId}`,
            kind: "subtotal",
            label: `${g.groupLabel} нийт`,
            amount: visibleLines.reduce((s, l) => s + l.amount, 0),
            parentSectionId: sectionRowId,
            parentGroupId: groupRowId,
          });
        }
      } else {
        // Equity: flat — no intermediate group rows.
        for (const g of sec.groups) {
          for (const line of g.lines) {
            if (!lineVisible(line)) continue;
            out.push({
              id: `det-${line.key}`,
              kind: "detail",
              name: line.label,
              amount: line.amount,
              lineKey: line.key,
              isHidden: line.isHidden,
              isCustom: line.isCustom,
              parentSectionId: sectionRowId,
            });
          }
        }
      }
      out.push({
        id: `tot-${sec.sectionId}`,
        kind: "total",
        label: totalLabel,
        amount: sec.total,
        parentSectionId: sectionRowId,
      });
    };

    emitSection(data.assets, "НИЙТ ХӨРӨНГӨ", { useGroups: true });
    emitSection(data.liabilities, "ӨР ТӨЛБӨРИЙН НИЙТ", { useGroups: true });

    // Equity uses flat layout; emit + append P/L line afterwards.
    emitSection(data.equity, "ЭЗДИЙН ӨМЧИЙН НИЙТ", { useGroups: false });

    // Period P/L sits inside the equity section (so it folds together).
    const lastEquityIdx = out.findIndex((r) => r.id === "tot-equity");
    if (lastEquityIdx >= 0) {
      out.splice(lastEquityIdx, 0, {
        id: "det-current-period-pnl",
        // No `lineKey` — this line is computed and not user-mappable.
        kind: "detail",
        name: `Тайлант үеийн цэвэр ${data.pnl.netIncome >= 0 ? "ашиг" : "алдагдал"}`,
        amount: data.pnl.netIncome,
        amountSign: data.pnl.netIncome >= 0 ? "pos" : "neg",
        parentSectionId: "sec-equity",
      });
      // Fix `tot-equity` amount to include P/L
      out[lastEquityIdx + 1] = { ...out[lastEquityIdx + 1], amount: data.totalEquity };
    }

    out.push({
      id: "tot-le",
      kind: "total",
      label: "ӨР ТӨЛБӨР БА ЭЗДИЙН ӨМЧИЙН НИЙТ",
      amount: data.totalLiabAndEquity,
    });

    return out;
  }, [data, mappingByKey, showHidden]);

  // ── Collapse state (persisted in localStorage) ────────────────────────
  // Lazy initializer reads from localStorage on the client. SSR returns an
  // empty Set; the value is replaced before the first paint on hydration
  // so the effect body doesn't have to call setState (avoiding the
  // react-hooks/set-state-in-effect lint warning).
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...collapsedKeys]));
    } catch {
      /* ignore */
    }
  }, [collapsedKeys]);
  const toggleCollapse = (id: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Per-row action handlers ───────────────────────────────────────────
  const openLineResolved = openLineKey
    ? resolvedLines.find((l) => l.key === openLineKey)
    : null;

  const handleHide = (key: string) =>
    startTransition(async () => {
      await setLineHidden("balance-sheet", key, true);
    });
  const handleUnhide = (key: string) =>
    startTransition(async () => {
      await setLineHidden("balance-sheet", key, false);
    });
  const handleRemove = (key: string) =>
    startTransition(async () => {
      await removeCustomLine("balance-sheet", key);
    });

  const hiddenCount = resolvedLines.filter((l) => l.isHidden).length;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => setAddLineOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--ea-primary)] text-[var(--primary-foreground)] font-medium hover:bg-[var(--ea-primary-700)] transition-colors"
        >
          <Plus size={14} />
          Шинэ мөр
        </button>
        <label className="inline-flex items-center gap-1.5 text-[var(--ea-text-2)] cursor-pointer select-none ml-2">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="w-3.5 h-3.5 accent-[var(--ea-primary)]"
          />
          Нуусан мөр харах
          {hiddenCount > 0 && (
            <span className="text-[var(--ea-text-4)]">({hiddenCount})</span>
          )}
        </label>
      </div>

      <div className="flex-1 min-h-0">
        <ReportGrid
          activeSegments={activeSegments}
          rows={reportRows}
          hideAccount
          showLineNumbers
          onMappingClick={(key) => setOpenLineKey(key)}
          collapsedKeys={collapsedKeys}
          onToggleCollapse={toggleCollapse}
          onHideLine={handleHide}
          onUnhideLine={handleUnhide}
          onRemoveLine={handleRemove}
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

      {openLineResolved && (
        <MappingDialog
          open={!!openLineKey}
          onClose={() => setOpenLineKey(null)}
          reportType="balance-sheet"
          lineKey={openLineResolved.key}
          lineLabel={openLineResolved.label}
          initialAccounts={openLineResolved.accountNumbers}
          allAccounts={accounts}
          accountBalances={accountBalances}
        />
      )}

      <AddLineDialog
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        reportType="balance-sheet"
        groupOptions={GROUP_OPTIONS}
      />
    </div>
  );
}
