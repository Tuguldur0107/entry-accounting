"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  aggregateBalances,
  fmtMnt as fmt,
  isBalanced,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import { moneyValueFormatter } from "@/lib/grid/formatters";
import type { ColDef, ColGroupDef } from "ag-grid-community";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
}

interface BalanceRowVM {
  id: string;
  name: string;
  segs: Record<number, string>;
  openDebit: number;
  openCredit: number;
  periodDebit: number;
  periodCredit: number;
  closeDebit: number;
  closeCredit: number;
}

const NUM = {
  cellClass: "ag-right-aligned-cell font-mono",
  headerClass: "ag-right-aligned-header",
  valueFormatter: moneyValueFormatter,
  width: 120,
} satisfies Partial<ColDef<BalanceRowVM>>;

export function GlBalanceView({
  vouchers,
  accounts,
  activeSegIds,
  activeSegments,
  appliedFrom,
  appliedTo,
}: Props) {
  const rows = useMemo(
    () => aggregateBalances(vouchers, accounts, activeSegIds, appliedFrom, appliedTo),
    [vouchers, accounts, activeSegIds, appliedFrom, appliedTo],
  );

  const rowData: BalanceRowVM[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.activeKey,
        name: r.name,
        segs: r.segmentParts,
        openDebit: r.totals.openDebit,
        openCredit: r.totals.openCredit,
        periodDebit: r.totals.periodDebit,
        periodCredit: r.totals.periodCredit,
        closeDebit: r.totals.closeDebit,
        closeCredit: r.totals.closeCredit,
      })),
    [rows],
  );

  const totals = rows.reduce(
    (s, r) => ({
      openDebit: s.openDebit + r.totals.openDebit,
      openCredit: s.openCredit + r.totals.openCredit,
      periodDebit: s.periodDebit + r.totals.periodDebit,
      periodCredit: s.periodCredit + r.totals.periodCredit,
      closeDebit: s.closeDebit + r.totals.closeDebit,
      closeCredit: s.closeCredit + r.totals.closeCredit,
    }),
    {
      openDebit: 0,
      openCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      closeDebit: 0,
      closeCredit: 0,
    },
  );

  const openBalanced = isBalanced(totals.openDebit, totals.openCredit);
  const periodBalanced = isBalanced(totals.periodDebit, totals.periodCredit);
  const closeBalanced = isBalanced(totals.closeDebit, totals.closeCredit);

  const columnDefs = useMemo<(ColDef<BalanceRowVM> | ColGroupDef<BalanceRowVM>)[]>(() => {
    const segCols: ColDef<BalanceRowVM>[] = activeSegments.map((s) => ({
      headerName: s.nameMn,
      colId: `seg-${s.id}`,
      valueGetter: (p) => p.data?.segs[s.id] ?? "",
      cellClass: "font-mono",
      width: 120,
      sortable: true,
    }));

    return [
      ...segCols,
      {
        headerName: "Үндсэн дансны нэр",
        field: "name",
        flex: 1,
        minWidth: 220,
        sortable: true,
      },
      {
        headerName: "Эхний үлдэгдэл",
        children: [
          { headerName: "Дебет", field: "openDebit", ...NUM },
          { headerName: "Кредит", field: "openCredit", ...NUM },
        ],
      },
      {
        headerName: "Гүйлгээ",
        children: [
          { headerName: "Дебет", field: "periodDebit", ...NUM },
          { headerName: "Кредит", field: "periodCredit", ...NUM },
        ],
      },
      {
        headerName: "Эцсийн үлдэгдэл",
        children: [
          { headerName: "Дебет", field: "closeDebit", ...NUM, cellClass: "ag-right-aligned-cell font-mono font-semibold" },
          { headerName: "Кредит", field: "closeCredit", ...NUM, cellClass: "ag-right-aligned-cell font-mono font-semibold" },
        ],
      },
    ];
  }, [activeSegments]);

  const pinnedBottom = useMemo<BalanceRowVM[]>(
    () => [
      {
        id: "__total__",
        name: "Нийт дүн",
        segs: {},
        openDebit: totals.openDebit,
        openCredit: totals.openCredit,
        periodDebit: totals.periodDebit,
        periodCredit: totals.periodCredit,
        closeDebit: totals.closeDebit,
        closeCredit: totals.closeCredit,
      },
    ],
    [totals],
  );

  return (
    <>
      <EaGridDynamic<BalanceRowVM>
        rowData={rowData}
        columnDefs={columnDefs}
        getRowId={(p) => p.data.id}
        pinnedBottomRowData={pinnedBottom}
        height={Math.min(600, 120 + rowData.length * 36 + 48)}
        overlayNoRowsTemplate='<span style="color:var(--ea-text-4); font-size:12px;">Өгөгдөл байхгүй</span>'
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
      />

      <div className="flex items-center justify-end gap-4 mt-3 text-xs">
        <BalanceIndicator
          label="Эхний"
          balanced={openBalanced}
          diff={Math.abs(totals.openDebit - totals.openCredit)}
        />
        <BalanceIndicator
          label="Гүйлгээ"
          balanced={periodBalanced}
          diff={Math.abs(totals.periodDebit - totals.periodCredit)}
        />
        <BalanceIndicator
          label="Эцсийн"
          balanced={closeBalanced}
          diff={Math.abs(totals.closeDebit - totals.closeCredit)}
        />
      </div>
    </>
  );
}

function BalanceIndicator({
  label,
  balanced,
  diff,
}: {
  label: string;
  balanced: boolean;
  diff: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[#6B6B63]">{label}:</span>
      <span className={`w-1.5 h-1.5 rounded-full ${balanced ? "bg-[#059669]" : "bg-[#DC2626]"}`} />
      <span className={`font-medium ${balanced ? "text-[#047857]" : "text-[#B91C1C]"}`}>
        {balanced ? "Тэнцсэн" : `Зөрүү ${fmt(diff)}`}
      </span>
    </div>
  );
}
