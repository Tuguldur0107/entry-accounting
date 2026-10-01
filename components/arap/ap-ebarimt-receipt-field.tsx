"use client";

// Өглөгийн нэхэмжлэхийн «Нийлүүлэгчийн eBarimt» (docs/dev/ebarimt-tax-reconcile.md §7) —
// нийлүүлэгчийн олгосон баримтын ДДТД (ТЕГ-ийн худалдан авалттай тулгах түлхүүр).
// ДДТД бичих/солих/салгах нь linkApEbarimtReceipt (ap:write, аудиттай); ТЕГ-ээс татсан
// баримт байвал дүн/НӨАТ-ыг харьцуулна.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { linkApEbarimtReceipt } from "@/lib/actions/ebarimt-tpi";
import { EBARIMT_DRIFT_TOLERANCE } from "@/lib/ebarimt/list-types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

export interface ApEbarimtReceiptInfo {
  ddtd: string | null;
  taxTotal: number | null;
  taxVat: number | null;
  taxDate: string | null;
  entryVat: number;
  connected: boolean;
}

export function ApEbarimtReceiptField({
  documentId,
  receipt,
  total,
  readOnly,
}: {
  documentId: string;
  receipt: ApEbarimtReceiptInfo;
  /** Нэхэмжлэхийн нийт дүн (MNT). */
  total: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(receipt.ddtd ?? "");
  const [isPending, startTransition] = useTransition();

  function save(ddtd: string | null) {
    startTransition(async () => {
      const result = await linkApEbarimtReceipt({ documentId, ddtd });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved(ddtd ? "ДДТД холбогдлоо" : "ДДТД салгалаа");
      setEditing(false);
      router.refresh();
    });
  }

  const found = receipt.taxTotal !== null;
  const mismatch =
    found &&
    (Math.abs((receipt.taxTotal ?? 0) - total) > EBARIMT_DRIFT_TOLERANCE ||
      Math.abs((receipt.taxVat ?? 0) - receipt.entryVat) > EBARIMT_DRIFT_TOLERANCE);

  if (editing)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          inputMode="numeric"
          placeholder="33 оронтой ДДТД"
          className="max-w-xs font-mono text-xs"
          onChange={(event) => setValue(event.target.value)}
        />
        <Button size="sm" onClick={() => save(value.trim() || null)} disabled={isPending}>
          Хадгалах
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={isPending}>
          Болих
        </Button>
      </div>
    );

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {receipt.ddtd ? (
          <span className="font-mono break-all">ДДТД {receipt.ddtd}</span>
        ) : (
          <span className="text-[var(--ea-text-3)]">
            Холбогдоогүй{receipt.entryVat > EBARIMT_DRIFT_TOLERANCE ? " — НӨАТ-тай өглөгт eBarimt-гүй бол авсан НӨАТ хасагдахгүй" : ""}
          </span>
        )}
        {receipt.ddtd && receipt.connected && (
          <StatusBadge tone={!found ? "danger" : mismatch ? "danger" : "success"} size="sm">
            {!found ? "ТЕГ-д алга" : mismatch ? "Дүн зөрсөн" : "ТЕГ-тэй тулсан"}
          </StatusBadge>
        )}
        {!readOnly && (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={isPending}>
              {receipt.ddtd ? "Солих" : "ДДТД бичих"}
            </Button>
            {receipt.ddtd && (
              <Button size="sm" variant="outline" onClick={() => save(null)} disabled={isPending}>
                Салгах
              </Button>
            )}
          </>
        )}
      </div>
      {found && (
        <div className={mismatch ? "text-[var(--ea-danger-fg)]" : "text-[var(--ea-text-3)]"}>
          ТЕГ: {fmtMnt(receipt.taxTotal ?? 0)} ₮ (НӨАТ {fmtMnt(receipt.taxVat ?? 0)} ₮){receipt.taxDate ? ` · ${receipt.taxDate}` : ""} ·
          өглөг: {fmtMnt(total)} ₮ (НӨАТ {fmtMnt(receipt.entryVat)} ₮)
        </div>
      )}
      {receipt.ddtd && receipt.connected && !found && (
        <div className="text-[var(--ea-text-3)]">
          ТЕГ-ээс татсан худалдан авалтад энэ ДДТД алга — ДДТД буруу эсвэл баримт хараахан татагдаагүй (сүүлийн 3 хоног)
        </div>
      )}
    </div>
  );
}
