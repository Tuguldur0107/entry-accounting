"use client";

// Төлбөрийн диалог — docs/pos/00-proposal.md §4.2 (D6 холимог төлбөр).
//
// Хэлбэрийн товчнууд → мөр бүр [хэлбэр | дүн | лавлах/картын код/кредит | ×].
// Төлсөн / Үлдэгдэл / Хариулт нь CLIENT талд ЗӨВХӨН мэдээллийн зорилгоор
// (дүн × ээлжийн ханш, бэлэн бөөрөнхийлөл `roundToCashUnit`) — жинхэнэ шалгалт
// (зээлийн лимит, урьдчилгаа/картын үлдэгдэл, лавлах заавал) серверийн
// `createPosSale` дотор `planPayments`-ээр хийгдэнэ. Алдаа → юу ч бичигдэхгүй.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { getGiftCardsAndCredits } from "@/lib/actions/pos";
import type { CheckoutCustomer } from "@/lib/pos/load-data";
import { PAYMENT_KIND_LABELS } from "@/lib/pos/constants";
import { roundToCashUnit } from "@/lib/pos/sale-math";
import type { PaymentInput, PaymentMethodView, PosShiftView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";

const round2 = (value: number) => Math.round(value * 100) / 100;
const EPS = 0.005;

interface PaymentRow {
  key: number;
  paymentMethodId: string;
  amount: string;
  reference: string;
  giftCardCode: string;
  storeCreditId: string;
}

interface StoreCreditOption {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  balance: number;
  status: string;
}

export function PaymentDialog({
  open,
  onOpenChange,
  methods,
  total,
  documentLabel,
  customer,
  shift,
  cashRoundingUnit,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  methods: PaymentMethodView[];
  /** Бөөрөнхийлөлгүй төлөх дүн (quote.total). */
  total: number;
  documentLabel?: string;
  customer: CheckoutCustomer | null;
  shift: PosShiftView | null;
  cashRoundingUnit: number;
  busy: boolean;
  /** Батлах — амжилттай бол true (эцэг диалогийг хаана). */
  onConfirm: (payments: PaymentInput[]) => Promise<boolean>;
}) {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [seq, setSeq] = useState(1);
  const [storeCredits, setStoreCredits] = useState<StoreCreditOption[] | null>(null);

  const activeMethods = useMemo(
    () =>
      methods
        .filter((method) => method.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [methods]
  );
  const methodById = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);
  const isWalkIn = !customer || customer.isWalkIn;

  // Нээгдэх бүрд эцэг `key`-ээр remount хийдэг тул мөрүүд цэвэр эхэлнэ.

  // Дэлгүүрийн кредит хэлбэр сонгогдвол харилцагчийн идэвхтэй кредитүүдийг татна.
  const needsStoreCredits = rows.some(
    (row) => methodById.get(row.paymentMethodId)?.kind === "store_credit"
  );
  useEffect(() => {
    if (!needsStoreCredits || storeCredits !== null) return;
    let cancelled = false;
    getGiftCardsAndCredits().then((result) => {
      if (cancelled) return;
      if (result.error) {
        toast.error(result.error);
        setStoreCredits([]);
        return;
      }
      setStoreCredits(result.storeCredits ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [needsStoreCredits, storeCredits]);

  const customerCredits = useMemo(
    () =>
      (storeCredits ?? []).filter(
        (credit) =>
          credit.status === "active" &&
          credit.balance > 0 &&
          (!customer || credit.counterpartyId === customer.id)
      ),
    [storeCredits, customer]
  );

  // ── Дүнгийн тооцоо (мэдээллийн) ──────────────────────────────────────────
  const plan = useMemo(() => {
    const warnings: string[] = [];
    let cashBase = 0;
    let nonCashBase = 0;
    let hasCash = false;
    for (const row of rows) {
      const method = methodById.get(row.paymentMethodId);
      const amount = Number(row.amount);
      if (!method || !(amount > 0)) continue;
      const currency = method.currency || "MNT";
      let rate = 1;
      if (method.kind === "cash_fx" || currency !== "MNT") {
        rate = shift?.fxRates[currency] ?? 0;
        if (!(rate > 0)) {
          warnings.push(`${currency} ханш ээлжид тохируулаагүй — ${method.name} мөр тооцогдохгүй`);
          continue;
        }
      }
      const base = round2(amount * rate);
      if (method.kind === "cash") {
        hasCash = true;
        cashBase += base;
      } else nonCashBase += base;
      if (method.requiresReference && !row.reference.trim())
        warnings.push(`${method.name}: лавлах дугаар заавал`);
      if (["credit", "advance", "store_credit"].includes(method.kind) && isWalkIn)
        warnings.push(`${method.name}: харилцагч заавал сонгоно`);
      if (method.kind === "credit" && customer?.creditLimit != null)
        warnings.push(
          `Зээлийн лимит ${fmtMnt(customer.creditLimit)}₮ — нээлттэй авлагатай нийлээд хэтрэх эсэхийг сервер шалгана`
        );
    }
    let rounding = 0;
    if (hasCash && cashRoundingUnit > 0) {
      const cashDue = round2(total - nonCashBase);
      if (cashDue > 0) rounding = roundToCashUnit(cashDue, cashRoundingUnit).diff;
    }
    const payable = round2(total + rounding);
    const paid = round2(cashBase + nonCashBase);
    const remaining = Math.max(0, round2(payable - paid));
    const change = Math.max(0, round2(paid - payable));
    if (change > EPS && !rows.some((row) => methodById.get(row.paymentMethodId)?.allowsChange))
      warnings.push("Илүү төлбөр — хариулт зөвхөн бэлэн хэлбэрт өгнө");
    return { payable, paid, remaining, change, rounding, warnings };
  }, [rows, methodById, shift, total, cashRoundingUnit, isWalkIn, customer]);

  function addMethod(method: PaymentMethodView) {
    const prefill = plan.remaining > EPS ? String(plan.remaining) : "";
    const currency = method.currency || "MNT";
    const rate = currency === "MNT" ? 1 : shift?.fxRates[currency] ?? 0;
    setRows((current) => [
      ...current,
      {
        key: seq,
        paymentMethodId: method.id,
        amount: prefill && rate > 0 ? String(round2(Number(prefill) / rate)) : "",
        reference: "",
        giftCardCode: "",
        storeCreditId: "",
      },
    ]);
    setSeq((value) => value + 1);
  }

  function patchRow(key: number, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function bumpCash(key: number, delta: number | "exact") {
    setRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (delta === "exact") {
          // Энэ мөрийг тэглээд үлдэгдлээр нь бөглөнө.
          const others = plan.paid - (Number(row.amount) || 0);
          return { ...row, amount: String(Math.max(0, round2(plan.payable - others))) };
        }
        return { ...row, amount: String(round2((Number(row.amount) || 0) + delta)) };
      })
    );
  }

  const canSubmit = rows.length > 0 && plan.remaining <= EPS && !busy;

  async function submit() {
    if (!canSubmit) return;
    const payments: PaymentInput[] = rows
      .filter((row) => Number(row.amount) > 0)
      .map((row) => ({
        paymentMethodId: row.paymentMethodId,
        amount: Number(row.amount),
        reference: row.reference.trim() || null,
        giftCardCode: row.giftCardCode.trim() || null,
        storeCreditId: row.storeCreditId || null,
      }));
    const ok = await onConfirm(payments);
    if (ok) setRows([]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] overflow-y-auto sm:max-w-2xl"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Төлбөр авах{documentLabel ? ` — ${documentLabel}` : ""} · Төлөх{" "}
            <span className="font-mono">{fmtMnt(plan.payable)}</span> ₮
          </DialogTitle>
          <DialogDescription>
            Нэг эсвэл олон хэлбэрээр. Зээл / урьдчилгаа / кредит → харилцагч заавал.
            {customer && !customer.isWalkIn && (
              <>
                {" "}
                Харилцагч: <span className="font-medium">{customer.name}</span>
                {customer.creditLimit != null && ` · зээлийн лимит ${fmtMnt(customer.creditLimit)}₮`}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {activeMethods.map((method) => (
            <Button
              key={method.id}
              variant="outline"
              size="sm"
              type="button"
              onClick={() => addMethod(method)}
              title={PAYMENT_KIND_LABELS[method.kind]}
            >
              {method.name}
              {method.currency !== "MNT" && (
                <span className="font-mono text-[10px] text-[var(--ea-text-3)]">{method.currency}</span>
              )}
            </Button>
          ))}
          {activeMethods.length === 0 && (
            <span className="text-xs text-[var(--ea-danger-fg)]">
              Идэвхтэй төлбөрийн хэлбэр алга — Борлуулалт → Тохиргоо → Төлбөрийн хэлбэр
            </span>
          )}
        </div>

        <div className="space-y-2">
          {rows.length === 0 && (
            <p className="text-xs text-[var(--ea-text-3)]">
              Дээрх товчноос төлбөрийн хэлбэр сонгоно уу.
            </p>
          )}
          {rows.map((row) => {
            const method = methodById.get(row.paymentMethodId);
            if (!method) return null;
            const currency = method.currency || "MNT";
            const rate = currency === "MNT" ? 1 : shift?.fxRates[currency] ?? 0;
            return (
              <div
                key={row.key}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ea-text-1)]">{method.name}</div>
                  <div className="text-[11px] text-[var(--ea-text-3)]">
                    {PAYMENT_KIND_LABELS[method.kind]}
                    {currency !== "MNT" && (rate > 0 ? ` · ханш ${rate.toLocaleString("en-US")}` : " · ханш алга")}
                  </div>
                </div>
                <div className="space-y-1">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={row.amount}
                    placeholder={currency}
                    onChange={(event) => patchRow(row.key, { amount: event.target.value })}
                    className="font-mono text-right"
                  />
                  {method.kind === "cash" && (
                    <div className="flex flex-wrap gap-1">
                      <QuickButton onClick={() => bumpCash(row.key, "exact")}>Яг</QuickButton>
                      <QuickButton onClick={() => bumpCash(row.key, 10_000)}>+10,000</QuickButton>
                      <QuickButton onClick={() => bumpCash(row.key, 20_000)}>+20,000</QuickButton>
                      <QuickButton onClick={() => bumpCash(row.key, 50_000)}>+50,000</QuickButton>
                    </div>
                  )}
                </div>
                <div>
                  {method.kind === "gift_card" ? (
                    <Input
                      value={row.giftCardCode}
                      placeholder="Картын код"
                      onChange={(event) => patchRow(row.key, { giftCardCode: event.target.value })}
                    />
                  ) : method.kind === "store_credit" ? (
                    <select
                      className="ea-form-select"
                      value={row.storeCreditId}
                      onChange={(event) => patchRow(row.key, { storeCreditId: event.target.value })}
                    >
                      <option value="">
                        {storeCredits === null ? "Ачаалж байна…" : "— Кредит сонгох —"}
                      </option>
                      {customerCredits.map((credit) => (
                        <option key={credit.id} value={credit.id}>
                          {credit.counterpartyName} · {fmtMnt(credit.balance)}₮
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={row.reference}
                      placeholder={
                        method.requiresReference
                          ? "Лавлах дугаар (заавал)"
                          : "Лавлах / слип / гүйлгээний утга"
                      }
                      onChange={(event) => patchRow(row.key, { reference: event.target.value })}
                    />
                  )}
                </div>
                <IconAction
                  name="close"
                  label="Мөр хасах"
                  size="sm"
                  variant="danger"
                  onClick={() => removeRow(row.key)}
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-[var(--ea-bg)] px-3 py-2 text-sm">
          <span>
            Төлсөн <span className="font-mono font-semibold">{fmtMnt(plan.paid)}</span>
          </span>
          <span>
            Үлдэгдэл{" "}
            <span
              className={`font-mono font-semibold ${plan.remaining > EPS ? "text-[var(--ea-danger-fg)]" : "text-[var(--ea-success-fg)]"}`}
            >
              {fmtMnt(plan.remaining)}
            </span>
          </span>
          <span>
            Хариулт <span className="font-mono font-semibold">{fmtMnt(plan.change)}</span>
          </span>
          {plan.rounding !== 0 && (
            <span className="text-xs text-[var(--ea-text-3)]">
              Бөөрөнхийлөл {plan.rounding > 0 ? "+" : ""}
              {fmtMnt(plan.rounding)}
            </span>
          )}
        </div>

        {plan.warnings.length > 0 && (
          <ul className="space-y-0.5 text-xs text-[var(--ea-warning-fg)]">
            {plan.warnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Болих
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? "Бичиж байна…" : "Батлаад хэвлэх ⏎"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuickButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="ea-btn h-6 px-1.5 font-mono text-[11px]"
      onClick={onClick}
      tabIndex={-1}
    >
      {children}
    </button>
  );
}
