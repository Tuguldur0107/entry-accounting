"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
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

const REPORT_OPTIONS: { value: ReportType; label: string }[] = [
  { value: "gl-balance", label: "Гүйлгээ баланс" },
  { value: "balance-sheet", label: "Баланс" },
  { value: "income-statement", label: "Орлогын тайлан" },
  { value: "cash-flow", label: "Мөнгөн гүйлгээний тайлан" },
];

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  initialStart?: string;
  initialEnd?: string;
  initialReport?: string;
}

// Date range filter lives in the dashboard header (HeaderJournalSearch) —
// this view only owns the report-type selector. The current `start` / `end`
// flow through page props from URL searchParams, so toggling reports keeps
// the same date range without an extra inline toolbar.
export function ReportsView({
  vouchers,
  accounts,
  activeSegIds,
  initialStart,
  initialEnd,
  initialReport,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const defaults = defaultMonthRange();
  const appliedFrom = initialStart ?? defaults.start;
  const appliedTo = initialEnd ?? defaults.end;

  const initialType: ReportType =
    REPORT_OPTIONS.some((o) => o.value === initialReport)
      ? (initialReport as ReportType)
      : "gl-balance";

  const [reportType, setReportType] = useState<ReportType>(initialType);

  function handleReportChange(next: ReportType) {
    setReportType(next);
    // Persist selection in the URL so refresh / direct links remember it.
    const params = new URLSearchParams(searchParams.toString());
    params.set("report", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const activeSegments = useMemo(
    () => SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id)),
    [activeSegIds],
  );

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <select
          value={reportType}
          onChange={(e) => handleReportChange(e.target.value as ReportType)}
          className="h-8 px-2 text-sm border border-[var(--ea-border)] rounded-md bg-[var(--ea-surface)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
        >
          {REPORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {reportType === "gl-balance" && (
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
