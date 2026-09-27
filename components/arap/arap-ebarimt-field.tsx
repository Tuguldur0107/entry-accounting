"use client";

// АР нэхэмжлэхийн eBarimt төлөв (docs/pos/05 Шат 2) — панелийн ReadField-д.
// ДДТД, төрөл, алдааны шалтгаан, «Дахин илгээх». Төлөлтийг ТЕГ-д мэдэгдэх
// урсгал (Q1) албан баталгаажаагүй — төлөгдсөн нэхэмжлэхэд ил тэмдэглэнэ.

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { resendArapEbarimt } from "@/lib/actions/arap";
import { EBARIMT_STATUS_LABELS, type EbarimtStatus } from "@/lib/ebarimt/constants";
import { EBARIMT_STATUS_TONES } from "@/lib/status";
import { feedback } from "@/lib/ui/feedback";

export interface ArapEbarimtInfo {
  id: string | null;
  status: string;
  date: string | null;
  type: string | null;
  lastError: string | null;
}

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
  /** Төлөлттэй эсэх — ТЕГ-д мэдэгдэх урсгал хүлээгдэж буйг ил тэмдэглэнэ. */
  paid: boolean;
  /** Буцаагдсан — ТЕГ-д илгээгдсэн нэхэмжлэх автоматаар цуцлагдахгүй (Q5). */
  reversed: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const canResend = !reversed && (ebarimt.status === "failed" || ebarimt.status === "pending");

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
      {paid && !reversed && ebarimt.status === "sent" && (
        <div className="text-xs text-[var(--ea-warning-fg)]">
          Төлөлтийг ТЕГ-д мэдэгдэх урсгал ТЕГ-ээс баталгаажаагүй (docs/pos/05 Q1) — одоогоор автоматаар илгээгдэхгүй
        </div>
      )}
    </div>
  );
}
