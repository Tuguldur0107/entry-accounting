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
import { SwitchField } from "@/components/ui/form-field";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { getGiftCardsAndCredits } from "@/lib/actions/pos";
import type { EbarimtBuyerInput } from "@/lib/pos/ebarimt-buyer";
import type { CheckoutCustomer } from "@/lib/pos/load-data";
import { PAYMENT_KIND_LABELS } from "@/lib/pos/constants";
import { roundToCashUnit } from "@/lib/pos/sale-math";
import type { PaymentInput, PaymentMethodView, PosShiftView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";
import { QpayDialog } from "@/components/pos/checkout/qpay-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { QPAY_PROVIDER } from "@/lib/qpay/constants";
import type { CreatePosSaleInput } from "@/lib/actions/pos";

const round2 = (value: number) => Math.round(value * 100) / 100;
const EPS = 0.005;

interface PaymentRow {
  key: number;
  paymentMethodId: string;
  amount: string;
  reference: string;
  giftCardCode: string;
  storeCreditId: string;
  /** QPay провайдертай мөр — төлөгдсөн intent (мөр түгжигдэнэ, дүн өөрчлөгдөхгүй). */
  qpayIntentId: string | null;
  /** Диалог нээгдэхэд автоматаар үүссэн «Бэлэн = төлөх дүн» мөр, хэрэглэгч хөндөөгүй. */
  auto?: boolean;
}

/** Батлахад дамжих нэмэлт (QPay intent) — createPosSale.qpayIntentId. */
export interface PaymentConfirmExtra {
  qpayIntentId: string | null;
}

interface StoreCreditOption {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  balance: number;
  status: string;
}

export type { EbarimtBuyerInput };

export function PaymentDialog({
  open,
  onOpenChange,
  methods,
  total,
  documentLabel,
  customer,
  shift,
  cashRoundingUnit,
  ebarimtEnabled = false,
  buyer: buyerFromCheckout,
  buyerLabel = null,
  nonVat = false,
  busy,
  onConfirm,
  saleDraft,
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
  /** Энэ борлуулалтад eBarimt үүсэх эсэх (eBarimt асаалттай + «НӨАТ» асаалттай). */
  ebarimtEnabled?: boolean;
  /** Кассын «НӨАТ» мөрөөс шийдэгдсэн худалдан авагч (lib/pos/ebarimt-buyer.ts). */
  buyer?: EbarimtBuyerInput;
  /** Худалдан авагчийн товч тайлбар («ААН · Нэр · ТТД …»). */
  buyerLabel?: string | null;
  /** НӨАТ-гүй борлуулалт — диалогт ил тэмдэглэнэ. */
  nonVat?: boolean;
  busy: boolean;
  /** Батлах — амжилттай бол true (эцэг диалогийг хаана). */
  onConfirm: (payments: PaymentInput[], buyer: EbarimtBuyerInput, extra: PaymentConfirmExtra) => Promise<boolean>;
  /**
   * QPay intent-ийн snapshot-д орох борлуулалтын СУУРЬ оролт (мөр, харилцагч,
   * хөнгөлөлт, агуулах, ээлж) — payments/buyer-ыг диалог өөрөө нэмнэ.
   */
  saleDraft: Omit<CreatePosSaleInput, "payments" | "ebarimtConsumerNo" | "ebarimtCustomerTin" | "ebarimtCustomerRegNo" | "skipEbarimt" | "qpayIntentId">;
}) {
  // Анхдагч мөр: «Бэлэн = төлөх дүн» — ихэнх борлуулалт нэг товшилт + Enter.
  // Диалог нээх бүрд remount болдог тул анхны утга хангалттай.
  const [rows, setRows] = useState<PaymentRow[]>(() => {
    const cash = methods
      .filter((method) => method.isActive && method.kind === "cash" && (method.currency || "MNT") === "MNT")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))[0];
    if (!cash || !(total > 0)) return [];
    return [
      {
        key: 0,
        paymentMethodId: cash.id,
        amount: String(roundToCashUnit(total, cashRoundingUnit).rounded),
        reference: "",
        giftCardCode: "",
        storeCreditId: "",
        qpayIntentId: null,
        auto: true,
      },
    ];
  });
  const [seq, setSeq] = useState(1);
  /** Нээлттэй QPay диалог — аль мөрийнх. */
  const [qpayRowKey, setQpayRowKey] = useState<number | null>(null);
  const [storeCredits, setStoreCredits] = useState<StoreCreditOption[] | null>(null);
  // ── eBarimt (§4.5) — худалдан авагчийг кассын «НӨАТ» мөрөөс авна ──────────
  // Борлуулалт бүрд eBarimt илгээх эсэх — default асаалттай; унтраавал борлуулалт
  // `skipped` статустай бичигдэнэ (НӨАТ задарсан хэвээр, дараа панелиас илгээж болно).
  const [sendEbarimt, setSendEbarimt] = useState(true);
  const buyer = useMemo<EbarimtBuyerInput>(() => {
    const empty: EbarimtBuyerInput = {
      ebarimtConsumerNo: null,
      ebarimtCustomerTin: null,
      ebarimtCustomerRegNo: null,
      skipEbarimt: false,
    };
    if (!ebarimtEnabled) return empty;
    if (!sendEbarimt) return { ...empty, skipEbarimt: true };
    return buyerFromCheckout ?? empty;
  }, [ebarimtEnabled, sendEbarimt, buyerFromCheckout]);

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
    const currency = method.currency || "MNT";
    const rate = currency === "MNT" ? 1 : shift?.fxRates[currency] ?? 0;
    setRows((current) => {
      // Хөндөөгүй анхдагч «Бэлэн» мөр ганцаараа байвал өөр хэлбэр сонгоход СОЛИГДОНО
      // (эс бөгөөс QPay/карт мөр 0 дүнтэй нэмэгдэж, бэлэн мөрийг гараар устгах болдог).
      const replaceAuto = current.length === 1 && current[0].auto;
      const base = replaceAuto ? [] : current;
      const remaining = replaceAuto ? plan.payable : plan.remaining;
      const amount = remaining > EPS && rate > 0 ? String(round2(remaining / rate)) : "";
      return [
      ...base,
      {
        key: seq,
        paymentMethodId: method.id,
        amount,
        reference: "",
        giftCardCode: "",
        storeCreditId: "",
        qpayIntentId: null,
      },
      ];
    });
    setSeq((value) => value + 1);
  }

  const isQpayMethod = (method: PaymentMethodView | undefined) => method?.provider === QPAY_PROVIDER;
  const qpayRows = rows.filter((row) => isQpayMethod(methodById.get(row.paymentMethodId)));
  const qpayUnpaid = qpayRows.some((row) => !row.qpayIntentId);
  const qpayRow = qpayRowKey == null ? null : rows.find((row) => row.key === qpayRowKey) ?? null;

  /** QPay intent-ийн snapshot = суурь оролт + одоогийн мөрүүд + худалдан авагч. */
  function buildSaleInput(): CreatePosSaleInput {
    return {
      ...saleDraft,
      payments: rows
        .filter((row) => Number(row.amount) > 0)
        .map((row) => ({
          paymentMethodId: row.paymentMethodId,
          amount: Number(row.amount),
          reference: row.reference.trim() || null,
          giftCardCode: row.giftCardCode.trim() || null,
          storeCreditId: row.storeCreditId || null,
        })),
      ebarimtConsumerNo: buyer.ebarimtConsumerNo,
      ebarimtCustomerTin: buyer.ebarimtCustomerTin,
      ebarimtCustomerRegNo: buyer.ebarimtCustomerRegNo,
      skipEbarimt: buyer.skipEbarimt,
    };
  }

  function patchRow(key: number, patch: Partial<PaymentRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch, auto: false } : row)));
  }

  function removeRow(key: number) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  // QPay мөр бүр төлөгдсөн intent-тэй байх ёстой (сервер ч мөн шаардана); нэг л QPay мөр.
  const canSubmit =
    rows.length > 0 && plan.remaining <= EPS && !busy && !qpayUnpaid && qpayRows.length <= 1;

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
    const ok = await onConfirm(payments, buyer, { qpayIntentId: qpayRows[0]?.qpayIntentId ?? null });
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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {activeMethods.map((method) => (
            <Button
              key={method.id}
              variant="outline"
              size="lg"
              type="button"
              onClick={() => addMethod(method)}
              title={PAYMENT_KIND_LABELS[method.kind]}
              className="h-14 w-full text-base font-semibold"
            >
              {method.name}
              {method.currency !== "MNT" && (
                <span className="font-mono text-[10px] text-[var(--ea-text-3)]">{method.currency}</span>
              )}
            </Button>
          ))}
          {activeMethods.length === 0 && (
            <span className="col-span-full text-xs text-[var(--ea-danger-fg)]">
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
                    // Анхдагч «Бэлэн» мөрийн дүнг шууд дарж бичих (өгсөн мөнгө).
                    onFocus={(event) => event.currentTarget.select()}
                    value={row.amount}
                    placeholder={currency}
                    readOnly={!!row.qpayIntentId}
                    onChange={(event) => patchRow(row.key, { amount: event.target.value })}
                    className="font-mono text-right"
                  />
                </div>
                <div>
                  {isQpayMethod(method) ? (
                    row.qpayIntentId ? (
                      <div className="flex items-center gap-2 text-xs">
                        <StatusBadge tone="success" size="sm">
                          Төлөгдсөн
                        </StatusBadge>
                        {row.reference && <span className="truncate font-mono text-[var(--ea-text-3)]">{row.reference}</span>}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={!(Number(row.amount) > 0) || busy}
                        onClick={() => setQpayRowKey(row.key)}
                      >
                        QR үүсгэх
                      </Button>
                    )
                  ) : method.kind === "gift_card" ? (
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
                  ) : method.requiresReference ? (
                    // Лавлах дугаар нь ЗААВАЛ гэж тохируулсан хэлбэрт л гарна
                    // (терминалын слип г.м.). Сонголттой чөлөөт талбар байхгүй —
                    // кассчинд утга нь ойлгомжгүй, хоосон үлддэг байв.
                    <Input
                      value={row.reference}
                      placeholder="Лавлах дугаар (заавал)"
                      onChange={(event) => patchRow(row.key, { reference: event.target.value })}
                    />
                  ) : (
                    <span />
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

        {nonVat && (
          <div className="rounded-md border border-[var(--ea-warning)] bg-[var(--ea-warning-bg)] p-2 text-xs text-[var(--ea-warning-fg)]">
            НӨАТ-гүй борлуулалт — НӨАТ задлахгүй, eBarimt үүсэхгүй (тусдаа орлого/авлагын данс).
          </div>
        )}
        {ebarimtEnabled && (
          <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-2">
            <SwitchField
              label="eBarimt баримт илгээх"
              hint={
                sendEbarimt
                  ? buyerLabel
                    ? `Худалдан авагч: ${buyerLabel}`
                    : undefined
                  : "Энэ борлуулалт ТЕГ-д илгээгдэхгүй — «Илгээгээгүй» статустай бичигдэнэ; дараа нь панелиас илгээж болно"
              }
              checked={sendEbarimt}
              onChange={setSendEbarimt}
            />
          </div>
        )}

        {plan.warnings.length > 0 && (
          <ul className="space-y-0.5 text-xs text-[var(--ea-warning-fg)]">
            {plan.warnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
        )}

        {qpayRow && shift && (
          <QpayDialog
            open
            amount={Number(qpayRow.amount)}
            shiftId={shift.id}
            saleInput={buildSaleInput()}
            onPaid={(intent) => {
              patchRow(qpayRow.key, {
                qpayIntentId: intent.id,
                amount: String(intent.amount),
                reference: intent.qpayInvoiceId ?? "",
              });
            }}
            onClose={() => setQpayRowKey(null)}
          />
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
