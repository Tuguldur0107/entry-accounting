"use client";

// Орлогын тайлан — Балансын (balance-sheet-view) загвараар MAPPING-тай:
// мөр бүр IS_LINES-ийн default prefix-ээс данс татаж, хэрэглэгч мөр бүрийн
// дансыг MappingDialog-оор override хийнэ (report_line_mappings,
// reportType="income-statement"). Данс түвшний задаргаа Гүйлгээ балансад.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import type {
  ChartOfAccount,
  JournalVoucherWithLines,
  ReportLineMapping,
} from "@/lib/db/schema";
import {
  aggregateBalances,
  computeNetIncome,
  fmtMnt as fmt,
  type BalanceRow,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { IS_LINES, type IsSection, type IsSign } from "@/lib/reports/is-lines";
import { ReportGrid, type ReportRow } from "./report-grid";
import { MappingDialog } from "./mapping-dialog";
import { AddLineDialog } from "./add-line-dialog";
import { setLineHidden, removeCustomLine } from "@/lib/actions/report-mappings";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
  mappings: ReportLineMapping[];
}

// Орлогын тайлан мөн байгууллагын түвшний тайлан — үндсэн данс (S3)-аар
// нэгтгэнэ; сегмент задаргаа Гүйлгээ балансад үлдэнэ (BS-тэй ижил зарчим).
const INCOME_STATEMENT_KEY: number[] = [3];

const GROUP_META: Record<
  string,
  { section: IsSection; sign: IsSign; groupLabel: string }
> = {};
for (const line of IS_LINES) {
  if (!GROUP_META[line.group]) {
    GROUP_META[line.group] = {
      section: line.section,
      sign: line.sign,
      groupLabel: line.groupLabel,
    };
  }
}

const GROUP_OPTIONS = Object.entries(GROUP_META).map(([value, meta]) => ({
  value,
  label: meta.groupLabel,
}));

const COLLAPSE_STORAGE_KEY = "ea-income-statement-collapsed";

const SECTION_LABEL: Record<IsSection, string> = {
  revenue: "ОРЛОГО",
  expense: "ЗАРДАЛ",
};

interface ResolvedLine {
  key: string;
  section: IsSection;
  group: string;
  groupLabel: string;
  label: string;
  accountNumbers: string[];
  sign: IsSign;
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
  subtotal: number;
}

export function IncomeStatementView({
  vouchers,
  accounts,
  activeSegments,
  appliedFrom,
  appliedTo,
  mappings,
}: Props) {
  const [showHidden, setShowHidden] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [openLineKey, setOpenLineKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const mappingByKey = useMemo(() => {
    const m = new Map<string, ReportLineMapping>();
    for (const row of mappings) m.set(row.lineKey, row);
    return m;
  }, [mappings]);

  const resolvedLines = useMemo<ResolvedLine[]>(() => {
    const out: ResolvedLine[] = [];
    IS_LINES.forEach((line, idx) => {
      const m = mappingByKey.get(line.key);
      // Хоосон accountNumbers нь override БИШ — нуух/нэр солих үйлдэл mapping
      // мөрийг хоосон дансаар үүсгэдэг тул "" -ийг default-даа үлдээнэ
      // (эс бөгөөс нуусан мөр дүнгээ алдаж, нийт дүн өөрчлөгддөг байсан).
      const override =
        m && m.accountNumbers.trim() !== ""
          ? m.accountNumbers
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
      const accountNumbers =
        override !== undefined
          ? override
          : accounts
              .filter((a) =>
                line.defaultPrefixes.some((p) => a.number.startsWith(p))
              )
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
        sortOrder: idx,
      });
    });

    for (const m of mappings) {
      if (!m.lineKey.startsWith("custom-")) continue;
      const group = m.customGroup ?? "opex";
      const meta = GROUP_META[group];
      if (!meta) continue;
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

  // Тайлант үеийн эргэлт — үндсэн дансны түвшинд.
  const rows = useMemo(
    () =>
      aggregateBalances(
        vouchers,
        accounts,
        INCOME_STATEMENT_KEY,
        appliedFrom,
        appliedTo
      ),
    [vouchers, accounts, appliedFrom, appliedTo]
  );

  // MappingDialog-ийн данс бүрийн дүн — тайлант үеийн цэвэр эргэлт
  // (Dr − Cr: зардал эерэг, орлого сөрөг харагдана).
  const accountBalances = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows)
      map.set(r.mainAccount, r.totals.periodDebit - r.totals.periodCredit);
    return map;
  }, [rows]);

  const data = useMemo(() => {
    const byMainAccount = new Map<string, BalanceRow>();
    for (const r of rows) byMainAccount.set(r.mainAccount, r);

    const computeAmount = (line: ResolvedLine): number => {
      let amount = 0;
      for (const code of line.accountNumbers) {
        const r = byMainAccount.get(code);
        if (!r) continue;
        amount +=
          line.sign === "credit"
            ? r.totals.periodCredit - r.totals.periodDebit
            : r.totals.periodDebit - r.totals.periodCredit;
      }
      return amount;
    };

    const groupBySection: Record<IsSection, Map<string, GroupComputed>> = {
      revenue: new Map(),
      expense: new Map(),
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
      g.subtotal += amount;
    }
    Object.values(groupBySection).forEach((groupMap) =>
      groupMap.forEach((g) => g.lines.sort((a, b) => a.sortOrder - b.sortOrder))
    );

    const revenueGroups = [...groupBySection.revenue.values()];
    const expenseGroups = [...groupBySection.expense.values()];
    const revenueTotal = revenueGroups.reduce((s, g) => s + g.subtotal, 0);
    const expenseTotal = expenseGroups.reduce((s, g) => s + g.subtotal, 0);
    const netIncome = revenueTotal - expenseTotal;

    // Хамгаалалт: mapping-д ороогүй орлого/зардлын дансны эргэлт — мөрөөс
    // гадуур үлдсэн дүнг ил харуулна (Балансын "Зөрүү" индикатортой ижил үүрэг).
    const mappedAccounts = new Set(
      resolvedLines.flatMap((line) => line.accountNumbers)
    );
    let unmappedAmount = 0;
    let unmappedCount = 0;
    // Тэмдэгтэй цэвэр (орлого +, зардал −) — ангиллын суурьтай тулгахад.
    let unmappedNetIncome = 0;
    for (const r of rows) {
      if (r.cls !== "revenue" && r.cls !== "expense") continue;
      if (mappedAccounts.has(r.mainAccount)) continue;
      const net =
        r.cls === "revenue"
          ? r.totals.periodCredit - r.totals.periodDebit
          : r.totals.periodDebit - r.totals.periodCredit;
      if (Math.abs(net) <= 0.005) continue;
      unmappedCount += 1;
      unmappedAmount += Math.abs(net);
      unmappedNetIncome += r.cls === "revenue" ? net : -net;
    }

    // Ангиллын суурь цэвэр ашиг (5/6/7/8 prefix) — mapped дүнтэй тулгаж
    // ДАВХАР mapping-ийг илрүүлнэ: данс хоёр мөрөнд орвол mapped нийлбэр
    // ангиллын суурийг давна (данс бүр ангилалдаа нэг л удаа тоологддог).
    const pnl = computeNetIncome(rows);
    const mappingGap =
      Math.round((netIncome + unmappedNetIncome - pnl.netIncome) * 100) / 100;

    return {
      revenueGroups,
      expenseGroups,
      revenueTotal,
      expenseTotal,
      netIncome,
      unmappedAmount,
      unmappedCount,
      mappingGap,
    };
  }, [rows, resolvedLines]);

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    const lineVisible = (line: ComputedLine): boolean => {
      if (line.isHidden) return showHidden;
      if (line.amount === 0 && !mappingByKey.has(line.key) && !line.isCustom)
        return false;
      return true;
    };

    const emitSection = (
      sectionId: IsSection,
      groups: GroupComputed[],
      totalLabel: string,
      total: number
    ) => {
      const sectionRowId = `sec-${sectionId}`;
      out.push({
        id: sectionRowId,
        kind: "section",
        label: SECTION_LABEL[sectionId],
      });
      const anyVisible = groups.some((g) => g.lines.some(lineVisible));
      if (!anyVisible) {
        out.push({
          id: `empty-${sectionId}`,
          kind: "empty",
          label: "Өгөгдөл байхгүй",
          parentSectionId: sectionRowId,
        });
      } else {
        for (const g of groups) {
          const visibleLines = g.lines.filter(lineVisible);
          if (visibleLines.length === 0) continue;
          const groupRowId = `grp-${sectionId}-${g.groupId}`;
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
            id: `sub-${sectionId}-${g.groupId}`,
            kind: "subtotal",
            label: `${g.groupLabel} нийт`,
            amount: visibleLines.reduce((s, l) => s + l.amount, 0),
            parentSectionId: sectionRowId,
            parentGroupId: groupRowId,
          });
        }
      }
      out.push({
        id: `tot-${sectionId}`,
        kind: "total",
        label: totalLabel,
        amount: total,
        parentSectionId: sectionRowId,
      });
    };

    emitSection("revenue", data.revenueGroups, "ОРЛОГЫН НИЙТ", data.revenueTotal);
    emitSection("expense", data.expenseGroups, "ЗАРДЛЫН НИЙТ", data.expenseTotal);

    out.push({
      id: "tot-ni",
      kind: "total",
      label: `ТАЙЛАНТ ҮЕИЙН ЦЭВЭР ${data.netIncome >= 0 ? "АШИГ" : "АЛДАГДАЛ"}`,
      amount: data.netIncome,
      amountSign: data.netIncome >= 0 ? "pos" : "neg",
    });

    return out;
  }, [data, mappingByKey, showHidden]);

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
      localStorage.setItem(
        COLLAPSE_STORAGE_KEY,
        JSON.stringify([...collapsedKeys])
      );
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

  const openLineResolved = openLineKey
    ? resolvedLines.find((l) => l.key === openLineKey)
    : null;

  const handleHide = (key: string) =>
    startTransition(async () => {
      await setLineHidden("income-statement", key, true);
    });
  const handleUnhide = (key: string) =>
    startTransition(async () => {
      await setLineHidden("income-statement", key, false);
    });
  const handleRemove = (key: string) =>
    startTransition(async () => {
      await removeCustomLine("income-statement", key);
    });

  const hiddenCount = resolvedLines.filter((l) => l.isHidden).length;

  return (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <div className="flex items-center gap-2 shrink-0 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => setAddLineOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-[var(--ea-primary)] text-[var(--primary-foreground)] font-medium hover:bg-[var(--ea-primary-700)] transition-colors"
        >
          <Icon name="add" size="sm" />
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

      {/* Mapping-ийн хоёр хамгаалалт: (1) мөрөнд ороогүй данс, (2) давхар
          mapping — mapped дүн ангиллын сууриас зөрвөл данс олон мөрөнд орсон. */}
      <div className="flex items-center justify-end gap-4 text-xs shrink-0">
        {Math.abs(data.mappingGap) > 0.01 && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ea-danger)]" />
            <span className="font-medium text-[var(--ea-danger-fg)]">
              Данс давхар мөрөнд орсон байж магадгүй · зөрүү {fmt(data.mappingGap)}
            </span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              data.unmappedCount === 0
                ? "bg-[var(--ea-success)]"
                : "bg-[var(--ea-warning)]"
            }`}
          />
          <span
            className={`font-medium ${
              data.unmappedCount === 0
                ? "text-[var(--ea-success-fg)]"
                : "text-[var(--ea-warning-fg)]"
            }`}
          >
            {data.unmappedCount === 0
              ? "Бүх орлого, зардлын данс мөрөнд орсон"
              : `${data.unmappedCount} данс мөрөнд ороогүй · ${fmt(data.unmappedAmount)}`}
          </span>
        </span>
      </div>

      {openLineResolved && (
        <MappingDialog
          open={!!openLineKey}
          onClose={() => setOpenLineKey(null)}
          reportType="income-statement"
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
        reportType="income-statement"
        groupOptions={GROUP_OPTIONS}
      />
    </div>
  );
}
