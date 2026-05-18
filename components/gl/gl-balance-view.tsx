"use client";

import { useMemo } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  aggregateBalances,
  fmtMnt as fmt,
  isBalanced,
} from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";

interface Props {
  vouchers: JournalVoucherWithLines[];
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  activeSegments: SegmentDef[];
  appliedFrom: string;
  appliedTo: string;
}

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

  const segmentColCount = activeSegments.length + 1;

  return (
    <>
      <div className="bg-white border border-[#E5E5DE] rounded-md overflow-x-auto">
        <Table>
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE] hover:bg-[#F4F4EE]">
              {activeSegments.map((s) => (
                <TableHead
                  key={s.id}
                  rowSpan={2}
                  className="px-3 py-2.5 text-left whitespace-nowrap"
                  style={{ borderRight: "1px solid var(--ea-border)" }}
                >
                  {s.nameMn}
                </TableHead>
              ))}
              <TableHead
                rowSpan={2}
                className="px-3 py-2.5 text-left whitespace-nowrap"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Үндсэн дансны нэр
              </TableHead>
              <TableHead
                colSpan={2}
                className="px-3 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Эхний үлдэгдэл
              </TableHead>
              <TableHead
                colSpan={2}
                className="px-3 py-2 text-center border-b border-[#E5E5DE]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Гүйлгээ
              </TableHead>
              <TableHead colSpan={2} className="px-3 py-2 text-center border-b border-[#E5E5DE]">
                Эцсийн үлдэгдэл
              </TableHead>
            </TableRow>
            <TableRow className="bg-[#F4F4EE] text-xs text-[#666] font-medium hover:bg-[#F4F4EE]">
              <TableHead className="px-3 py-2 text-right w-[110px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Дебет</TableHead>
              <TableHead className="px-3 py-2 text-right w-[110px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Кредит</TableHead>
              <TableHead className="px-3 py-2 text-right w-[110px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Дебет</TableHead>
              <TableHead className="px-3 py-2 text-right w-[110px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Кредит</TableHead>
              <TableHead className="px-3 py-2 text-right w-[110px]" style={{ borderRight: "1px solid var(--ea-border)" }}>Дебет</TableHead>
              <TableHead className="px-3 py-2 text-right w-[110px]">Кредит</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={segmentColCount + 6}
                  className="px-4 py-10 text-center text-[#aaa]"
                >
                  Өгөгдөл байхгүй
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.activeKey}
                  className="border-t border-[#E8E8E0] hover:bg-[#fafafa]"
                >
                  {activeSegments.map((s) => (
                    <TableCell
                      key={s.id}
                      className="px-3 py-2 font-mono text-xs text-[#555] whitespace-nowrap"
                      style={{ borderRight: "1px solid var(--ea-border)" }}
                    >
                      {r.segmentParts[s.id] ?? ""}
                    </TableCell>
                  ))}
                  <TableCell
                    className="px-3 py-2 text-[#1A1A19]"
                    style={{ borderRight: "1px solid var(--ea-border)" }}
                  >
                    {r.name || <span className="text-[#aaa]">—</span>}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(r.totals.openDebit)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(r.totals.openCredit)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(r.totals.periodDebit)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(r.totals.periodCredit)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums font-medium" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(r.totals.closeDebit)}</TableCell>
                  <TableCell className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.totals.closeCredit)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
            <TableRow style={{ borderTop: "2px solid var(--ea-border-strong)", background: "var(--ea-bg-2)" }}>
              <TableCell
                colSpan={segmentColCount}
                className="px-3 py-2.5 text-sm font-semibold text-[#1E3A5F]"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                Нийт дүн
              </TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(totals.openDebit)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(totals.openCredit)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(totals.periodDebit)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(totals.periodCredit)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ borderRight: "1px solid var(--ea-border)" }}>{fmt(totals.closeDebit)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(totals.closeCredit)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

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
