"use client";

// Нэхэмжлэхийн нээлттэй линк дээрх «QPay-ээр төлөх» (lib/qpay/arap.ts) —
// нээлттэй үлдэгдлээр QR + банкны апп-ын холбоос. Төлөвийг Entry DB-ээс 3 сек
// тутам уншина (QPay-г polling ХИЙХГҮЙ — webhook ирнэ); [Шалгах] нь QPay-ээс
// ≤ 1/10 сек. Төлөгдмөгц хуудсыг шинэчилж үлдэгдэл 0 харагдана.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { QrCode } from "@/components/ui/qr-code";
import { getInvoiceQpayPayment, startInvoiceQpayPayment } from "@/lib/actions/invoice-qpay";
import type { InvoiceQpayView } from "@/lib/qpay/arap-types";

const fmt = (value: number) => value.toLocaleString("en-US");
const POLL_MS = 3_000;

export function InvoiceQpayPay({ token, balance }: { token: string; balance: number }) {
  const router = useRouter();
  const [intent, setIntent] = useState<InvoiceQpayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await startInvoiceQpayPayment(token);
    setBusy(false);
    if (result.error || !result.intent) setError(result.error ?? "QPay QR үүссэнгүй");
    else setIntent(result.intent);
  }, [token]);

  const poll = useCallback(
    async (check = false) => {
      if (!intent) return;
      const result = await getInvoiceQpayPayment(token, intent.intentId, check);
      if (result.intent) setIntent(result.intent);
      else if (check && result.error) setError(result.error);
    },
    [intent, token]
  );

  useEffect(() => {
    if (!intent || intent.paid || intent.status !== "open") return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void poll(false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [intent, poll]);

  useEffect(() => {
    if (intent?.status === "finalized" && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [intent?.status, router]);

  if (!intent)
    return (
      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--ea-primary)] px-6 text-base font-semibold text-[var(--primary-foreground)] disabled:opacity-60"
        >
          {busy ? "QR бэлдэж байна…" : `QPay-ээр төлөх — ${fmt(balance)}₮`}
        </button>
        <p className="text-xs text-neutral-500">Банкны аппаараа QR уншуулж эсвэл холбоосоор шууд төлнө</p>
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );

  if (intent.paid)
    return (
      <div className="mt-6 rounded-md border border-green-600 bg-green-50 p-4 text-center text-sm text-green-800">
        <div className="font-semibold">Төлбөр амжилттай — {fmt(intent.amount)}₮</div>
        <div className="mt-1 text-xs">Баярлалаа. Нэхэмжлэх төлөгдсөн гэж бүртгэгдлээ.</div>
      </div>
    );

  const secondsLeft = Math.max(0, Math.round((new Date(intent.expiresAt).getTime() - now) / 1000));
  if (intent.status !== "open" || secondsLeft === 0)
    return (
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <p className="text-neutral-600">QR-ын хугацаа дууссан.</p>
        <button
          type="button"
          onClick={() => {
            setIntent(null);
            void start();
          }}
          className="inline-flex h-9 items-center rounded-md bg-[var(--ea-primary)] px-4 text-sm font-medium text-[var(--primary-foreground)]"
        >
          Шинэ QR авах
        </button>
      </div>
    );

  return (
    <div className="mt-6 flex flex-col items-center gap-3 rounded-md border border-neutral-200 p-4">
      <div className="text-sm font-semibold">QPay-ээр төлөх — {fmt(intent.amount)}₮</div>
      {intent.qrText ? (
        <QrCode
          value={intent.qrText}
          size={220}
          label="QPay QR"
          fallbackSrc={intent.qrImage ? `data:image/png;base64,${intent.qrImage}` : null}
        />
      ) : intent.qrImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`data:image/png;base64,${intent.qrImage}`} alt="QPay QR" width={220} height={220} />
      ) : null}
      <div className="text-xs text-neutral-500">
        {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} хүчинтэй · төлсний дараа энэ хуудас автоматаар шинэчлэгдэнэ
      </div>
      {intent.urls.length > 0 && (
        <div className="grid w-full grid-cols-3 gap-2 sm:grid-cols-4">
          {intent.urls.map((url) => (
            <a
              key={url.name}
              href={url.link}
              className="flex flex-col items-center gap-1 rounded border border-neutral-200 p-2 text-[10px] text-neutral-700"
              style={{ textDecoration: "none" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {url.logo && <img src={url.logo} alt="" width={32} height={32} />}
              <span className="text-center leading-tight">{url.name}</span>
            </a>
          ))}
        </div>
      )}
      <button type="button" onClick={() => void poll(true)} className="text-xs text-[var(--ea-primary)] underline">
        Төлсөн бол шалгах
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
