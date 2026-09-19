"use client";

// Ээлжийн формууд — docs/pos §3.3 ①⑥, §4.5:
//   OpenShiftForm   касс + агуулах + эхний мөнгө + валютын ханш мөрүүд
//                   (кассын дэлгэц дээр inline карт, Борлуулалт → Ээлж дээр диалог)
//   CloseShiftDialog тоолсон бэлэн → closeShift → систем / зөрүү
//   ZReportDialog   ээлжийн нэгтгэл + хэвлэх (`usePosPrint`, pos-receipt class)
//
// Ханш ЗОХИОГДОХГҮЙ — хэрэглэгч валют бүрд гараар оруулна (дэлгүүрийн ханш).

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { usePosPrint } from "@/components/pos/receipt-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { closeShift, openShift } from "@/lib/actions/pos";
import type { PosShiftView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";

export interface ShiftCashAccount {
  id: string;
  name: string;
  currency: string;
}

export interface ShiftWarehouse {
  id: string;
  code: string;
  name: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

// ── Ээлж нээх ────────────────────────────────────────────────────────────────

export function OpenShiftForm({
  cashAccounts,
  warehouses,
  defaultWarehouseId,
  onDone,
  onCancel,
}: {
  cashAccounts: ShiftCashAccount[];
  warehouses: ShiftWarehouse[];
  defaultWarehouseId?: string | null;
  onDone: (shift: { id: string; documentNo: string }) => void;
  onCancel?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const mntAccounts = useMemo(
    () => cashAccounts.filter((account) => account.currency === "MNT"),
    [cashAccounts]
  );
  const fxCurrencies = useMemo(
    () => [...new Set(cashAccounts.map((a) => a.currency).filter((c) => c !== "MNT"))],
    [cashAccounts]
  );
  const [cashAccountId, setCashAccountId] = useState(mntAccounts[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(
    defaultWarehouseId && warehouses.some((w) => w.id === defaultWarehouseId)
      ? defaultWarehouseId
      : (warehouses[0]?.id ?? "")
  );
  const [openingFloat, setOpeningFloat] = useState("0");
  const [note, setNote] = useState("");
  const [rates, setRates] = useState<{ currency: string; rate: string }[]>(() =>
    fxCurrencies.map((currency) => ({ currency, rate: "" }))
  );

  function submit() {
    if (!cashAccountId) return toast.error("Кассын данс сонгоно уу");
    if (!warehouseId) return toast.error("Агуулах сонгоно уу");
    const fxRates: Record<string, number> = {};
    for (const row of rates) {
      const code = row.currency.trim().toUpperCase();
      if (!code) continue;
      const rate = Number(row.rate);
      if (!row.rate.trim()) continue;
      if (!(rate > 0)) return toast.error(`${code} ханш 0-ээс их байна`);
      fxRates[code] = rate;
    }
    startTransition(async () => {
      const result = await openShift({
        cashAccountId,
        warehouseId,
        openingFloat: Number(openingFloat) || 0,
        fxRates,
        note: note.trim() || undefined,
      });
      if (result.error || !result.id) {
        toast.error(result.error ?? "Ээлж нээгдсэнгүй");
        return;
      }
      toast.success(`${result.documentNo} ээлж нээгдлээ`);
      onDone({ id: result.id, documentNo: result.documentNo });
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Кассын данс (MNT)">
          <select
            className="ea-form-select"
            value={cashAccountId}
            onChange={(event) => setCashAccountId(event.target.value)}
          >
            <option value="">— Сонгох —</option>
            {mntAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Агуулах">
          <select
            className="ea-form-select"
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
          >
            <option value="">— Сонгох —</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Эхний мөнгө (₮)">
          <Input
            type="number"
            min="0"
            value={openingFloat}
            onChange={(event) => setOpeningFloat(event.target.value)}
            className="font-mono text-right"
          />
        </Field>
        <Field label="Тэмдэглэл">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Валютын ханш (бэлэн валют авбал)</Label>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setRates((current) => [...current, { currency: "", rate: "" }])}
          >
            <Icon name="add" size="sm" />
            Валют нэмэх
          </Button>
        </div>
        {rates.length === 0 ? (
          <p className="text-xs text-[var(--ea-text-3)]">
            Валютын кассын данс алга — ханш шаардлагагүй.
          </p>
        ) : (
          <div className="space-y-1.5">
            {rates.map((row, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={row.currency}
                  placeholder="USD"
                  maxLength={3}
                  className="w-24 font-mono uppercase"
                  onChange={(event) =>
                    setRates((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, currency: event.target.value.toUpperCase() } : entry
                      )
                    )
                  }
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.rate}
                  placeholder="Ханш (₮)"
                  className="font-mono text-right"
                  onChange={(event) =>
                    setRates((current) =>
                      current.map((entry, i) =>
                        i === index ? { ...entry, rate: event.target.value } : entry
                      )
                    )
                  }
                />
                <IconAction
                  name="close"
                  label="Хасах"
                  size="sm"
                  onClick={() => setRates((current) => current.filter((_, i) => i !== index))}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Болих
          </Button>
        )}
        <Button onClick={submit} disabled={isPending}>
          <Icon name="unlocked" size="sm" />
          Ээлж нээх
        </Button>
      </div>
    </div>
  );
}

export function OpenShiftDialog({
  open,
  onOpenChange,
  onDone,
  ...formProps
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (shift: { id: string; documentNo: string }) => void;
  cashAccounts: ShiftCashAccount[];
  warehouses: ShiftWarehouse[];
  defaultWarehouseId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ээлж нээх</DialogTitle>
          <DialogDescription>
            Касс, агуулах, эхний мөнгө. Валютын бэлэн авбал ханшийг гараар оруулна.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <OpenShiftForm
            {...formProps}
            onCancel={() => onOpenChange(false)}
            onDone={(shift) => {
              onOpenChange(false);
              onDone(shift);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Ээлж хаах ────────────────────────────────────────────────────────────────

export function CloseShiftDialog({
  shift,
  onClose,
  onDone,
}: {
  shift: PosShiftView | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [countedCash, setCountedCash] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ systemCash: number; variance: number } | null>(null);

  function submit() {
    if (!shift) return;
    const counted = Number(countedCash);
    if (!(counted >= 0) || countedCash.trim() === "")
      return toast.error("Тоолсон бэлэн мөнгөө оруулна уу");
    startTransition(async () => {
      const response = await closeShift(shift.id, { countedCash: counted, note: note.trim() || undefined });
      if (response.error || response.systemCash == null) {
        toast.error(response.error ?? "Ээлж хаагдсангүй");
        return;
      }
      setResult({ systemCash: response.systemCash, variance: response.variance ?? 0 });
      toast.success(`${shift.documentNo} ээлж хаагдлаа`);
      onDone();
    });
  }

  const expected = shift
    ? shift.openingFloat + shift.cashReceipts - shift.cashRefunds
    : 0;

  return (
    <Dialog
      open={shift !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCountedCash("");
          setNote("");
          setResult(null);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ээлж хаах — {shift?.documentNo}</DialogTitle>
          <DialogDescription>
            Систем = эхний мөнгө + бэлэн орлого − бэлэн буцаалт. Зөрүү кассын
            баримтаар (илүү / дутуу данс) бичигдэнэ.
          </DialogDescription>
        </DialogHeader>
        {shift && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-[var(--ea-text-3)]">Эхний мөнгө</span>
              <span className="text-right font-mono">{fmtMnt(shift.openingFloat)}</span>
              <span className="text-[var(--ea-text-3)]">Бэлэн орлого</span>
              <span className="text-right font-mono">{fmtMnt(shift.cashReceipts)}</span>
              <span className="text-[var(--ea-text-3)]">Бэлэн буцаалт</span>
              <span className="text-right font-mono">−{fmtMnt(shift.cashRefunds)}</span>
              <span className="font-medium">Систем (урьдчилсан)</span>
              <span className="text-right font-mono font-semibold">{fmtMnt(expected)}</span>
            </div>
            {result ? (
              <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] p-3 text-sm">
                <div className="flex justify-between">
                  <span>Систем</span>
                  <span className="font-mono">{fmtMnt(result.systemCash)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Тоолсон</span>
                  <span className="font-mono">{fmtMnt(Number(countedCash))}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Зөрүү</span>
                  <span
                    className={`font-mono ${
                      result.variance === 0
                        ? "text-[var(--ea-success-fg)]"
                        : "text-[var(--ea-danger-fg)]"
                    }`}
                  >
                    {result.variance > 0 ? "+" : ""}
                    {fmtMnt(result.variance)}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <Field label="Тоолсон бэлэн мөнгө (₮)">
                  <Input
                    type="number"
                    min="0"
                    autoFocus
                    value={countedCash}
                    className="font-mono text-right"
                    onChange={(event) => setCountedCash(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submit();
                    }}
                  />
                </Field>
                <Field label="Тэмдэглэл">
                  <Input value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {result ? "Хаах" : "Болих"}
          </Button>
          {!result && (
            <Button onClick={submit} disabled={isPending}>
              <Icon name="locked" size="sm" />
              Ээлж хаах
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Z-тайлан ─────────────────────────────────────────────────────────────────

function ZReportSheet({ shift }: { shift: PosShiftView }) {
  const rows: [string, string][] = [
    ["Ээлж", shift.documentNo],
    ["Касс", shift.cashAccountName],
    ["Агуулах", shift.warehouseName],
    ["Нээсэн", `${fmtTime(shift.openedAt)} · ${shift.openedByName}`],
    ["Хаасан", shift.closedAt ? `${fmtTime(shift.closedAt)} · ${shift.closedByName ?? ""}` : "—"],
  ];
  const money: [string, number | null][] = [
    ["Борлуулалтын тоо", shift.salesCount],
    ["Борлуулалт Σ", shift.salesTotal],
    ["Буцаалт Σ", shift.returnsTotal],
    ["Эхний мөнгө", shift.openingFloat],
    ["Бэлэн орлого", shift.cashReceipts],
    ["Бэлэн буцаалт", shift.cashRefunds],
    ["Систем", shift.systemCash],
    ["Тоолсон", shift.countedCash],
    ["Зөрүү", shift.varianceAmount],
  ];
  return (
    <div className="mx-auto w-[80mm] max-w-full font-mono text-[11px] leading-snug">
      <div className="mb-2 text-center text-[13px] font-bold">Z-ТАЙЛАН</div>
      <div className="border-b border-dashed border-current pb-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span>{label}</span>
            <span className="text-right">{value}</span>
          </div>
        ))}
      </div>
      <div className="pt-1">
        {money.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <span>{label}</span>
            <span>
              {value == null
                ? "—"
                : label === "Борлуулалтын тоо"
                  ? String(value)
                  : fmtMnt(value)}
            </span>
          </div>
        ))}
      </div>
      {shift.note && <div className="mt-1 border-t border-dashed border-current pt-1">{shift.note}</div>}
    </div>
  );
}

export function ZReportDialog({
  shift,
  onClose,
}: {
  shift: PosShiftView | null;
  onClose: () => void;
}) {
  const { print, portal } = usePosPrint(shift ? <ZReportSheet shift={shift} /> : null);
  return (
    <>
      <Dialog
        open={shift !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Z-тайлан — {shift?.documentNo}</DialogTitle>
            <DialogDescription>
              Ээлжийн нэгтгэл: борлуулалт, бэлэн орлого/буцаалт, кассын зөрүү.
            </DialogDescription>
          </DialogHeader>
          {shift && (
            <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] p-3 text-[var(--ea-text-1)]">
              <ZReportSheet shift={shift} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Хаах
            </Button>
            <Button onClick={print}>
              <Icon name="print" size="sm" />
              Хэвлэх
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {portal}
    </>
  );
}
