"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines, ReportLineMapping } from "@/lib/db/schema";
import type { BalanceRow } from "@/lib/reports/balances";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import { GlBalanceView } from "@/components/gl/gl-balance-view";
import { BalanceSheetView } from "@/components/gl/balance-sheet-view";
import { IncomeStatementView } from "@/components/gl/income-statement-view";
import { CashFlowView } from "@/components/gl/cash-flow-view";
import { EbalanceView } from "@/components/gl/ebalance-view";
import type { EbalanceReport } from "@/lib/reports/ebalance";
import {
  ReportHeader,
  ReportPage,
  reportRangeLabel,
} from "@/components/reports/report-layout";
import { REPORT_REGISTRY } from "@/lib/constants/report-registry";

// Гарчиг нь топбарын сонгогчтой ИЖИЛ нэр (нэг эх — registry).
const GL_TITLES = new Map(
  REPORT_REGISTRY.find((module) => module.moduleId === "gl")!.entries.map(
    (entry) => [entry.value, entry.label] as const
  )
);

// Баланс нь «аль өдрийн байдлаар» — муж биш, төгсгөлийн огноо.
const META: Record<ReportData["kind"], (from: string, to: string) => string> = {
  "gl-balance": (from, to) =>
    `${reportRangeLabel(from, to)} · эхний үлдэгдэл, гүйлгээ, эцсийн үлдэгдэл`,
  "balance-sheet": (_from, to) => `${to}-ны байдлаар`,
  "income-statement": (from, to) => reportRangeLabel(from, to),
  "cash-flow": (from, to) => reportRangeLabel(from, to),
  ebalance: (from, to) =>
    `${reportRangeLabel(from, to)} · Сангийн яамны e-Balance маягтын мөрөөр (СТ-1 … СТ-4) — мөр бүрийн Entry-ийн эх ил`,
};

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
      /** Журнал → кассын баримтын S8 код (SIM2-043). */
      voucherCfCodes: Record<string, string>;
      cashOpenNet: number;
      cashCloseNet: number;
    }
  | {
      kind: "ebalance";
      /** Серверт бодогдсон 4 маягт (lib/reports/ebalance.ts) — ваучер клиент рүү дамжихгүй. */
      report: EbalanceReport;
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
  cashFlowMappings: ReportLineMapping[];
  /** S8 мөнгөн урсгалын сегментийн идэвхтэй утгууд — CF mapping-ийн сонголт. */
  cfSegmentValues: { code: string; name: string }[];
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
  cashFlowMappings,
  cfSegmentValues,
}: Props) {
  const activeSegments = useMemo(
    () => SEGMENT_DEFS.filter((s) => activeSegIds.includes(s.id)),
    [activeSegIds],
  );

  return (
    <ReportPage>
      <ReportHeader
        title={GL_TITLES.get(data.kind) ?? "Тайлан"}
        meta={META[data.kind](appliedFrom, appliedTo)}
      />
      {data.kind === "gl-balance" && (
        <GlBalanceView rows={data.rows} activeSegments={activeSegments} />
      )}
      {data.kind === "balance-sheet" && (
        <BalanceSheetView
          rows={data.rows}
          accounts={accounts}
          activeSegments={activeSegments}
          mappings={balanceSheetMappings}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
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
      {data.kind === "ebalance" && <EbalanceView report={data.report} />}
      {data.kind === "cash-flow" && (
        <CashFlowView
          vouchers={data.vouchers}
          voucherCfCodes={data.voucherCfCodes}
          accounts={accounts}
          activeSegments={activeSegments}
          appliedFrom={appliedFrom}
          appliedTo={appliedTo}
          cashOpenNet={data.cashOpenNet}
          cashCloseNet={data.cashCloseNet}
          mappings={cashFlowMappings}
          cfSegmentValues={cfSegmentValues}
        />
      )}
    </ReportPage>
  );
}
