"use client";

// QPay төлбөрийн диалог — docs/pos/04-qpay-integration-plan.md §3.3.
//
// Нээгдэхэд intent үүсгэнэ (dashboard нэхэмжлэх + QR + банкны deeplink), дараа
// нь ЗӨВХӨН Entry DB-ээс төлөвөө 2 сек тутам уншина (QPay-руу polling ҮГҮЙ —
// ККТТ хориглодог). [Шалгах] нь QPay-руу гар шалгалт, 10 секундэд нэг.
// Төлөгдмөгц `onPaid(intent)` → эцэг диалог мөрөө түгжинэ; хаах / [Цуцлах]
// нь нээлттэй intent-ийг QPay талд DELETE хийнэ.

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QrCode } from "@/components/ui/qr-code";
import { StatusBadge } from "@/components/ui/status-badge";
import { cancelQpayIntent, checkQpayIntent, createQpayIntent, getQpayIntent } from "@/lib/actions/qpay";
import type { CreatePosSaleInput } from "@/lib/actions/pos";
import {
  QPAY_CHECK_MIN_INTERVAL_MS,
  QPAY_INTENT_STATUS_LABELS,
  QPAY_STATUS_POLL_MS,
} from "@/lib/qpay/constants";
import { secondsLeft } from "@/lib/qpay/intent";
import type { QpayIntentView } from "@/lib/qpay/types";
import { fmtMnt } from "@/lib/reports/balances";

export function QpayDialog({
  open,
  amount,
  shiftId,
  saleInput,
  onPaid,
  onClose,
}: {
  open: boolean;
  amount: number;
  shiftId: string;
  /** Бүтэн борлуулалтын оролт — intent-ийн snapshot (дараа finalize хийхэд). */
  saleInput: CreatePosSaleInput;
  onPaid: (intent: QpayIntentView) => void;
  onClose: () => void;
}) {
  const [intent, setIntent] = useState<QpayIntentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Диалог нь нээгдэх бүрд ШИНЭЭР mount хийгддэг (эцэг нь нөхцөлтөөр
  // үзүүлдэг) тул төлөв effect дотор reset хийгдэхгүй — busy анхнаасаа true.
  const [busy, setBusy] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [lastCheck, setLastCheck] = useState(0);
  const paidRef = useRef(false);

  // Нээгдэхэд нэг удаа intent үүсгэнэ.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    createQpayIntent({ shiftId, amount, saleInput })
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.intent) {
          setError(result.error ?? "QPay нэхэмжлэх үүссэнгүй");
          return;
        }
        setIntent(result.intent);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // amount/saleInput нь нээгдэх мөчийнх — дахин үүсгэхгүй.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shiftId]);

  const applyIntent = useCallback(
    (next: QpayIntentView) => {
      setIntent(next);
      if (next.status === "paid" && !paidRef.current) {
        paidRef.current = true;
        onPaid(next);
      }
    },
    [onPaid]
  );

  // Entry DB-ээс төлөв (QPay-д хүрэхгүй) + таймер.
  useEffect(() => {
    if (!open || !intent || intent.status !== "open") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const result = await getQpayIntent(intent.id);
      if (result.intent) applyIntent(result.intent);
    }, QPAY_STATUS_POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [open, intent, applyIntent]);

  async function check() {
    if (!intent) return;
    setBusy(true);
    setLastCheck(Date.now());
    const result = await checkQpayIntent(intent.id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.intent) applyIntent(result.intent);
  }

  async function cancel() {
    if (intent && intent.status === "open") {
      setBusy(true);
      await cancelQpayIntent(intent.id);
      setBusy(false);
    }
    onClose();
  }

  const left = intent ? secondsLeft(intent.expiresAt, new Date(now)) : 0;
  const checkCooldown = Math.max(0, Math.ceil((QPAY_CHECK_MIN_INTERVAL_MS - (now - lastCheck)) / 1000));
  const status = intent?.status ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void cancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            QPay · <span className="font-mono">{fmtMnt(amount)}</span> ₮
          </DialogTitle>
          <DialogDescription>
            Харилцагч банкны апп-аар QR уншуулна. Төлөгдмөгц энэ цонх өөрөө хаагдана.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-[var(--ea-danger-fg)]">{error}</p>}

        {!intent && !error && <p className="text-sm text-[var(--ea-text-3)]">QPay нэхэмжлэх үүсгэж байна…</p>}

        {intent && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={status === "paid" ? "success" : status === "open" ? "warning" : "danger"}
                size="sm"
              >
                {status ? QPAY_INTENT_STATUS_LABELS[status] : ""}
              </StatusBadge>
              {status === "open" && (
                <span className="font-mono text-xs text-[var(--ea-text-3)]">
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </span>
              )}
            </div>

            {status === "open" &&
              (intent.qrText ? (
                <QrCode value={intent.qrText} size={240} label="QPay QR" />
              ) : intent.qrImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:image/png;base64,${intent.qrImage}`} alt="QPay QR" width={240} height={240} />
              ) : (
                <p className="text-sm text-[var(--ea-danger-fg)]">QR ирсэнгүй</p>
              ))}

            {status === "open" && intent.urls.length > 0 && (
              <details className="w-full text-xs">
                <summary className="cursor-pointer text-[var(--ea-text-3)]">
                  Банкны апп-аар нээх ({intent.urls.length})
                </summary>
                <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
                  {intent.urls.map((url) => (
                    <a
                      key={url.name + url.link}
                      href={url.link}
                      className="truncate rounded border border-[var(--ea-border)] px-2 py-1 text-[var(--ea-primary)]"
                    >
                      {url.name || url.link}
                    </a>
                  ))}
                </div>
              </details>
            )}

            {intent.qpayInvoiceId && (
              <p className="font-mono text-[11px] text-[var(--ea-text-4)]">нэхэмжлэх {intent.qpayInvoiceId}</p>
            )}
            {intent.lastError && status !== "open" && (
              <p className="text-xs text-[var(--ea-danger-fg)]">{intent.lastError}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {status === "open" && (
            <Button variant="outline" onClick={check} disabled={busy || checkCooldown > 0}>
              {checkCooldown > 0 ? `Шалгах (${checkCooldown})` : "Шалгах"}
            </Button>
          )}
          <Button variant={status === "open" ? "destructive" : "default"} onClick={cancel} disabled={busy}>
            {status === "open" ? "Цуцлах" : "Хаах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
