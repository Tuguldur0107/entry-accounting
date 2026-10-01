"use client";

// АР нэхэмжлэхийн eBarimt төлөв (docs/pos/05 Шат 2–3) — панелийн ReadField-д.
// Нэхэмжлэхийн ДДТД, төрөл, алдааны шалтгаан, «Дахин илгээх»; доор нь кассын
// төлөлт бүрийн `invoiceId`-тай төлбөрийн баримт (ДДТД / алдаа / дахин илгээх).
// ТЕГ-д очсон ч Entry-д буцаагдсан төлөлт ЧИМЭЭГҮЙ үлдэхгүй — ил анхааруулга.

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { resendArapEbarimt, resendArapPaymentEbarimt } from "@/lib/actions/arap";
import { EBARIMT_STATUS_LABELS, type EbarimtStatus } from "@/lib/ebarimt/constants";
import type { ArapPaymentEbarimtRow } from "@/lib/ebarimt/types";
import { EBARIMT_STATUS_TONES } from "@/lib/status";
import { feedback } from "@/lib/ui/feedback";

export interface ArapEbarimtInfo {
  id: string | null;
  status: string;
  date: string | null;
  type: string | null;
  lastError: string | null;
  payments: ArapPaymentEbarimtRow[];
  unqueuedPayments: number;
}

/** Төлөлтийн илгээлтийн төлөв → нэхэмжлэхийн eBarimt-ийн төлвийн шошго/өнгө (claimed = илгээж байна). */
const paymentStatusKey = (status: string) => (status === "claimed" ? "pending" : status);

const formatAmount = (value: number | null) =>
  value === null ? "—" : `${value.toLocaleString("mn-MN", { maximumFractionDigits: 2 })} ₮`;

const TYPE_LABELS: Record<string, string> = {
  B2B_INVOICE: "Нэхэмжлэх (байгууллага)",
  B2C_INVOICE: "Нэхэмжлэх (хувь хүн)",
};

export function ArapEbarimtField({
  documentId,
  ebarimt,
  paid,
  reversed,
}: {
  documentId: string;
  ebarimt: ArapEbarimtInfo;
  /** Төлөлттэй эсэх — ТЕГ-д мэдэгдэж эхлээгүй төлөлтийг ил тэмдэглэнэ. */
  paid: boolean;
  /** Буцаагдсан — ТЕГ-д илгээгдсэн нэхэмжлэх автоматаар цуцлагдахгүй (Q5). */
  reversed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const canResend = !reversed && (ebarimt.status === "failed" || ebarimt.status === "pending");
  const [isResendingPayment, startResendPayment] = useTransition();

  function resendPayment(submissionId: string) {
    startResendPayment(async () => {
      const result = await resendArapPaymentEbarimt(submissionId);
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved("Төлөлтийн eBarimt дахин илгээгдэж байна");
      router.refresh();
    });
  }

  function resend() {
    startTransition(async () => {
      const result = await resendArapEbarimt(documentId);
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved("eBarimt нэхэмжлэх дахин илгээгдэж байна");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={EBARIMT_STATUS_TONES[ebarimt.status] ?? "muted"} size="sm">
          {EBARIMT_STATUS_LABELS[ebarimt.status as EbarimtStatus] ?? ebarimt.status}
        </StatusBadge>
        {ebarimt.type && <span className="text-xs text-[var(--ea-text-3)]">{TYPE_LABELS[ebarimt.type] ?? ebarimt.type}</span>}
        {canResend && (
          <Button size="sm" variant="outline" onClick={resend} disabled={isPending}>
            {isPending ? "Илгээж байна…" : "Дахин илгээх"}
          </Button>
        )}
      </div>
      {ebarimt.id && (
        <div className="font-mono text-xs break-all">
          ДДТД {ebarimt.id}
          {ebarimt.date ? ` · ${ebarimt.date}` : ""}
        </div>
      )}
      {ebarimt.lastError && <div className="text-xs text-[var(--ea-danger-fg)]">{ebarimt.lastError}</div>}
      {reversed && ebarimt.status === "sent" && (
        <div className="text-xs text-[var(--ea-danger-fg)]">
          Нэхэмжлэх буцаагдсан ч ТЕГ-д хүчинтэй хэвээр — цуцлах урсгал баталгаажаагүй (docs/pos/05 Q5), ТЕГ-ийн системд гараар цуцална
        </div>
      )}
      {ebarimt.payments.length > 0 && (
        <div className="space-y-1 border-t border-[var(--ea-border)] pt-1">
          <div className="text-xs font-medium text-[var(--ea-text-2)]">Төлөлтийн баримт (нэхэмжлэхийн ДДТД-тэй)</div>
          {ebarimt.payments.map((payment) => {
            const key = paymentStatusKey(payment.status);
            return (
              <div key={payment.submissionId} className="space-y-0.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums">{formatAmount(payment.amount)}</span>
                  {payment.settlementDate && <span className="text-[var(--ea-text-3)]">{payment.settlementDate}</span>}
                  <StatusBadge tone={EBARIMT_STATUS_TONES[key] ?? "muted"} size="sm">
                    {EBARIMT_STATUS_LABELS[key as EbarimtStatus] ?? payment.status}
                  </StatusBadge>
                  {payment.status === "failed" && !payment.orphaned && (
                    <Button size="sm" variant="outline" onClick={() => resendPayment(payment.submissionId)} disabled={isResendingPayment}>
                      Дахин илгээх
                    </Button>
                  )}
                </div>
                {payment.ddtd && <div className="font-mono break-all">ДДТД {payment.ddtd}</div>}
                {payment.lastError && <div className="text-[var(--ea-danger-fg)]">{payment.lastError}</div>}
                {payment.orphaned && (
                  <div className="text-[var(--ea-danger-fg)]">
                    Энэ төлөлт ТЕГ-д бүртгэгдсэн ч Entry-д буцаагдсан (касс/хуулга) — ТЕГ-ийн системд гараар засна
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {paid && !reversed && ebarimt.status === "sent" && ebarimt.unqueuedPayments > 0 && (
        <div className="text-xs text-[var(--ea-text-3)]">
          {ebarimt.unqueuedPayments} төлөлт ТЕГ-д илгээгдэх дараалалд орж байна (1–2 минутад)
        </div>
      )}
    </div>
  );
}
