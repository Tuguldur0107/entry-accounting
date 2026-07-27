"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCashDocumentDetail,
  type CashDocumentDetail,
} from "@/lib/actions/cash";
import type { CashDocumentView } from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import { VoucherLinesTable } from "@/components/gl/voucher-lines-table";

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

  // Foreign-currency documents show both the currency amount and the MNT
  // base; a GL-derived FX draft has no rate yet — only the MNT figure is real.
  const amountLabel = (() => {
    if (!document) return "";
    if (document.currency === "MNT") return fmtMnt(document.amount);
    if (document.exchangeRate > 0 && document.amount > 0)
      return `${document.amount.toLocaleString("en-US")} ${document.currency} · ${fmtMnt(document.baseAmount)}`;
    return `${fmtMnt(document.baseAmount)} · ${document.currency} ханш тодорхойгүй`;
  })();

  // The journal shown: the adopted/posted voucher, else the source voucher
  // the draft was derived from (that GL entry already exists — it is what
  // the accountant verifies before confirming).
  const journalId = detail?.voucherId ?? detail?.sourceVoucherId ?? null;
  const showsSourceVoucher =
    !!detail && !detail.voucherId && !!detail.sourceVoucherId;

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
              <Row label="Мөнгөн хөрөнгийн данс" value={cashAccountLabel} />
              <Row label="Дүн" value={amountLabel} mono strong />
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

            {/* Linked GL journal — for a GL-derived draft this is the source
                voucher the accountant verifies before confirming. */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ea-text-2)]">
                  {showsSourceVoucher ? "Эх GL журнал" : "GL журнал"}
                  {detail?.voucherDate && (
                    <span className="ml-2 font-mono font-normal text-[var(--ea-text-4)]">
                      {detail.voucherDate}
                    </span>
                  )}
                </span>
                {journalId && (
                  <Link
                    href={`/gl/journal/${journalId}/edit`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ea-primary)] hover:underline"
                  >
                    Журнал нээх
                    <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              {loading ? (
                <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
                  Ачаалж байна…
                </div>
              ) : detail && detail.lines.length > 0 ? (
                <>
                  <VoucherLinesTable
                    lines={detail.lines}
                    activeSegIds={activeSegIds}
                    glName={glName}
                  />
                  {showsSourceVoucher && (
                    <p className="mt-1.5 text-[11px] text-[var(--ea-text-4)]">
                      Энэ бичилт GL-д аль хэдийн батлагдсан. Баримтыг батлахад
                      шинэ журнал үүсэхгүй — энэ журналыг холбоно.
                    </p>
                  )}
                </>
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
                  Буцаалтын журнал
                </div>
                <VoucherLinesTable
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
