"use client";

// Мөнгөн гүйлгээний тайлан — Орлогын тайлантай (income-statement-view) ижил
// MAPPING-тай: мөр бүр CF_LINES-ийн default prefix-ээс данс татаж, хэрэглэгч
// мөр бүрийг MappingDialog-оор данс + S8 мөнгөн урсгалын кодоор override хийнэ
// (report_line_mappings, reportType="cash-flow"). Аль ч мөрөнд таараагүй
// урсгал секц бүрийн "Ангилагдаагүй" мөрөнд ИЛ харагддаг тул
// "Эхний + Цэвэр = Эцсийн" тулгалт mapping-аас үл хамааран хадгалагдана.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import type {
  ChartOfAccount,
  JournalVoucherWithLines,
  ReportLineMapping,
} from "@/lib/db/schema";
import { fmtMnt as fmt } from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import {
  CF_SECTION_LABEL,
  CF_SUBTOTAL_LABEL,
  buildMappedCashFlow,
  computeContraFlows,
  resolveCfLines,
  type CfComputedLine,
  type CfSection,
} from "@/lib/reports/cf-lines";
import { ReportGrid, type ReportRow } from "./report-grid";
import { MappingDialog } from "./mapping-dialog";
import { AddLineDialog } from "./add-line-dialog";
import { setLineHidden, removeCustomLine } from "@/lib/actions/report-mappings";

interface Props {
  /**
   * П28: журнал бүрийн контра хослол шаардлагатай тул CF snapshot-оор
   * орлуулагдахгүй — гэхдээ зөвхөн [from,to] доторх ваучерууд ирнэ;
   * кассын нээлт/хаалт сервер талд [3] мөрүүдээс бодогдож ирдэг.
   */
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
  cashOpenNet: number;
  cashCloseNet: number;
  mappings: ReportLineMapping[];
  /** S8 мөнгөн урсгалын сегментийн идэвхтэй утгууд — MappingDialog-ийн CF таб. */
  cfSegmentValues: { code: string; name: string }[];
}

const GROUP_OPTIONS: { value: CfSection; label: string }[] = [
  { value: "operating", label: "Үйл ажиллагаа" },
  { value: "investing", label: "Хөрөнгө оруулалт" },
  { value: "financing", label: "Санхүү" },
];

const COLLAPSE_STORAGE_KEY = "ea-cash-flow-collapsed";

const SECTIONS: readonly CfSection[] = ["operating", "investing", "financing"];

export function CashFlowView({
  vouchers,
  accounts,
  activeSegments,
  appliedFrom,
  appliedTo,
  cashOpenNet,
  cashCloseNet,
  mappings,
  cfSegmentValues,
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

  const resolvedLines = useMemo(
    () => resolveCfLines(mappings, accounts),
    [mappings, accounts]
  );

  const report = useMemo(
    () => buildMappedCashFlow(vouchers, appliedFrom, appliedTo, resolvedLines),
    [vouchers, appliedFrom, appliedTo, resolvedLines]
  );

  // MappingDialog-ийн жагсаалтад данс/S8 код бүрийн тайлант үеийн урсгалыг
  // харуулна — нягтлан нэрээс гадна дүнгээр нь баримжаалж сонгоно.
  const contraFlows = useMemo(
    () => computeContraFlows(vouchers, appliedFrom, appliedTo),
    [vouchers, appliedFrom, appliedTo]
  );

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    const lineVisible = (line: CfComputedLine): boolean => {
      if (line.isHidden) return showHidden;
      if (line.amount === 0 && !mappingByKey.has(line.key) && !line.isCustom)
        return false;
      return true;
    };

    for (const sectionId of SECTIONS) {
      const sec = report.sections[sectionId];
      const sectionRowId = `sec-${sectionId}`;
      out.push({
        id: sectionRowId,
        kind: "section",
        label: CF_SECTION_LABEL[sectionId],
      });

      const visibleLines = sec.lines.filter(lineVisible);
      const hasUnmapped = Math.abs(sec.unmapped) > 0.005;
      if (visibleLines.length === 0 && !hasUnmapped) {
        out.push({
          id: `empty-${sectionId}`,
          kind: "empty",
          label: "Бичилт байхгүй",
          parentSectionId: sectionRowId,
        });
      } else {
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
          });
        }
        if (hasUnmapped) {
          // lineKey байхгүй тул mapping/нуух товч гарахгүй — mapping хийгээгүй
          // урсгал энд ИЛ үлддэг учир нийт тулгалт хэзээ ч алдагдахгүй.
          out.push({
            id: `unmapped-${sectionId}`,
            kind: "detail",
            name: "Ангилагдаагүй урсгал",
            amount: sec.unmapped,
            parentSectionId: sectionRowId,
          });
        }
      }

      // Subtotal нь НУУСАН мөрийн дүнг ч агуулна (sec.subtotal) — эс бөгөөс
      // мөр нуухад "Эхний + Цэвэр = Эцсийн" тулгалт алдагдана.
      out.push({
        id: `sub-${sectionId}`,
        kind: "subtotal",
        label: CF_SUBTOTAL_LABEL[sectionId],
        amount: sec.subtotal,
        parentSectionId: sectionRowId,
      });
    }

    out.push({
      id: "tot-cash",
      kind: "total",
      label: "ЦЭВЭР МӨНГӨН УРСГАЛ",
      amount: report.totals.net,
      amountSign: report.totals.net >= 0 ? "pos" : "neg",
    });
    out.push({
      id: "open-cash",
      kind: "footnote",
      label: "Эхний касс үлдэгдэл",
      amount: cashOpenNet,
    });
    out.push({
      id: "close-cash",
      kind: "subtotal",
      label: "Эцсийн касс үлдэгдэл",
      amount: cashCloseNet,
    });

    return out;
  }, [report, mappingByKey, showHidden, cashOpenNet, cashCloseNet]);

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
      await setLineHidden("cash-flow", key, true);
    });
  const handleUnhide = (key: string) =>
    startTransition(async () => {
      await setLineHidden("cash-flow", key, false);
    });
  const handleRemove = (key: string) =>
    startTransition(async () => {
      await removeCustomLine("cash-flow", key);
    });

  const hiddenCount = resolvedLines.filter((l) => l.isHidden).length;

  // Тулгалт: Эхний + Цэвэр = Эцсийн. Урсгал бүр яг нэг мөрөнд ордог тул
  // энэ зөрөх нь mapping биш, өгөгдлийн асуудал (жишээ нь кассын шууд
  // залруулга) — ИЛ харуулна.
  const reconGap =
    Math.round((cashOpenNet + report.totals.net - cashCloseNet) * 100) / 100;
  const unmappedTotal = SECTIONS.reduce(
    (s, sec) => s + Math.abs(report.sections[sec].unmapped),
    0
  );

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

      <div className="flex items-center justify-end gap-4 text-xs shrink-0">
        {Math.abs(reconGap) > 0.01 && (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--ea-danger)]" />
            <span className="font-medium text-[var(--ea-danger-fg)]">
              Эхний + Цэвэр ≠ Эцсийн · зөрүү {fmt(reconGap)}
            </span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              unmappedTotal <= 0.005
                ? "bg-[var(--ea-success)]"
                : "bg-[var(--ea-warning)]"
            }`}
          />
          <span
            className={`font-medium ${
              unmappedTotal <= 0.005
                ? "text-[var(--ea-success-fg)]"
                : "text-[var(--ea-warning-fg)]"
            }`}
          >
            {unmappedTotal <= 0.005
              ? "Бүх урсгал мөрөнд орсон"
              : `Ангилагдаагүй урсгал ${fmt(unmappedTotal)}`}
          </span>
        </span>
      </div>

      {openLineResolved && (
        <MappingDialog
          open={!!openLineKey}
          onClose={() => setOpenLineKey(null)}
          reportType="cash-flow"
          lineKey={openLineResolved.key}
          lineLabel={openLineResolved.label}
          initialAccounts={openLineResolved.accountNumbers}
          allAccounts={accounts}
          accountBalances={contraFlows.byAccount}
          cfOptions={cfSegmentValues}
          initialCfCodes={openLineResolved.cfCodes}
          cfFlows={contraFlows.byCfCode}
        />
      )}

      <AddLineDialog
        open={addLineOpen}
        onClose={() => setAddLineOpen(false)}
        reportType="cash-flow"
        groupOptions={GROUP_OPTIONS}
      />
    </div>
  );
}
