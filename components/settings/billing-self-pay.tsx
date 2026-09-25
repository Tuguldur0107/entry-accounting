"use client";

// Багцаа QPay-ээр ӨӨРӨӨ төлөх — docs/billing/00-proposal.md §6a.
// Сонголт (багц · суудал · сар) → [QPay-ээр төлөх] → QR диалог. Диалог төлөвөө
// ЗӨВХӨН Entry DB-ээс уншина (3 сек); [Шалгах] нь QPay-руу 10 секундэд нэг.
// Төлөгдмөгц хуудас шинэчлэгдэж багц идэвхжинэ (webhook эсвэл шалгалт).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { QrCode } from "@/components/ui/qr-code";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import {
  cancelBillingPayment,
  checkBillingPayment,
  createBillingPayment,
  getBillingPaymentStatus,
} from "@/lib/actions/billing-payment";
import {
  BILLING_MONTH_OPTIONS,
  type BillingPaymentView,
  BILLING_PAYMENT_POLL_MS,
  BILLING_PAYMENT_STATUS_LABELS,
  MAX_SELF_PAY_SEATS,
  type SelfPayOptions,
  type SelfPayPlanId,
} from "@/lib/billing/self-pay";
import { col } from "@/lib/grid/columnTypes";
import { QPAY_CHECK_MIN_INTERVAL_MS } from "@/lib/qpay/constants";
import { secondsLeft } from "@/lib/qpay/intent";

const fmt = (value: number) => value.toLocaleString("en-US");
const card = "ea-glass space-y-4 rounded-[var(--ea-r-lg)] border border-[var(--ea-border)] p-5";

const PAYMENT_TONE: Record<BillingPaymentView["status"], StatusTone> = {
  open: "warning",
  paid: "success",
  cancelled: "muted",
  expired: "muted",
  failed: "danger",
};

export function BillingSelfPay({
  options,
  ready,
  canPay,
  paidThrough,
  payments,
}: {
  options: SelfPayOptions;
  /** Entry-ийн QPay мерчант тохируулагдсан эсэх (env). */
  ready: boolean;
  /** Эзэн/админ эсэх. */
  canPay: boolean;
  /** Төлсөн хугацааны эцэс (ISO) — байхгүй бол null. */
  paidThrough: string | null;
  payments: BillingPaymentView[];
}) {
  const router = useRouter();
  const plans = options.allowed ? options.plans : [];
  const [planId, setPlanId] = useState<SelfPayPlanId | null>(plans[0]?.planId ?? null);
  const [seatsText, setSeatsText] = useState(String(options.allowed ? options.defaultSeats : 1));
  const [months, setMonths] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<BillingPaymentView | null>(null);

  const plan = plans.find((entry) => entry.planId === planId) ?? null;
  const seats = options.allowed && options.seatsFixed !== null ? options.seatsFixed : Math.round(Number(seatsText));
  const seatsValid =
    options.allowed && Number.isInteger(seats) && seats >= options.seatsMin && seats <= MAX_SELF_PAY_SEATS;
  const amount = plan && seatsValid ? seats * plan.pricePerSeatMnt * months : null;

  async function pay() {
    if (!plan || !seatsValid) return;
    setBusy(true);
    setError(null);
    const result = await createBillingPayment({ planId: plan.planId, seats, months });
    setBusy(false);
    if (result.error || !result.payment) {
      setError(result.error ?? "QPay нэхэмжлэх үүссэнгүй");
      return;
    }
    setPayment(result.payment);
  }

  const disabledReason = !options.allowed
    ? options.reason
    : !ready
      ? "Онлайн төлбөр одоогоор тохируулагдаагүй — support@entry.mn-тэй холбогдоно уу."
      : !canPay
        ? "Төлбөрийг байгууллагын эзэн эсвэл админ хийнэ."
        : null;

  return (
    <>
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">QPay-ээр төлөх</h2>
          {paidThrough ? (
            <span className="text-xs text-[var(--ea-text-3)]">
              Төлсөн хугацаа: <span className="font-mono text-[var(--ea-text-1)]">{paidThrough.slice(0, 10)}</span> хүртэл
            </span>
          ) : null}
        </div>

        {options.allowed ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.length > 1 ? (
              <FormField label="Багц" className="sm:col-span-2">
                <FilterChips<SelfPayPlanId>
                  options={plans.map((entry) => ({
                    value: entry.planId,
                    label: `${entry.label} · ${fmt(entry.pricePerSeatMnt)} ₮`,
                  }))}
                  value={planId ?? plans[0].planId}
                  onChange={setPlanId}
                />
              </FormField>
            ) : null}
            <FormField
              label="Суудал (хэрэглэгч)"
              htmlFor="billing-seats"
              hint={
                options.seatsFixed !== null
                  ? options.renewal
                    ? "Идэвхтэй хугацааг ижил нөхцлөөр сунгана — суудал нэмэхээр support@entry.mn."
                    : null
                  : `Хамгийн багадаа ${options.seatsMin} (одоо ашиглаж буй)`
              }
            >
              <Input
                id="billing-seats"
                type="number"
                min={options.seatsMin}
                max={MAX_SELF_PAY_SEATS}
                value={options.seatsFixed !== null ? String(options.seatsFixed) : seatsText}
                disabled={options.seatsFixed !== null}
                onChange={(event) => setSeatsText(event.target.value)}
              />
            </FormField>
            <FormField label="Хугацаа">
              <FilterChips<string>
                options={BILLING_MONTH_OPTIONS.map((value) => ({ value: String(value), label: `${value} сар` }))}
                value={String(months)}
                onChange={(value) => setMonths(Number(value))}
              />
            </FormField>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ea-border)] pt-3">
          <div className="text-xs text-[var(--ea-text-3)]">
            {plan && amount !== null ? (
              <>
                {fmt(seats)} суудал × {fmt(plan.pricePerSeatMnt)} ₮ × {months} сар ={" "}
                <span className="font-mono text-sm font-semibold text-[var(--ea-text-1)]">{fmt(amount)} ₮</span>
              </>
            ) : disabledReason ? null : (
              "Суудлын тоог шалгана уу"
            )}
          </div>
          <Button onClick={pay} disabled={busy || !!disabledReason || amount === null}>
            {busy ? "Үүсгэж байна…" : "QPay-ээр төлөх"}
          </Button>
        </div>
        {disabledReason ? <p className="text-xs text-[var(--ea-text-3)]">{disabledReason}</p> : null}
        {error ? <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p> : null}
      </section>

      {payments.length > 0 ? <PaymentHistory payments={payments} /> : null}

      {payment ? (
        <BillingQpayDialog
          initial={payment}
          onClose={(paid) => {
            setPayment(null);
            router.refresh();
            if (paid) setError(null);
          }}
        />
      ) : null}
    </>
  );
}

export function BillingQpayDialog({
  initial,
  onClose,
}: {
  initial: BillingPaymentView;
  onClose: (paid: boolean) => void;
}) {
  const [payment, setPayment] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [lastCheck, setLastCheck] = useState(0);
  const closedRef = useRef(false);

  // Entry DB-ээс төлөв (QPay-д хүрэхгүй) + таймер.
  useEffect(() => {
    if (payment.status !== "open") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const result = await getBillingPaymentStatus(payment.id);
      if (result.payment) setPayment(result.payment);
    }, BILLING_PAYMENT_POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [payment.id, payment.status]);

  const close = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (payment.status === "open") await cancelBillingPayment(payment.id);
    onClose(payment.status === "paid");
  }, [payment, onClose]);

  async function check() {
    setBusy(true);
    setLastCheck(Date.now());
    const result = await checkBillingPayment(payment.id);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    if (result.payment) setPayment(result.payment);
  }

  const left = secondsLeft(payment.expiresAt, new Date(now));
  const checkCooldown = Math.max(0, Math.ceil((QPAY_CHECK_MIN_INTERVAL_MS - (now - lastCheck)) / 1000));
  const status = payment.status;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) void close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            QPay · <span className="font-mono">{fmt(payment.amount)}</span> ₮
          </DialogTitle>
          <DialogDescription>
            {payment.planLabel} — {payment.seats} суудал × {payment.months} сар. Банкны апп-аараа QR уншуулна уу.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="text-sm text-[var(--ea-danger-fg)]">{error}</p> : null}

        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <StatusBadge tone={PAYMENT_TONE[status]} size="sm">
              {BILLING_PAYMENT_STATUS_LABELS[status]}
            </StatusBadge>
            {status === "open" ? (
              <span className="font-mono text-xs text-[var(--ea-text-3)]">
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
              </span>
            ) : null}
          </div>

          {status === "open" &&
            (payment.qrText ? (
              <QrCode
                  value={payment.qrText}
                  size={240}
                  label="QPay QR"
                  fallbackSrc={payment.qrImage ? `data:image/png;base64,${payment.qrImage}` : null}
                />
            ) : payment.qrImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`data:image/png;base64,${payment.qrImage}`} alt="QPay QR" width={240} height={240} />
            ) : (
              <p className="text-sm text-[var(--ea-danger-fg)]">QR ирсэнгүй</p>
            ))}

          {status === "open" && payment.urls.length > 0 ? (
            <details className="w-full text-xs">
              <summary className="cursor-pointer text-[var(--ea-text-3)]">
                Банкны апп-аар нээх ({payment.urls.length})
              </summary>
              <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
                {payment.urls.map((url) => (
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
          ) : null}

          {status === "paid" ? (
            <p className="text-center text-sm text-[var(--ea-success-fg)]">
              Төлбөр амжилттай. Багц идэвхжлээ
              {payment.periodEnd ? ` — ${payment.periodEnd.slice(0, 10)} хүртэл` : ""}.
            </p>
          ) : null}
          {status === "expired" ? (
            <p className="text-center text-xs text-[var(--ea-text-3)]">
              QR-ийн хугацаа дууссан. Төлсөн бол [Шалгах] дарна уу — төлбөр алдагдахгүй.
            </p>
          ) : null}
          {payment.lastError && status === "failed" ? (
            <p className="text-xs text-[var(--ea-danger-fg)]">{payment.lastError}</p>
          ) : null}
        </div>

        <DialogFooter>
          {status === "open" || status === "expired" ? (
            <Button variant="outline" onClick={check} disabled={busy || checkCooldown > 0}>
              {checkCooldown > 0 ? `Шалгах (${checkCooldown})` : "Шалгах"}
            </Button>
          ) : null}
          <Button variant={status === "open" ? "destructive" : "default"} onClick={() => void close()} disabled={busy}>
            {status === "open" ? "Цуцлах" : "Хаах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type HistoryRow = {
  id: string;
  createdAt: string;
  statusLabel: string;
  planLabel: string;
  seats: number;
  months: number;
  amount: number;
  periodEnd: string;
};

function PaymentHistory({ payments }: { payments: BillingPaymentView[] }) {
  const rows = useMemo<HistoryRow[]>(
    () =>
      payments.map((payment) => ({
        id: payment.id,
        createdAt: payment.createdAt.slice(0, 16).replace("T", " "),
        statusLabel: BILLING_PAYMENT_STATUS_LABELS[payment.status],
        planLabel: payment.planLabel,
        seats: payment.seats,
        months: payment.months,
        amount: payment.amount,
        periodEnd: payment.periodEnd?.slice(0, 10) ?? "",
      })),
    [payments]
  );
  const columnDefs = useMemo<ColDef<HistoryRow>[]>(
    () => [
      col<HistoryRow>({ eaType: "readonly-text", field: "createdAt", headerName: "Огноо", width: 140 }),
      col<HistoryRow>({ eaType: "readonly-text", field: "statusLabel", headerName: "Төлөв", width: 150 }),
      col<HistoryRow>({ eaType: "readonly-text", field: "planLabel", headerName: "Багц", flex: 1, minWidth: 140 }),
      col<HistoryRow>({ eaType: "readonly-text", field: "seats", headerName: "Суудал", width: 90 }),
      col<HistoryRow>({ eaType: "readonly-text", field: "months", headerName: "Сар", width: 70 }),
      col<HistoryRow>({ eaType: "readonly-money", field: "amount", headerName: "Дүн ₮", width: 120 }),
      col<HistoryRow>({ eaType: "readonly-text", field: "periodEnd", headerName: "Хүртэл", width: 110 }),
    ],
    []
  );
  return (
    <section className={card}>
      <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">Төлбөрийн түүх</h2>
      <DataGridDynamic<HistoryRow>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.id}
        height={Math.min(56 + rows.length * 36, 420)}
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        suppressCellFocus
      />
    </section>
  );
}
