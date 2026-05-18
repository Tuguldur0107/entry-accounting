"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import {
  buildCashFlow,
  fmtMnt as fmt,
  type CashFlowLine,
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

export function CashFlowView({
  vouchers,
  accounts,
  activeSegIds,
  activeSegments,
  appliedFrom,
  appliedTo,
}: Props) {
  const cf = useMemo(
    () => buildCashFlow(vouchers, accounts, activeSegIds, appliedFrom, appliedTo),
    [vouchers, accounts, activeSegIds, appliedFrom, appliedTo],
  );

  const segCount = activeSegments.length;
  const colCount = segCount + 2;
  const openCash = cf.cashOpenDebit - cf.cashOpenCredit;
  const closeCash = cf.cashCloseDebit - cf.cashCloseCredit;

  return (
    <div className="bg-white border border-[#E5E5DE] rounded-md overflow-x-auto text-sm">
      <table className="w-full">
        <thead className="bg-[#F4F4EE] text-xs text-[#666] font-medium border-b border-[#E5E5DE]">
          <tr>
            {activeSegments.map((s) => (
              <th
                key={s.id}
                className="px-3 py-2.5 text-left whitespace-nowrap"
                style={{ borderRight: "1px solid var(--ea-border)" }}
              >
                {s.nameMn}
              </th>
            ))}
            <th
              className="px-3 py-2.5 text-left"
              style={{ borderRight: "1px solid var(--ea-border)" }}
            >
              Үндсэн дансны нэр
            </th>
            <th className="px-3 py-2.5 text-right w-[160px]">Дүн</th>
          </tr>
        </thead>
        <tbody>
          <BigSection label="ҮЙЛ АЖИЛЛАГААНЫ МӨНГӨН УРСГАЛ" colCount={colCount} />
          {cf.operating.length === 0 ? (
            <EmptyRow colCount={colCount} />
          ) : (
            cf.operating.map((l) => (
              <LineRow key={l.activeKey} line={l} activeSegments={activeSegments} />
            ))
          )}
          <SubtotalRow
            label="Үйл ажиллагааны цэвэр урсгал"
            value={cf.totals.operating}
            colCount={colCount}
          />

          <BigSection label="ХӨРӨНГӨ ОРУУЛАЛТЫН МӨНГӨН УРСГАЛ" colCount={colCount} />
          {cf.investing.length === 0 ? (
            <EmptyRow colCount={colCount} />
          ) : (
            cf.investing.map((l) => (
              <LineRow key={l.activeKey} line={l} activeSegments={activeSegments} />
            ))
          )}
          <SubtotalRow
            label="Хөрөнгө оруулалтын цэвэр урсгал"
            value={cf.totals.investing}
            colCount={colCount}
          />

          <BigSection label="САНХҮҮГИЙН МӨНГӨН УРСГАЛ" colCount={colCount} />
          {cf.financing.length === 0 ? (
            <EmptyRow colCount={colCount} />
          ) : (
            cf.financing.map((l) => (
              <LineRow key={l.activeKey} line={l} activeSegments={activeSegments} />
            ))
          )}
          <SubtotalRow
            label="Санхүүгийн цэвэр урсгал"
            value={cf.totals.financing}
            colCount={colCount}
          />

          <tr className="border-t-2 border-[#1E3A5F] bg-[#F7F8FC]">
            <td
              colSpan={colCount - 1}
              className="px-3 py-2.5 font-semibold text-[#1E3A5F]"
            >
              ЦЭВЭР МӨНГӨН УРСГАЛ
            </td>
            <td
              className={`px-3 py-2.5 text-right tabular-nums font-semibold ${cf.totals.net >= 0 ? "text-[#047857]" : "text-[#B91C1C]"}`}
            >
              {fmt(cf.totals.net)}
            </td>
          </tr>
          <tr className="border-t border-[#E8E8E0]">
            <td
              colSpan={colCount - 1}
              className="px-3 py-2 pl-6 italic text-[#6B6B63]"
            >
              Эхний касс үлдэгдэл
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-[#1A1A19]">
              {fmt(openCash)}
            </td>
          </tr>
          <tr className="border-t border-[#E8E8E0] bg-[#FAFAF5]">
            <td
              colSpan={colCount - 1}
              className="px-3 py-2 pl-6 font-medium text-[#1A1A19]"
            >
              Эцсийн касс үлдэгдэл
            </td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1A1A19]">
              {fmt(closeCash)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BigSection({ label, colCount }: { label: string; colCount: number }) {
  return (
    <tr className="bg-[#EEF0F4] border-t-2 border-[#1E3A5F]">
      <td
        colSpan={colCount}
        className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-[#1E3A5F]"
      >
        {label}
      </td>
    </tr>
  );
}

function EmptyRow({ colCount }: { colCount: number }) {
  return (
    <tr>
      <td
        colSpan={colCount}
        className="px-3 py-3 pl-8 italic text-[#aaa]"
      >
        Бичилт байхгүй
      </td>
    </tr>
  );
}

function LineRow({
  line,
  activeSegments,
}: {
  line: CashFlowLine;
  activeSegments: SegmentDef[];
}) {
  return (
    <tr className="border-t border-[#F0F0EA]">
      {activeSegments.map((s) => (
        <td
          key={s.id}
          className="px-3 py-2 font-mono text-xs text-[#555] whitespace-nowrap"
          style={{ borderRight: "1px solid var(--ea-border)" }}
        >
          {line.segmentParts[s.id] ?? ""}
        </td>
      ))}
      <td
        className="px-3 py-2 text-[#1A1A19]"
        style={{ borderRight: "1px solid var(--ea-border)" }}
      >
        {line.name || <span className="text-[#aaa]">—</span>}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums ${line.amount >= 0 ? "text-[#1A1A19]" : "text-[#B91C1C]"}`}
      >
        {fmt(line.amount)}
      </td>
    </tr>
  );
}

function SubtotalRow({
  label,
  value,
  colCount,
}: {
  label: string;
  value: number;
  colCount: number;
}) {
  return (
    <tr className="border-t border-[#D4D4CB] bg-[#FAFAF5]">
      <td
        colSpan={colCount - 1}
        className="px-3 py-2 pl-6 font-medium text-[#1A1A19]"
      >
        {label}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums font-semibold ${value >= 0 ? "text-[#1A1A19]" : "text-[#B91C1C]"}`}
      >
        {fmt(value)}
      </td>
    </tr>
  );
}
