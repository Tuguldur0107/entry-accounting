"use client";

// Ээлжийн формууд — docs/pos §3.3 ①⑥, §4.5:
//   OpenShiftForm   НЭГ ТОВЧНЫ нээлт: касс / агуулах / эхний мөнгө сүүлийн
//                   ээлжээс default, валютын ханш хумигдсан (кассын дэлгэц дээр
//                   диалог, Борлуулалт → Ээлж дээр OpenShiftDialog)
//   CloseShiftDialog тоолсон бэлэн → closeShift → систем / зөрүү
//   ZReportDialog   ээлжийн нэгтгэл + хэвлэх (`usePosPrint`, pos-receipt class)
//
// Ханш ЗОХИОГДОХГҮЙ — хэрэглэгч валют бүрд гараар оруулна (дэлгүүрийн ханш).

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { FormField } from "@/components/ui/form-field";
import { closeShift, openShift } from "@/lib/actions/pos";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { isLargeShiftVariance, shiftVarianceThreshold } from "@/lib/pos/shift-variance";
import {
  SHIFT_DEVICE_STORAGE_KEY,
  parseShiftDevicePicks,
  pickShiftDefaults,
  rememberShiftDevicePick,
} from "@/lib/pos/shift-device";
import type { PosShiftView } from "@/lib/pos/types";
import { fmtMnt } from "@/lib/reports/balances";

export interface ShiftCashAccount {
  id: string;
  name: string;
  currency: string;
  /** cash_accounts.accountType — өгвөл зөвхөн "cash" төрлийг санал болгоно. */
  accountType?: string;
}

export interface ShiftWarehouse {
  id: string;
  code: string;
  name: string;
}

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("sv-SE", { timeZone: "Asia/Ulaanbaatar" }).slice(0, 16);
};

// ── Ээлж нээх ────────────────────────────────────────────────────────────────
//
// НЭГ ТОВЧНЫ нээлт (docs/pos §4.1 v2): касс / агуулах / эхний мөнгө нь сүүлийн
// ээлжээс default-оор бөглөгдөнө — кассчин ихэнхдээ зөвхөн «Ээлж нээх» дарна.
// Олон салбартай бол ЭНЭ ТӨХӨӨРӨМЖ дээр сүүлд нээсэн касс / агуулах түрүүлнэ
// (lib/pos/shift-device.ts, localStorage) — салбар бүрийн PC өөрийнхөө салбарыг.
// Эхний мөнгөний санал нь сүүлийн ээлжийн КАССТАЙ таарвал л (өөр салбарын
// тоолсон бэлэн санал болгохгүй).

function readDevicePicks() {
  try {
    const raw = window.localStorage.getItem(SHIFT_DEVICE_STORAGE_KEY);
    return parseShiftDevicePicks(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

function saveDevicePick(cashAccountId: string, warehouseId: string) {
  try {
    const next = rememberShiftDevicePick(readDevicePicks(), { cashAccountId, warehouseId });
    window.localStorage.setItem(SHIFT_DEVICE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Хувийн цонх / хаалттай storage — санамжгүй ч ээлж нээгдэнэ.
  }
}
// Валютын ханш хумигдсан (валютын касс байвал л товч гарна); ханш ЗОХИОГДОХГҮЙ.

export function OpenShiftForm({
  cashAccounts,
  warehouses,
  defaultWarehouseId,
  defaultCashAccountId,
  defaultOpeningFloat,
  openingHint,
  autoFocus = false,
  onDone,
  onCancel,
}: {
  cashAccounts: ShiftCashAccount[];
  warehouses: ShiftWarehouse[];
  defaultWarehouseId?: string | null;
  /** Сүүлийн ээлжийн касс — жагсаалтад байвал сонгогдсон байна. */
  defaultCashAccountId?: string | null;
  /** Санал болгох эхний мөнгө (ж: сүүлийн хаагдсан ээлжийн тоолсон бэлэн). */
  defaultOpeningFloat?: number | null;
  /** Эхний мөнгөний тайлбар («Өмнөх ээлжийн тоолсон бэлэн» г.м.). */
  openingHint?: string;
  autoFocus?: boolean;
  onDone: (shift: { id: string; documentNo: string }) => void;
  onCancel?: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const mntAccounts = useMemo(
    () =>
      cashAccounts.filter(
        (account) =>
          account.currency === "MNT" && (account.accountType == null || account.accountType === "cash")
      ),
    [cashAccounts]
  );
  const fxCurrencies = useMemo(
    () => [...new Set(cashAccounts.map((a) => a.currency).filter((c) => c !== "MNT"))],
    [cashAccounts]
  );
  // SSR-тэй ижил анхны утга (байгууллагын сүүлийн ээлж) — төхөөрөмжийн санамжийг
  // mount-ын дараа л уншина (hydration зөрөхгүй).
  const initial = pickShiftDefaults({
    devicePicks: [],
    cashAccountIds: mntAccounts.map((a) => a.id),
    warehouseIds: warehouses.map((w) => w.id),
    fallbackCashAccountId: defaultCashAccountId,
    fallbackWarehouseId: defaultWarehouseId,
  });
  const [cashAccountId, setCashAccountIdState] = useState(initial.cashAccountId);
  const [warehouseId, setWarehouseIdState] = useState(initial.warehouseId);
  /** Эхний мөнгөний санал зөвхөн сүүлийн ээлжийн КАССАД хамаарна. */
  const floatFor = (id: string) =>
    defaultOpeningFloat != null &&
    defaultOpeningFloat >= 0 &&
    (!defaultCashAccountId || id === defaultCashAccountId)
      ? String(defaultOpeningFloat)
      : "0";
  const [openingFloat, setOpeningFloat] = useState(() => floatFor(initial.cashAccountId));
  const floatTouched = useRef(false);
  const selectionTouched = useRef(false);

  const applyCashAccount = (id: string) => {
    setCashAccountIdState(id);
    if (!floatTouched.current) setOpeningFloat(floatFor(id));
  };
  const setCashAccountId = (id: string) => {
    selectionTouched.current = true;
    applyCashAccount(id);
  };
  const setWarehouseId = (id: string) => {
    selectionTouched.current = true;
    setWarehouseIdState(id);
  };

  useEffect(() => {
    const device = pickShiftDefaults({
      devicePicks: readDevicePicks(),
      cashAccountIds: mntAccounts.map((a) => a.id),
      warehouseIds: warehouses.map((w) => w.id),
    });
    if (!device.fromDevice || selectionTouched.current) return;
    applyCashAccount(device.cashAccountId);
    setWarehouseIdState(device.warehouseId);
    // Зөвхөн mount-д нэг удаа — дараагийн сонголт хэрэглэгчийнх.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showFx, setShowFx] = useState(false);
  const [rates, setRates] = useState<{ currency: string; rate: string }[]>(() =>
    fxCurrencies.map((currency) => ({ currency, rate: "" }))
  );

  const singleChoice = mntAccounts.length === 1 && warehouses.length === 1;

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
      saveDevicePick(cashAccountId, warehouseId);
      toast.success(`${result.documentNo} ээлж нээгдлээ`);
      onDone({ id: result.id, documentNo: result.documentNo });
    });
  }

  const cashName = mntAccounts.find((a) => a.id === cashAccountId)?.name ?? "";
  const warehouse = warehouses.find((w) => w.id === warehouseId);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isPending) submit();
      }}
    >
      {singleChoice ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
          <span>
            Касс: <span className="font-medium text-[var(--ea-text-1)]">{cashName}</span>
          </span>
          <span>
            Агуулах:{" "}
            <span className="font-medium text-[var(--ea-text-1)]">
              {warehouse ? `${warehouse.code} · ${warehouse.name}` : "—"}
            </span>
          </span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Кассын данс (MNT)">
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
          </FormField>
          <FormField label="Агуулах">
            <select
              className="ea-form-select"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              <option value="">— Сонгох —</option>
              {warehouses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code} · {entry.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      )}

      <FormField label="Эхний мөнгө — кассанд байгаа бэлэн (₮)">
        <Input
          type="number"
          min="0"
          inputMode="decimal"
          autoFocus={autoFocus}
          value={openingFloat}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            floatTouched.current = true;
            setOpeningFloat(event.target.value);
          }}
          className="h-11 font-mono text-right text-lg"
        />
        {openingHint && (!defaultCashAccountId || cashAccountId === defaultCashAccountId) && (
          <p className="text-[11px] text-[var(--ea-text-3)]">{openingHint}</p>
        )}
      </FormField>

      {showFx ? (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Валютын ханш (дэлгүүрийн)</Label>
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
        </div>
      ) : null}

      {showNote && (
        <FormField label="Тэмдэглэл">
          <Input value={note} onChange={(event) => setNote(event.target.value)} />
        </FormField>
      )}

      <div className="flex flex-wrap gap-x-3 text-[11px]">
        {!showFx && (
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setShowFx(true)}>
            <Icon name="add" size="xs" />
            {fxCurrencies.length > 0
              ? `Валютын ханш (${fxCurrencies.join(", ")} бэлэн авбал)`
              : "Валютын ханш"}
          </Button>
        )}
        {!showNote && (
          <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setShowNote(true)}>
            <Icon name="add" size="xs" />
            Тэмдэглэл
          </Button>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        {onCancel && (
          <Button variant="outline" type="button" onClick={onCancel} disabled={isPending}>
            Болих
          </Button>
        )}
        <Button type="submit" size="lg" className="h-11 flex-1 text-base font-semibold" disabled={isPending}>
          <Icon name="unlocked" size="md" />
          {isPending ? "Нээж байна…" : "Ээлж нээх"}
        </Button>
      </div>
    </form>
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
  defaultCashAccountId?: string | null;
  defaultOpeningFloat?: number | null;
  openingHint?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ээлж нээх</DialogTitle>
          <DialogDescription>
            Кассанд байгаа бэлэн мөнгөө оруулаад нээнэ. Валютын бэлэн авбал ханшийг гараар оруулна.
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
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function submit() {
    if (!shift) return;
    const counted = Number(countedCash);
    if (!(counted >= 0) || countedCash.trim() === "")
      return toast.error("Тоолсон бэлэн мөнгөө оруулна уу");
    // SIM2-036: том зөрүү — дахин тоолох эсвэл менежерийн баталгаажуулалт.
    const system = shift.openingFloat + shift.cashReceipts - shift.cashRefunds;
    const large = isLargeShiftVariance(system, counted);
    if (large) {
      const ok = await confirm({
        title: "Кассын зөрүү их байна",
        description: `Систем ${fmtMnt(system)} · тоолсон ${fmtMnt(counted)} → зөрүү ${fmtMnt(counted - system)} (босго ${fmtMnt(shiftVarianceThreshold(system))}). Мөнгөө дахин тоолно уу. Зөрүүг ${counted < system ? "дутагдал" : "илүүдэл"} болгож бичих бол менежер (батлах эрхтэй) баталгаажуулна.`,
        confirmText: "Менежер баталгаажуулж хаах",
        cancelText: "Дахин тоолох",
        danger: true,
      });
      if (!ok) return;
    }
    startTransition(async () => {
      const response = await closeShift(shift.id, {
        countedCash: counted,
        note: note.trim() || undefined,
        confirmLargeVariance: large,
      });
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
    <>
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
              {shift.paymentsByMethod
                .filter((method) => method.kind !== "cash")
                .map((method) => (
                  // Бэлэн биш хэлбэр — системийн бэлэн мөнгөнд ОРОХГҮЙ, лавлагаа
                  <div key={method.code} className="contents">
                    <span className="text-[var(--ea-text-3)]">{method.name} · бэлэн биш</span>
                    <span className="text-right font-mono text-[var(--ea-text-3)]">{fmtMnt(method.amount)}</span>
                  </div>
                ))}
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
                <FormField label="Тоолсон бэлэн мөнгө (₮)">
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
                </FormField>
                <FormField label="Тэмдэглэл">
                  <Input value={note} onChange={(event) => setNote(event.target.value)} />
                </FormField>
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
    {confirmDialog}
    </>
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
    // Бэлэн биш хэлбэр бүрийн цэвэр дүн — системийн бэлэн мөнгөнд орохгүй.
    ...shift.paymentsByMethod
      .filter((method) => method.kind !== "cash")
      .map((method): [string, number | null] => [`${method.name}`, method.amount]),
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
