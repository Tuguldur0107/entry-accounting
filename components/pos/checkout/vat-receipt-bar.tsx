"use client";

// Кассын «НӨАТ» мөр — сагсны дээр, харилцагчийн доор.
//
//   ☑ НӨАТ (eBarimt)  [Хувь хүн | ААН]
//        ААН → ТТД (11/14) шууд (үндсэн зам — нэр нь ТЕГ-ээс) эсвэл регистр (7 орон) →
//        ТЕГ-ээс ТТД + НЭР автоматаар (lib/pos/ebarimt-buyer.ts; регистрээр лавлах 2026-06-15-аас хязгаарлагдана)
//   ☐ НӨАТ            → НӨАТ-гүй борлуулалт: НӨАТ задлахгүй, eBarimt үүсэхгүй,
//                       тусдаа орлого/авлагын данс, ШАЛТГААН заавал (lib/pos/non-vat.ts)
// Төлөв нь кассын дэлгэцэд (pos-checkout-view) — энд зөвхөн харагдац.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BuyerState, BuyerType } from "@/lib/pos/ebarimt-buyer";
import { NON_VAT_REASON_PRESETS } from "@/lib/pos/non-vat";

export function VatReceiptBar({
  vatReceipt,
  onVatReceiptChange,
  nonVatReason,
  onNonVatReasonChange,
  ebarimtEnabled,
  buyer,
  onBuyerTypeChange,
  onConsumerNoChange,
  onOrgNoChange,
  problem,
}: {
  vatReceipt: boolean;
  onVatReceiptChange: (value: boolean) => void;
  nonVatReason: string;
  onNonVatReasonChange: (value: string) => void;
  /** eBarimt асаалттай бол худалдан авагчийн сонголт гарна. */
  ebarimtEnabled: boolean;
  buyer: BuyerState;
  onBuyerTypeChange: (type: BuyerType) => void;
  onConsumerNoChange: (value: string) => void;
  onOrgNoChange: (value: string) => void;
  /** Төлбөр хаах шалтгаан (ААН-ий регистр дутуу г.м.) — улаанаар. */
  problem: string | null;
}) {
  return (
    <div
      className={`space-y-1.5 rounded-md border p-2 ${
        vatReceipt
          ? "border-[var(--ea-border)] bg-[var(--ea-bg-2)]"
          : "border-[var(--ea-warning)] bg-[var(--ea-warning-bg)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-[var(--ea-text-1)]">
          <input
            type="checkbox"
            className="size-4 accent-[var(--ea-primary)]"
            checked={vatReceipt}
            onChange={(event) => onVatReceiptChange(event.target.checked)}
          />
          НӨАТ{ebarimtEnabled ? " (eBarimt)" : ""}
        </label>
        {vatReceipt && ebarimtEnabled && (
          <div className="ml-auto flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={buyer.type === "individual" ? "default" : "outline"}
              onClick={() => onBuyerTypeChange("individual")}
            >
              Хувь хүн
            </Button>
            <Button
              type="button"
              size="sm"
              variant={buyer.type === "org" ? "default" : "outline"}
              onClick={() => onBuyerTypeChange("org")}
            >
              ААН
            </Button>
          </div>
        )}
      </div>

      {vatReceipt && ebarimtEnabled && buyer.type === "individual" && (
        <Input
          value={buyer.consumerNo}
          inputMode="numeric"
          maxLength={8}
          placeholder="eBarimt хэрэглэгчийн дугаар (8 орон, сонголтоор)"
          className="h-8 font-mono"
          onChange={(event) => onConsumerNoChange(event.target.value.replace(/\D/g, ""))}
        />
      )}

      {vatReceipt && ebarimtEnabled && buyer.type === "org" && (
        <div className="space-y-1">
          <Input
            value={buyer.orgNo}
            inputMode="numeric"
            maxLength={14}
            autoFocus
            placeholder="Байгууллагын ТТД (11 орон) эсвэл регистр (7 орон)"
            className="h-8 font-mono"
            onChange={(event) => onOrgNoChange(event.target.value)}
          />
          <div className="min-h-4 text-xs">
            {buyer.lookup.status === "loading" && <span className="text-[var(--ea-text-3)]">ТЕГ-ээс шалгаж байна…</span>}
            {buyer.lookup.status === "found" && (
              <span className="font-medium text-[var(--ea-success-fg)]">
                {buyer.lookup.name || "Нэр уншигдсангүй"} · ТТД {buyer.lookup.tin}
              </span>
            )}
            {buyer.lookup.status !== "loading" && buyer.lookup.status !== "found" && problem && (
              <span className="text-[var(--ea-danger-fg)]">{problem}</span>
            )}
          </div>
        </div>
      )}

      {vatReceipt && ebarimtEnabled && buyer.type === "individual" && problem && (
        <div className="text-xs text-[var(--ea-danger-fg)]">{problem}</div>
      )}

      {!vatReceipt && (
        <div className="space-y-1.5">
          <div className="text-xs text-[var(--ea-warning-fg)]">
            НӨАТ-гүй борлуулалт — НӨАТ задлахгүй, eBarimt үүсэхгүй, тусдаа орлого/авлагын дансаар бичигдэнэ
            (менежерийн эрх).
          </div>
          <div className="flex flex-wrap gap-1">
            {NON_VAT_REASON_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                size="xs"
                variant={nonVatReason === preset ? "default" : "outline"}
                onClick={() => onNonVatReasonChange(preset)}
              >
                {preset}
              </Button>
            ))}
          </div>
          <Input
            value={nonVatReason}
            maxLength={200}
            placeholder="Шалтгаан (заавал)"
            className="h-8"
            onChange={(event) => onNonVatReasonChange(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
