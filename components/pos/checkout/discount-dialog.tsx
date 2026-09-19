"use client";

// Хөнгөлөлтийн диалог (F4) — купон + баримтын гар хөнгөлөлт. Кассын дэлгэцээс
// тусад нь гаргаснаар баримтын панель цэвэрхэн үлдэнэ; дүн нь серверийн quote-оос.

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
            Купон код эсвэл баримтын нийт дүнгийн хөнгөлөлт. Мөрийн хөнгөлөлтийг numpad-ийн «Хөнг %»-аар өгнө.
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
            <p className="text-[11px] text-[var(--ea-text-3)]">
              Хязгаараас хэтэрсэн хөнгөлөлт менежерийн зөвшөөрөл (pos:post) шаардана.
            </p>
          </div>
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
