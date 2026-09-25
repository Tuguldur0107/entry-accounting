"use client";

// «AI нягтлан»-ы нүүрний төлбөрийн мөр — хугацаа сонгоод [QPay-ээр төлөх].
// Суудал 1 тогтмол тул талбар харуулахгүй; QR диалог нь /settings/billing-тэй
// НЭГ (BillingQpayDialog) — төлбөрийн логик давтагдахгүй.

import { useState } from "react";
import { useRouter } from "next/navigation";

import { BillingQpayDialog } from "@/components/settings/billing-self-pay";
import { Button } from "@/components/ui/button";
import { FilterChips } from "@/components/ui/tabs";
import { createBillingPayment } from "@/lib/actions/billing-payment";
import { BILLING_MONTH_OPTIONS, type BillingPaymentView, type SelfPayOptions } from "@/lib/billing/self-pay";

const fmt = (value: number) => value.toLocaleString("en-US");

export function SkillsPay({
  options,
  ready,
  canPay,
  renew,
}: {
  options: SelfPayOptions;
  /** Entry-ийн QPay мерчант тохируулагдсан эсэх. */
  ready: boolean;
  canPay: boolean;
  /** Идэвхтэй захиалгыг сунгах уу (товчны нэр). */
  renew: boolean;
}) {
  const router = useRouter();
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<BillingPaymentView | null>(null);

  const plan = options.allowed ? options.plans[0] : null;
  const reason = !options.allowed
    ? options.reason
    : !ready
      ? "Онлайн төлбөр түр ажиллахгүй байна — support@entry.mn."
      : !canPay
        ? "Төлбөрийг бүртгэлийн эзэн хийнэ."
        : null;

  async function pay() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const result = await createBillingPayment({ planId: plan.planId, seats: 1, months });
    setBusy(false);
    if (result.error || !result.payment) setError(result.error ?? "QPay нэхэмжлэх үүссэнгүй");
    else setPayment(result.payment);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips<string>
          options={BILLING_MONTH_OPTIONS.map((value) => ({ value: String(value), label: `${value} сар` }))}
          value={String(months)}
          onChange={(value) => setMonths(Number(value))}
        />
        <span className="ml-auto font-mono text-sm font-semibold text-[var(--ea-text-1)]">
          {plan ? `${fmt(plan.pricePerSeatMnt * months)} ₮` : ""}
        </span>
        <Button onClick={pay} disabled={busy || !!reason || !plan}>
          {busy ? "Үүсгэж байна…" : renew ? "Сунгах" : "QPay-ээр төлөх"}
        </Button>
      </div>
      {reason ? <p className="text-xs text-[var(--ea-text-3)]">{reason}</p> : null}
      {error ? <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p> : null}
      {payment ? (
        <BillingQpayDialog
          initial={payment}
          onClose={() => {
            setPayment(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
