"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines, ReportLineMapping } from "@/lib/db/schema";
import { GL_REPORT_VALUES } from "@/lib/constants/report-registry";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { GlBalanceView } from "@/components/gl/gl-balance-view";
import { BalanceSheetView } from "@/components/gl/balance-sheet-view";
import { IncomeStatementView } from "@/components/gl/income-statement-view";
import { CashFlowView } from "@/components/gl/cash-flow-view";

function defaultMonthRange() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end: `${y}-${m}-${String(lastDay).padStart(2, "0")}`,
  };
}

type ReportType = "gl-balance" | "balance-sheet" | "income-statement" | "cash-flow";
// Хүчинтэй утгууд registry-ээс — header-ийн сонгогчтой НЭГ эх сурвалж.
const VALID_REPORTS = new Set(GL_REPORT_VALUES);

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  initialStart?: string;
  initialEnd?: string;
  initialReport?: string;
  /** Per-line GL-account overrides loaded from `report_line_mappings`. */
  balanceSheetMappings: ReportLineMapping[];
  incomeStatementMappings: ReportLineMapping[];
}

// All toolbar controls live in the dashboard header:
//   - date range  → topbar-ийн PeriodFilter (cookie, PTD/QTD/YTD)
//   - report type → HeaderReportSelect (only on /gl/reports)
// This view simply receives the active range + report from URL search params
// (via the page server component) and renders the matching report grid.
export function ReportsView({
  vouchers,
  accounts,
  activeSegIds,
  initialStart,
  initialEnd,
  initialReport,
  balanceSheetMappings,
  incomeStatementMappings,
}: Props) {
  const defaults = defaultMonthRange();
  const appliedFrom = initialStart ?? defaults.start;
  const appliedTo = initialEnd ?? defaults.end;

  const reportType: ReportType = VALID_REPORTS.has(initialReport ?? "")
    ? (initialReport as ReportType)
    : "gl-balance";

  const activeSegments = useMemo(
    () => SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id)),
    [activeSegIds],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Танигдаагүй утга (registry-д нэмэгдсэн ч view нь хараахан байхгүй
          шинэ тайлан) хоосон дэлгэц биш Гүйлгээ баланс руу унана. */}
      {reportType !== "balance-sheet" &&
        reportType !== "income-statement" &&
        reportType !== "cash-flow" && (
        <GlBalanceView
          vouchers={vouchers}
          accounts={accounts}
          activeSegIds={activeSegIds}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
        />
      )}
      {reportType === "balance-sheet" && (
        <BalanceSheetView
          vouchers={vouchers}
          accounts={accounts}
          activeSegIds={activeSegIds}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          mappings={balanceSheetMappings}
        />
      )}
      {reportType === "income-statement" && (
        <IncomeStatementView
          vouchers={vouchers}
          accounts={accounts}
          activeSegIds={activeSegIds}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          mappings={incomeStatementMappings}
        />
      )}
      {reportType === "cash-flow" && (
        <CashFlowView
          vouchers={vouchers}
          accounts={accounts}
          activeSegIds={activeSegIds}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
        />
      )}
    </div>
  );
}
