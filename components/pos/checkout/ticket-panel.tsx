"use client";

// Кассын дэлгэцийн БАРУУН панель = баримт (ticket) — docs/pos §4.1 v2:
//   харилцагч → сагсны мөрүүд (товшиж сонгоно; тоо −/+ эсвэл шууд бичнэ, ×) →
//   дүн (ТӨЛӨХ том) → үйлдлүүд (мөр/баримтын хөнгөлөлт нь F4 цонхонд) → ТӨЛБӨР.
//
// Энэ бол хүрэлцэх дэлгэцийн БАРИМТ, өгөгдлийн хүснэгт биш — тиймээс AG Grid-ийн
// стандарт (CLAUDE.md «Хүснэгтийн стандарт») хамаарахгүй; баримтын preview-тэй
// ижил ангилал. Дүн бүр серверийн quote-оос — энд юу ч тооцогдохгүй.

import { useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import type { SaleQuote } from "@/lib/actions/pos";
import { parseQuantityInput, type CartRow } from "@/lib/pos/checkout-state";
import type { CheckoutCustomer } from "@/lib/pos/load-data";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export interface TicketLineView extends CartRow {
  discountAmount: number;
  discountCodes: string;
  lineTotal: number;
  stockAfter: number;
}

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Хулганы даралт search input-ийн focus-ыг булаахгүй (сканнер тасрахгүй). */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

export function TicketPanel({
  lines,
  selectedKey,
  onSelect,
  onInc,
  onDec,
  onSetQty,
  onQtyEditDone,
  onRemove,
  customerId,
  customerOptions,
  onCustomerChange,
  customer,
  customerRef,
  quote,
  quoteBusy,
  quoteError,
  isVatPayer,
  vatRatePercent,
  discountBreakdown,
  discountsActive,
  onOpenDiscount,
  parkedCount,
  onPark,
  onOpenParked,
  onClear,
  canPay,
  payPending,
  displayTotal,
  saleBusy,
  onPay,
  warehouseName,
  allowNegativeStock,
  vatBar,
}: {
  lines: TicketLineView[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onInc: (key: string) => void;
  onDec: (key: string) => void;
  /** Тоог гараар бичсэн (0 → мөр хасагдана). */
  onSetQty: (key: string, quantity: number) => void;
  /** Тоо бичиж дуусав (Enter / Esc / blur) — сканнерын focus буцна. */
  onQtyEditDone: () => void;
  onRemove: (key: string) => void;
  customerId: string;
  customerOptions: SearchableOption[];
  onCustomerChange: (id: string) => void;
  customer: CheckoutCustomer | null;
  customerRef: RefObject<HTMLDivElement | null>;
  quote: SaleQuote | null;
  quoteBusy: boolean;
  quoteError: string;
  isVatPayer: boolean;
  vatRatePercent: number;
  discountBreakdown: { code: string; amount: number }[];
  /** Купон, баримтын эсвэл мөрийн хөнгөлөлт идэвхтэй (товчны badge). */
  discountsActive: number;
  onOpenDiscount: () => void;
  parkedCount: number;
  onPark: () => void;
  onOpenParked: () => void;
  onClear: () => void;
  canPay: boolean;
  /** ТӨЛБӨР дарагдсан, шинэ үнийн санал хүлээж байна. */
  payPending: boolean;
  /** ТӨЛӨХ — шинэ санал бол серверийнх, эс бөгөөс мөрүүдийн шууд дүн. */
  displayTotal: number;
  saleBusy: boolean;
  onPay: () => void;
  warehouseName: string;
  allowNegativeStock: boolean;
  /** «НӨАТ» / eBarimt мөр (VatReceiptBar) — НӨАТ төлөгч эсвэл eBarimt асаалттай байгууллагад. */
  vatBar?: ReactNode;
}) {
  const negativeLines = lines.filter((line) => line.stockAfter < 0);
  const total = displayTotal;

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface)] p-2.5">
      {/* ── Харилцагч ── */}
      <div ref={customerRef} className="flex items-center gap-2">
        <Icon name="user" size="sm" className="shrink-0 text-[var(--ea-text-3)]" />
        <div className="min-w-0 flex-1">
          <SearchableSelect
            value={customerId}
            onChange={onCustomerChange}
            options={customerOptions}
            hideValue
            placeholder="Бэлэн худалдан авагч"
          />
        </div>
        <span className="hidden shrink-0 font-mono text-[10px] text-[var(--ea-text-4)] sm:inline">F6</span>
      </div>
      {customer && !customer.isWalkIn && (
        <div className="-mt-1 flex flex-wrap gap-x-3 pl-6 text-[11px] text-[var(--ea-text-3)]">
          {customer.customerGroup && <span>Бүлэг: {customer.customerGroup}</span>}
          {customer.creditLimit != null && <span>Зээлийн лимит: {fmtMnt(customer.creditLimit)}₮</span>}
        </div>
      )}
      {vatBar}

      {/* ── Мөрүүд ── */}
      <div
        className="min-h-[9rem] flex-1 overflow-y-auto overscroll-contain rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)]"
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelect(null);
        }}
      >
        {lines.length === 0 ? (
          <div className="flex h-full min-h-[9rem] flex-col items-center justify-center gap-1 px-4 text-center">
            <Icon name="inventory" size="lg" className="text-[var(--ea-text-4)]" />
            <p className="text-sm font-medium text-[var(--ea-text-2)]">Сагс хоосон</p>
            <p className="text-[11px] text-[var(--ea-text-3)]">
              Бараан дээр товших эсвэл сканнераар уншуулна
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--ea-border)]">
            {lines.map((line, index) => (
              <TicketLine
                key={line.key}
                index={index + 1}
                line={line}
                selected={line.key === selectedKey}
                onSelect={() => onSelect(line.key === selectedKey ? null : line.key)}
                onInc={() => onInc(line.key)}
                onDec={() => onDec(line.key)}
                onSetQty={(quantity) => onSetQty(line.key, quantity)}
                onQtyEditDone={onQtyEditDone}
                onRemove={() => onRemove(line.key)}
              />
            ))}
          </ul>
        )}
      </div>

      {negativeLines.length > 0 && (
        // Мөр бүр дээр анхааруулгын дүрс + үлдэгдэл аль хэдийн байгаа тул энд НЭГ мөр — задаргаа нь title-д (D9).
        <div
          className="shrink-0 truncate rounded-md border border-[var(--ea-warning)] bg-[color-mix(in_srgb,var(--ea-warning)_10%,transparent)] px-2.5 py-1 text-[11px] text-[var(--ea-warning-fg)]"
          title={negativeLines
            .map((line) => `${line.name}: ${fmtQty(line.stockAfter)} ${line.unit}`)
            .join("\n")}
        >
          <Icon name="warning" size="xs" className="mr-1 inline-block align-[-2px]" />
          {negativeLines.length} бараа {warehouseName ? `${warehouseName}-д ` : ""}хасах үлдэгдэлтэй болно
          {!allowNegativeStock ? " — хасах үлдэгдэл хориотой тохиргоотой" : " (борлуулалт зогсохгүй)"}
        </div>
      )}

      {/* ── Дүн ── */}
      <div className="shrink-0 space-y-0.5 px-1 text-xs">
        <TotalRow label="Нийт" value={quote ? fmtMnt(quote.grossAmount) : "0"} />
        {quote && quote.discountTotal > 0 && (
          <>
            <TotalRow label="Хөнгөлөлт" value={`−${fmtMnt(quote.discountTotal)}`} accent />
            {(discountBreakdown.length > 0 || quote.receiptDiscounts.length > 0) && (
              <div className="pl-3 text-[10px] text-[var(--ea-text-4)]">
                {discountBreakdown.map((entry) => (
                  <div key={entry.code} className="flex justify-between">
                    <span className="truncate">{entry.code}</span>
                    <span className="font-mono">−{fmtMnt(entry.amount)}</span>
                  </div>
                ))}
                {quote.receiptDiscounts.map((entry, i) => (
                  <div key={`r-${i}`} className="flex justify-between">
                    <span className="truncate">{entry.ruleCode ?? "Баримтын хөнгөлөлт"}</span>
                    <span className="font-mono">−{fmtMnt(entry.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {isVatPayer && (
          <TotalRow label={`НӨАТ ${vatRatePercent}% (орсон)`} value={quote ? fmtMnt(quote.vatAmount) : "0"} />
        )}
        {quote && quote.cityTaxAmount > 0 && <TotalRow label="НХАТ (орсон)" value={fmtMnt(quote.cityTaxAmount)} />}
        <div className="flex items-baseline justify-between border-t border-[var(--ea-border)] pt-1.5">
          <span className="text-sm font-semibold text-[var(--ea-text-1)]">ТӨЛӨХ</span>
          <span
            className={cn(
              "font-mono text-3xl font-bold tracking-tight text-[var(--ea-text-1)] transition-opacity",
              quoteBusy && "opacity-60"
            )}
          >
            {fmtMnt(total)}
            <span className="ml-1 text-base font-medium text-[var(--ea-text-3)]">₮</span>
          </span>
        </div>
        <div className="h-4 text-[11px] text-[var(--ea-text-4)]">
          {quoteBusy ? "Тооцож байна…" : quoteError ? (
            <span className="text-[var(--ea-danger-fg)]">{quoteError}</span>
          ) : null}
        </div>
      </div>

      {quote && quote.approvalReasons.length > 0 && (
        <div className="shrink-0 rounded-md border border-[var(--ea-warning)] bg-[color-mix(in_srgb,var(--ea-warning)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--ea-warning-fg)]">
          <div className="font-semibold">Менежерийн зөвшөөрөл шаардана (pos:post)</div>
          {quote.approvalReasons.map((reason, index) => (
            <div key={index}>• {reason}</div>
          ))}
        </div>
      )}

      {/* ── Үйлдлүүд ── */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <ActionButton icon="tune" label="Хөнгөлөлт" hint="F4" badge={discountsActive} onClick={onOpenDiscount} />
        <ActionButton
          icon="save"
          label="Түр хадгалах"
          badge={parkedCount}
          onClick={lines.length > 0 ? onPark : onOpenParked}
          onBadgeClick={onOpenParked}
        />
        <ActionButton icon="reset" label="Цэвэрлэх" hint="Esc" onClick={onClear} disabled={lines.length === 0} />
      </div>
      <Button
        size="lg"
        type="button"
        className="sticky bottom-0 h-14 w-full shrink-0 text-lg font-semibold"
        disabled={!canPay}
        onMouseDown={keepFocus}
        onClick={onPay}
      >
        <Icon name="cash" size="lg" />
        {saleBusy ? "Бичиж байна…" : payPending ? "Тооцож байна…" : `ТӨЛБӨР · ${fmtMnt(total)} ₮`}
        <span className="ml-1 font-mono text-xs font-normal opacity-70">F9</span>
      </Button>
    </div>
  );
}

function TicketLine({
  index,
  line,
  selected,
  onSelect,
  onInc,
  onDec,
  onSetQty,
  onQtyEditDone,
  onRemove,
}: {
  index: number;
  line: TicketLineView;
  selected: boolean;
  onSelect: () => void;
  onInc: () => void;
  onDec: () => void;
  onSetQty: (quantity: number) => void;
  onQtyEditDone: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      role="button"
      tabIndex={-1}
      aria-pressed={selected}
      onMouseDown={keepFocus}
      onClick={onSelect}
      className={cn(
        "ea-interactive cursor-pointer border-l-[3px] px-2 py-1.5",
        selected
          ? "border-l-[var(--ea-primary)] bg-[var(--ea-selected-bg)]"
          : "border-l-transparent hover:bg-[var(--ea-hover-subtle)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--ea-text-1)]">
          <span className="mr-1.5 font-mono text-[10px] text-[var(--ea-text-4)]">{index}</span>
          {line.name}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-semibold text-[var(--ea-text-1)]">
          {fmtMnt(line.lineTotal)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-mono text-[11px] text-[var(--ea-text-3)]">
          {fmtQty(line.quantity)} × {" "}
          {fmtMnt(line.unitPrice)}
          {line.discountAmount > 0 && (
            <span className="ml-1.5 text-[var(--ea-success-fg)]" title={line.discountCodes}>
              −{fmtMnt(line.discountAmount)}
              {line.manualDiscountPercent != null && ` (${line.manualDiscountPercent}%)`}
            </span>
          )}
          {line.stockAfter < 0 && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[var(--ea-warning-fg)]">
              <Icon name="warning" size="xs" label="Хасах үлдэгдэл" />
              {fmtQty(line.stockAfter)}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          <QtyButton label="Хасах" onClick={onDec}>
            <Icon name="minus" size="sm" />
          </QtyButton>
          <QtyInput
            quantity={line.quantity}
            unit={line.unit}
            onCommit={onSetQty}
            onDone={onQtyEditDone}
          />
          <QtyButton label="Нэмэх" onClick={onInc}>
            <Icon name="add" size="sm" />
          </QtyButton>
          <QtyButton label="Мөр хасах" onClick={onRemove} danger>
            <Icon name="close" size="sm" />
          </QtyButton>
        </span>
      </div>
    </li>
  );
}

/**
 * Мөрийн тоо — товшоод шууд бичнэ (утсан дээр тоон гар). Enter / focus алдахад
 * хадгална, Esc буцаана; гажиг утга хуучнаараа үлдэнэ, 0 → мөр хасагдана.
 * Хулганы даралт мөрийн `keepFocus`-т хүрэхгүй (stopPropagation) — эс бөгөөс
 * input focus авч чадахгүй.
 */
function QtyInput({
  quantity,
  unit,
  onCommit,
  onDone,
}: {
  quantity: number;
  unit: string;
  onCommit: (quantity: number) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Esc-ийн дараах blur хуучин draft-аар хадгалахгүй (setState нь асинхрон).
  const cancelled = useRef(false);

  function finish() {
    if (draft === null || cancelled.current) {
      cancelled.current = false;
      return;
    }
    const value = parseQuantityInput(draft);
    setDraft(null);
    if (value !== null && value !== quantity) onCommit(value);
    onDone();
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      tabIndex={-1}
      aria-label={`Тоо хэмжээ (${unit})`}
      title="Товшоод тоо бичнэ"
      value={draft ?? fmtQty(quantity)}
      onMouseDown={(event) => event.stopPropagation()}
      onFocus={(event) => {
        cancelled.current = false;
        setDraft(fmtQty(quantity).replace(/,/g, ""));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          setDraft(null);
          onDone();
        }
      }}
      className="h-8 w-14 rounded-md border border-transparent bg-transparent px-1 text-center font-mono text-sm font-semibold text-[var(--ea-text-1)] hover:border-[var(--ea-border)] focus:border-[var(--ea-primary)] focus:bg-[var(--ea-surface)] focus:outline-none"
    />
  );
}

function QtyButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn(
        "ea-interactive flex h-8 w-8 items-center justify-center rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] text-[var(--ea-text-2)] hover:border-[var(--ea-border-strong)] hover:text-[var(--ea-text-1)] active:translate-y-px",
        danger && "ml-1 hover:border-[var(--ea-danger)] hover:text-[var(--ea-danger-fg)]"
      )}
    >
      {children}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  hint,
  badge,
  disabled,
  onClick,
  onBadgeClick,
}: {
  icon: "tune" | "save" | "reset";
  label: string;
  hint?: string;
  badge?: number;
  disabled?: boolean;
  onClick: () => void;
  onBadgeClick?: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      className="ea-interactive relative flex h-11 flex-col items-center justify-center rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface-raised)] text-[11px] font-medium text-[var(--ea-text-2)] hover:border-[var(--ea-border-strong)] hover:text-[var(--ea-text-1)] active:translate-y-px disabled:pointer-events-none disabled:opacity-40"
    >
      <span className="flex items-center gap-1">
        <Icon name={icon} size="sm" />
        {label}
      </span>
      {hint && <span className="font-mono text-[9px] text-[var(--ea-text-4)]">{hint}</span>}
      {(badge ?? 0) > 0 && (
        <span
          role={onBadgeClick ? "button" : undefined}
          onMouseDown={keepFocus}
          onClick={
            onBadgeClick
              ? (event) => {
                  event.stopPropagation();
                  onBadgeClick();
                }
              : undefined
          }
          className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ea-primary)] px-1 font-mono text-[10px] font-semibold text-[var(--primary-foreground)]"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function TotalRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--ea-text-3)]">{label}</span>
      <span className={cn("font-mono", accent ? "text-[var(--ea-success-fg)]" : "text-[var(--ea-text-2)]")}>
        {value}
      </span>
    </div>
  );
}
