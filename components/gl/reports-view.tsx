"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines, ReportLineMapping } from "@/lib/db/schema";
import type { BalanceRow } from "@/lib/reports/balances";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { GlBalanceView } from "@/components/gl/gl-balance-view";
import { BalanceSheetView } from "@/components/gl/balance-sheet-view";
import { IncomeStatementView } from "@/components/gl/income-statement-view";
import { CashFlowView } from "@/components/gl/cash-flow-view";

// П28: тайлан бүрийн өгөгдөл СЕРВЕРТ нэгтгэгдэж ирнэ (snapshot + SQL delta,
// app/(dashboard)/gl/reports/page.tsx). Аль тайлан идэвхтэйг data.kind
// шийднэ — сонголт өөрчлөгдөхөд URL солигдож server шинэ өгөгдөл өгнө.
export type ReportData =
  | { kind: "gl-balance"; rows: BalanceRow[] }
  | { kind: "balance-sheet"; rows: BalanceRow[] }
  | { kind: "income-statement"; rows: BalanceRow[] }
  | {
      kind: "cash-flow";
      /** Зөвхөн [from,to] доторх ваучерууд — контра хослолд хэрэгтэй. */
      vouchers: JournalVoucherWithLines[];
      cashOpenNet: number;
      cashCloseNet: number;
    };

interface Props {
  data: ReportData;
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  appliedFrom: string;
  appliedTo: string;
  /** Per-line GL-account overrides loaded from `report_line_mappings`. */
  balanceSheetMappings: ReportLineMapping[];
  incomeStatementMappings: ReportLineMapping[];
}

// All toolbar controls live in the dashboard header:
//   - date range  → topbar-ийн PeriodFilter (cookie, PTD/QTD/YTD)
//   - report type → HeaderReportSelect (only on /gl/reports)
// This view simply receives the server-aggregated data + active range from
// the page server component and renders the matching report grid.
export function ReportsView({
  data,
  accounts,
  activeSegIds,
  appliedFrom,
  appliedTo,
  balanceSheetMappings,
  incomeStatementMappings,
}: Props) {
  const activeSegments = useMemo(
    () => SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id)),
    [activeSegIds],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {data.kind === "gl-balance" && (
        <GlBalanceView rows={data.rows} activeSegments={activeSegments} />
      )}
      {data.kind === "balance-sheet" && (
        <BalanceSheetView
          rows={data.rows}
          accounts={accounts}
          activeSegments={activeSegments}
          mappings={balanceSheetMappings}
        />
      )}
      {data.kind === "income-statement" && (
        <IncomeStatementView
          rows={data.rows}
          accounts={accounts}
          activeSegments={activeSegments}
          mappings={incomeStatementMappings}
        />
      )}
      {data.kind === "cash-flow" && (
        <CashFlowView
          vouchers={data.vouchers}
          accounts={accounts}
          activeSegIds={activeSegIds}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          cashOpenNet={data.cashOpenNet}
          cashCloseNet={data.cashCloseNet}
        />
      )}
    </div>
  );
}
