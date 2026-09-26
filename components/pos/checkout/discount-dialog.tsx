"use client";

// Хөнгөлөлтийн диалог (F4) — купон, баримтын гар хөнгөлөлт, МӨРИЙН % хөнгөлөлт
// НЭГ газар (numpad 2026-09-26-нд хасагдсан). Кассын дэлгэцээс тусад нь
// гаргаснаар баримтын панель цэвэрхэн үлдэнэ; дүн нь серверийн quote-оос.

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { parseDiscountPercentInput } from "@/lib/pos/checkout-state";

export interface DiscountDialogLine {
  key: string;
  name: string;
  quantity: number;
  unit: string;
  manualDiscountPercent: number | null;
  /** Мөрийн ₮ хөнгөлөлт (хуучин паркаас) — % бичвэл арилна. */
  manualDiscountAmount: number | null;
}

export function DiscountDialog({
  open,
  onOpenChange,
  couponCodes,
  onCouponCodesChange,
  receiptDiscountMode,
  onReceiptDiscountModeChange,
  receiptDiscountValue,
  onReceiptDiscountValueChange,
  maxManualDiscountPercent,
  lines,
  onLineDiscountChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  couponCodes: string[];
  onCouponCodesChange: (codes: string[]) => void;
  receiptDiscountMode: "percent" | "amount";
  onReceiptDiscountModeChange: (mode: "percent" | "amount") => void;
  receiptDiscountValue: string;
  onReceiptDiscountValueChange: (value: string) => void;
  maxManualDiscountPercent: number;
  lines: DiscountDialogLine[];
  /** null = мөрийн хөнгөлөлт арилгах. */
  onLineDiscountChange: (key: string, percent: number | null) => void;
}) {
  const [couponInput, setCouponInput] = useState("");

  function addCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    if (couponCodes.includes(code)) {
      toast.info("Энэ купон нэмэгдсэн байна");
      setCouponInput("");
      return;
    }
    onCouponCodesChange([...couponCodes, code]);
    setCouponInput("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Хөнгөлөлт</DialogTitle>
          <DialogDescription>
            Купон код, баримтын нийт дүнгийн эсвэл тухайн барааны (мөрийн) хөнгөлөлт.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Купон / промо код</Label>
            <div className="flex gap-1.5">
              <Input
                autoFocus
                value={couponInput}
                placeholder="PROMO2026"
                className="font-mono uppercase"
                onChange={(event) => setCouponInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addCoupon();
                  }
                }}
              />
              <Button variant="outline" type="button" onClick={addCoupon}>
                Нэмэх
              </Button>
            </div>
            {couponCodes.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {couponCodes.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--ea-border)] px-2 py-0.5 font-mono text-[11px]"
                  >
                    {code}
                    <IconAction
                      name="close"
                      label={`${code} хасах`}
                      size="xs"
                      onClick={() => onCouponCodesChange(couponCodes.filter((entry) => entry !== code))}
                    />
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Баримтын хөнгөлөлт</Label>
            <div className="flex gap-1.5">
              <select
                className="ea-form-select w-24"
                value={receiptDiscountMode}
                onChange={(event) => onReceiptDiscountModeChange(event.target.value as "percent" | "amount")}
              >
                <option value="percent">%</option>
                <option value="amount">₮</option>
              </select>
              <Input
                type="number"
                min="0"
                inputMode="decimal"
                value={receiptDiscountValue}
                placeholder={receiptDiscountMode === "percent" ? `≤ ${maxManualDiscountPercent}%` : "Дүн"}
                className="font-mono text-right"
                onChange={(event) => onReceiptDiscountValueChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onOpenChange(false);
                  }
                }}
              />
              {receiptDiscountValue && (
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onReceiptDiscountValueChange("")}
                >
                  Арилгах
                </Button>
              )}
            </div>
          </div>

          {lines.length > 0 && (
            <div className="space-y-1.5">
              <Label>Барааны хөнгөлөлт (%)</Label>
              <ul className="max-h-48 divide-y divide-[var(--ea-border)] overflow-y-auto rounded-md border border-[var(--ea-border)]">
                {lines.map((line) => (
                  <LineDiscountRow key={line.key} line={line} onChange={onLineDiscountChange} />
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-[var(--ea-text-3)]">
            Гар хөнгөлөлт {maxManualDiscountPercent}%-аас их бол менежерийн зөвшөөрөл (pos:post) шаардана.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Болсон
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineDiscountRow({
  line,
  onChange,
}: {
  line: DiscountDialogLine;
  onChange: (key: string, percent: number | null) => void;
}) {
  const [draft, setDraft] = useState(line.manualDiscountPercent?.toString() ?? "");
  // Бичих тухай бүр сагсанд орно (баримтын хөнгөлөлттэй ижил) — Esc / × дарсан ч алдагдахгүй.
  const invalid = parseDiscountPercentInput(draft) === undefined;

  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ea-text-1)]">
        {line.name}
        <span className="ml-1.5 font-mono text-[11px] text-[var(--ea-text-3)]">
          × {line.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} {line.unit}
        </span>
        {line.manualDiscountAmount != null && line.manualDiscountPercent == null && (
          <span className="ml-1.5 font-mono text-[11px] text-[var(--ea-success-fg)]">
            −{line.manualDiscountAmount.toLocaleString("en-US")}₮
          </span>
        )}
      </span>
      <Input
        type="text"
        inputMode="decimal"
        aria-label={`${line.name} — хөнгөлөлт %`}
        aria-invalid={invalid || undefined}
        title={invalid ? "0–100% хооронд" : undefined}
        value={draft}
        placeholder="0"
        className="h-8 w-20 font-mono text-right"
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const value = parseDiscountPercentInput(text);
          if (value !== undefined && value !== line.manualDiscountPercent) onChange(line.key, value);
        }}
        onBlur={() => {
          if (invalid) setDraft(line.manualDiscountPercent?.toString() ?? "");
        }}
      />
      <span className="text-[11px] text-[var(--ea-text-3)]">%</span>
    </li>
  );
}
