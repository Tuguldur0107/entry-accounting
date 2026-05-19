"use client";

import { useMemo } from "react";
import type { ChartOfAccount, JournalVoucherWithLines } from "@/lib/db/schema";
import { buildCashFlow, type CashFlowLine } from "@/lib/reports/balances";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { ReportGrid, type ReportRow } from "./report-grid";

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

  const openCash = cf.cashOpenDebit - cf.cashOpenCredit;
  const closeCash = cf.cashCloseDebit - cf.cashCloseCredit;

  const reportRows = useMemo<ReportRow[]>(() => {
    const out: ReportRow[] = [];

    const pushBucket = (
      sectionLabel: string,
      subtotalLabel: string,
      sectionId: string,
      lines: CashFlowLine[],
      subtotal: number
    ) => {
      out.push({ id: `sec-${sectionId}`, kind: "section", label: sectionLabel });
      if (lines.length === 0) {
        out.push({ id: `empty-${sectionId}`, kind: "empty", label: "Бичилт байхгүй" });
      } else {
        lines.forEach((l) =>
          out.push({
            id: `det-${sectionId}-${l.activeKey}`,
            kind: "detail",
            segs: l.segmentParts,
            name: l.name,
            amount: l.amount,
          })
        );
      }
      out.push({
        id: `sub-${sectionId}`,
        kind: "subtotal",
        label: subtotalLabel,
        amount: subtotal,
      });
    };

    pushBucket(
      "ҮЙЛ АЖИЛЛАГААНЫ МӨНГӨН УРСГАЛ",
      "Үйл ажиллагааны цэвэр урсгал",
      "op",
      cf.operating,
      cf.totals.operating
    );
    pushBucket(
      "ХӨРӨНГӨ ОРУУЛАЛТЫН МӨНГӨН УРСГАЛ",
      "Хөрөнгө оруулалтын цэвэр урсгал",
      "inv",
      cf.investing,
      cf.totals.investing
    );
    pushBucket(
      "САНХҮҮГИЙН МӨНГӨН УРСГАЛ",
      "Санхүүгийн цэвэр урсгал",
      "fin",
      cf.financing,
      cf.totals.financing
    );

    out.push({
      id: "tot-cash",
      kind: "total",
      label: "ЦЭВЭР МӨНГӨН УРСГАЛ",
      amount: cf.totals.net,
      amountSign: cf.totals.net >= 0 ? "pos" : "neg",
    });
    out.push({
      id: "open-cash",
      kind: "footnote",
      label: "Эхний касс үлдэгдэл",
      amount: openCash,
    });
    out.push({
      id: "close-cash",
      kind: "subtotal",
      label: "Эцсийн касс үлдэгдэл",
      amount: closeCash,
    });

    return out;
  }, [cf, openCash, closeCash]);

  return (
    <div className="flex-1 min-h-0">
      <ReportGrid activeSegments={activeSegments} rows={reportRows} />
    </div>
  );
}
