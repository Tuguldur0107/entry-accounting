"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCashDocumentDetail,
  type CashDocumentDetail,
  type CashDocumentVoucherLine,
} from "@/lib/actions/cash";
import type { CashDocumentView } from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import { fmtAccountDisplay } from "@/lib/grid/segments";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

interface Props {
  document: CashDocumentView | null;
  accountName: (id: string | null) => string;
  glName: (code: string | null) => string;
  activeSegIds: number[];
  onClose: () => void;
}

// Read-only drawer that opens when a transaction row is clicked. Shows the
// full document header plus the linked GL journal (Dr/Cr lines) fetched on
// demand — and the reversal journal when the document was storno'd.
export function CashDocumentDetailDialog({
  document,
  accountName,
  glName,
  activeSegIds,
  onClose,
}: Props) {
  // Keep the fetched detail tagged with the document id it belongs to.
  // `detail` / `loading` are then derived — the effect only calls setState
  // inside the async callback, never synchronously in its body (which the
  // react-hooks/set-state-in-effect lint forbids).
  const [loaded, setLoaded] = useState<{ id: string; detail: CashDocumentDetail } | null>(
    null
  );

  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    getCashDocumentDetail(document.id).then((d) => {
      if (!cancelled) setLoaded({ id: document.id, detail: d });
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  const detail =
    document && loaded && loaded.id === document.id ? loaded.detail : null;
  const loading = !!document && !detail;

  const open = !!document;

  const cashAccountLabel = (() => {
    if (!document) return "";
    if (document.documentType === "transfer") {
      return `${document.fromAccountName ?? ""} → ${document.toAccountName ?? ""}`;
    }
    const id =
      document.documentType === "receipt"
        ? document.toCashAccountId
        : document.fromCashAccountId;
    return accountName(id);
  })();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="text-[var(--ea-text-3)] text-xs font-normal mr-2 font-mono">
              {document?.documentNo}
            </span>
            {document ? TYPE_LABELS[document.documentType] ?? document.documentType : ""}
          </DialogTitle>
        </DialogHeader>

        {document && (
          <div className="space-y-4">
            {/* Header fields */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <Row label="Огноо" value={document.date} mono />
              <Row
                label="Төлөв"
                value={STATUS_LABELS[document.status] ?? document.status}
              />
              <Row label="Cash данс" value={cashAccountLabel} />
              <Row label="Дүн" value={fmtMnt(document.amount)} mono strong />
              {document.documentType !== "transfer" && (
                <Row
                  label="Харилцагч / GL данс"
                  value={[
                    document.counterparty,
                    document.counterAccountNumber
                      ? `${document.counterAccountNumber} ${glName(document.counterAccountNumber)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              )}
              {document.cashFlowCode && (
                <Row label="Мөнгөн урсгал (S8)" value={document.cashFlowCode} mono />
              )}
              <Row label="Утга" value={document.description || "—"} span2 />
            </dl>

            {/* Linked GL journal */}
            <div>
              <div className="mb-1.5 text-xs font-semibold text-[var(--ea-text-2)]">
                GL журнал
              </div>
              {loading ? (
                <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
                  Ачаалж байна…
                </div>
              ) : detail && detail.lines.length > 0 ? (
                <VoucherTable lines={detail.lines} activeSegIds={activeSegIds} glName={glName} />
              ) : (
                <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
                  {document.status === "draft"
                    ? "Ноорог — батлагдаагүй тул GL журнал үүсээгүй"
                    : "GL журнал олдсонгүй"}
                </div>
              )}
            </div>

            {/* Reversal journal */}
            {detail && detail.reversalLines.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-semibold text-[var(--ea-warning-fg)]">
                  Сторно журнал
                </div>
                <VoucherTable
                  lines={detail.reversalLines}
                  activeSegIds={activeSegIds}
                  glName={glName}
                />
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  mono,
  strong,
  span2,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
  span2?: boolean;
}) {
  return (
    <div className={span2 ? "col-span-2" : undefined}>
      <dt className="text-[var(--ea-text-4)]">{label}</dt>
      <dd
        className={[
          "mt-0.5 text-[var(--ea-text-1)]",
          mono ? "font-mono" : "",
          strong ? "font-semibold" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function VoucherTable({
  lines,
  activeSegIds,
  glName,
}: {
  lines: CashDocumentVoucherLine[];
  activeSegIds: number[];
  glName: (code: string | null) => string;
}) {
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--ea-border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]">
            <th className="px-3 py-1.5 text-left font-medium">Данс</th>
            <th className="px-3 py-1.5 text-right font-medium">Дебет</th>
            <th className="px-3 py-1.5 text-right font-medium">Кредит</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            // Main account = segment 3 (parts[2]) for the name lookup.
            const parts = l.accountNumber.split(".");
            const mainAccount = parts.length === 10 ? parts[2] : l.accountNumber;
            return (
              <tr key={i} className="border-t border-[var(--ea-border)]">
                <td className="px-3 py-1.5">
                  <span className="font-mono text-[var(--ea-primary-500)]">
                    {fmtAccountDisplay(l.accountNumber, activeSegIds)}
                  </span>
                  <span className="ml-2 text-[var(--ea-text-3)]">
                    {glName(mainAccount)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {l.debit !== 0 ? fmtMnt(l.debit) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {l.credit !== 0 ? fmtMnt(l.credit) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--ea-border-strong)] bg-[var(--ea-bg-2)] font-semibold">
            <td className="px-3 py-1.5 text-right text-[var(--ea-text-3)]">Нийт</td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
              {fmtMnt(totalDebit)}
            </td>
            <td className="px-3 py-1.5 text-right font-mono tabular-nums">
              {fmtMnt(totalCredit)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
