"use client";

import { useMemo, useState } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { GlBalanceView } from "@/components/gl/gl-balance-view";
import { BalanceSheetView } from "@/components/gl/balance-sheet-view";
import { IncomeStatementView } from "@/components/gl/income-statement-view";
import { CashFlowView } from "@/components/gl/cash-flow-view";

const today = new Date().toISOString().slice(0, 10);
const firstOfMonth = today.slice(0, 7) + "-01";

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
}

export function ReportsView({ vouchers, accounts, activeSegIds }: Props) {
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [appliedFrom, setAppliedFrom] = useState(firstOfMonth);
  const [appliedTo, setAppliedTo] = useState(today);
  const [reportType, setReportType] = useState<ReportType>("gl-balance");

  function handleSearch() {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  }

  const activeSegments = useMemo(
    () => SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id)),
    [activeSegIds],
  );

  return (
    <>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[var(--ea-text-3)] whitespace-nowrap">Эхлэх огноо</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 px-2 text-sm border border-[var(--ea-border)] rounded-md bg-white text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[var(--ea-primary)]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-[var(--ea-text-3)] whitespace-nowrap">Дуусах огноо</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 px-2 text-sm border border-[var(--ea-border)] rounded-md bg-white text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[var(--ea-primary)]"
          />
        </div>
        <select
          value={reportType}
          onChange={(e) => setReportType(e.target.value as ReportType)}
          className="h-8 px-2 text-sm border border-[var(--ea-border)] rounded-md bg-white text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[#1E3A5F]/20 focus:border-[var(--ea-primary)]"
        >
          {REPORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          className="h-8 px-4 text-sm font-medium bg-[var(--ea-primary)] text-white rounded-md hover:bg-[var(--ea-primary-700)] transition-colors"
        >
          Хайх
        </button>
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
    </>
  );
}
