"use client";

// ОАТ-ын тэмдгийн QR уншуулах цонх — архи, тамхи зэрэг ОАТ-ын тэмдэгтэй барааны
// ширхэг бүрийн тэмдгийн QR-ийг сканнераар (Enter-ээр төгсдөг) эсвэл гараар.
// Дүрэм нь ЦЭВЭР `lib/pos/stock-qr.ts` + `addStockQr` (checkout-state.ts) — сервер
// ч ИЖИЛ дүрмээр шалгана (createPosSale). Уншуулсан QR eBarimt-ийн
// `items[].data.stockQR`-д явна.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import type { CartRow } from "@/lib/pos/checkout-state";

export function StockQrDialog({
  row,
  onOpenChange,
  onAdd,
  onRemove,
}: {
  /** Нээлттэй мөр — null бол цонх хаалттай. */
  row: CartRow | null;
  onOpenChange: (open: boolean) => void;
  /** QR нэмнэ — алдаа бол монгол тайлбар, амжилтад null. */
  onAdd: (code: string) => string | null;
  onRemove: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const codes = row?.stockQr ?? [];
  const need = row ? Math.floor(row.quantity) : 0;
  const complete = codes.length === need;

  function commit() {
    if (!value.trim()) return;
    const problem = onAdd(value);
    setError(problem ?? "");
    if (!problem) setValue("");
  }

  return (
    <Dialog
      open={!!row}
      onOpenChange={(open) => {
        if (!open) {
          setValue("");
          setError("");
        }
        onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ОАТ-ын тэмдгийн QR</DialogTitle>
          <DialogDescription>
            {row?.name} — ширхэг бүрийн онцгой албан татварын тэмдгийн QR-ийг уншуулна ({codes.length}/{need}).
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={value}
            className="font-mono"
            placeholder="Тэмдгийн QR-ийг уншуулна уу"
            aria-label="ОАТ-ын тэмдгийн QR"
            disabled={complete}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
          />
          <Button type="button" onClick={commit} disabled={complete || !value.trim()}>
            Нэмэх
          </Button>
        </div>
        {error && <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>}
        {complete && <p className="text-xs text-[var(--ea-success-fg)]">Бүх ширхэгийн тэмдэг уншигдлаа</p>}
        {codes.length > 0 && (
          <ul className="max-h-60 divide-y divide-[var(--ea-border)] overflow-y-auto rounded-md border border-[var(--ea-border)]">
            {codes.map((code, index) => (
              <li key={code} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-5 font-mono text-[10px] text-[var(--ea-text-4)]">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--ea-text-2)]">{code}</span>
                <IconAction name="delete" label="Хасах" size="sm" variant="danger" onClick={() => onRemove(code)} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Хаах
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
