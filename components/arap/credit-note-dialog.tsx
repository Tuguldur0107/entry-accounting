"use client";

// Кредит нэхэмжлэл / дебит нэхэмжлэх үүсгэх диалог (ENT-029). Эх нэхэмжлэхийн
// мөр бүрийн буцаах тоо/дүнг оруулна; НӨАТ ба нийт дүнг сервертэй НЭГ цэвэр
// төлөвлөгчөөр (planCreditNote) урьдчилан харуулна — сервер эрх мэдэлтэй.
// Хэв маяг нь POS-ийн буцаалтын диалогтой ижил (мөр бүр оролттой маягт).

import { useEffect, useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  createCreditNote,
  getCreditNoteSource,
  type CreditNoteSourceView,
} from "@/lib/actions/arap-credit-note";
import { planCreditNote, type CreditRequestLine } from "@/lib/arap/credit-note";
import { currentDocumentDate } from "@/lib/periods/document-date";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

function fmtQty(value: number | null) {
  return value == null ? "" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

export function CreditNoteDialog({
  sourceDocumentId,
  open,
  onOpenChange,
  onCreated,
}: {
  sourceDocumentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: { id: string; documentNo: string }) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [source, setSource] = useState<CreditNoteSourceView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [priceOnly, setPriceOnly] = useState(false);
  const [date, setDate] = useState(currentDocumentDate);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getCreditNoteSource(sourceDocumentId).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setLoadError(result.error);
        return;
      }
      const view = result.source!;
      setSource(view);
      // Анхдагч = бүтэн буцаалт (мөр бүрийн үлдэгдэл) — хэрэглэгч бууруулна.
      setInputs(
        Object.fromEntries(
          view.lines
            .filter((line) => !line.isVat && line.remainingAmount > 0.005)
            .map((line) => [
              line.id,
              String(line.itemId && line.remainingQuantity != null ? line.remainingQuantity : line.remainingAmount),
            ])
        )
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, sourceDocumentId]);

  const netLines = useMemo(() => (source?.lines ?? []).filter((line) => !line.isVat), [source]);
  const isItemQty = (line: CreditNoteSourceView["lines"][number]) =>
    !priceOnly && !!line.itemId && line.quantity != null && line.quantity > 0;

  const request: CreditRequestLine[] = useMemo(
    () =>
      netLines.flatMap((line): CreditRequestLine[] => {
        const value = Number(inputs[line.id] ?? 0);
        if (!(value > 0)) return [];
        if (isItemQty(line)) return [{ sourceLineId: line.id, quantity: value }];
        if (line.itemId) return [{ sourceLineId: line.id, quantity: 0, amount: value }];
        return [{ sourceLineId: line.id, amount: value }];
      }),
    // isItemQty нь priceOnly-оос хамаарна
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [netLines, inputs, priceOnly]
  );

  const preview = useMemo(() => {
    if (!source || request.length === 0) return null;
    const vatAccounts = new Set(source.lines.filter((line) => line.isVat).map((line) => line.accountNumber));
    try {
      return {
        plan: planCreditNote({
          sourceType: source.documentType,
          sourceStatus: "posted",
          sourceLines: source.lines.map((line) => ({
            id: line.id,
            accountNumber: line.accountNumber,
            description: line.description,
            amount: line.amount,
            quantity: line.quantity,
            itemId: line.itemId,
            warehouseId: null,
            unitPrice: line.unitPrice,
          })),
          credited: new Map(
            source.lines.map((line) => [
              line.id,
              {
                amount: Math.round((line.amount - line.remainingAmount) * 100) / 100,
                quantity: line.quantity != null ? (line.quantity - (line.remainingQuantity ?? 0)) : 0,
              },
            ])
          ),
          request,
          isVatLine: (account) => vatAccounts.has(account),
        }),
        error: "",
      };
    } catch (caught) {
      return { plan: null, error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [source, request]);

  const vatAmount = preview?.plan?.lines.filter((line) => line.isVat).reduce((sum, line) => sum + line.amount, 0) ?? 0;
  const applied = preview?.plan ? Math.min(preview.plan.total, Math.max(0, source?.openAmount ?? 0)) : 0;
  const unit = source?.currency === "MNT" ? "₮" : ` ${source?.currency ?? ""}`;

  function submit(postNow: boolean) {
    if (!source || !preview?.plan) return;
    if (!reason.trim()) {
      feedback.error("Буцаалтын шалтгаан заавал");
      return;
    }
    startTransition(async () => {
      const result = await createCreditNote({
        sourceDocumentId: source.id,
        date,
        reason: reason.trim(),
        lines: request,
        postNow,
      });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      if (result.postError) feedback.error(`Ноорог хадгалагдсан, батлахад: ${result.postError}`);
      else if (postNow) feedback.posted(`${result.documentNo} батлагдаж эх нэхэмжлэхэд тооцогдлоо`);
      else feedback.saved(`${result.documentNo} ноорог хадгалагдлаа`);
      onOpenChange(false);
      onCreated({ id: result.id!, documentNo: result.documentNo! });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {source?.creditTypeLabel ?? "Кредит баримт"} — {source?.documentNo ?? "…"}
          </DialogTitle>
          <DialogDescription>
            Буцаах тоо/дүн эх мөрийн үлдэгдлээс хэтрэхгүй. НӨАТ автоматаар хувиар бодогдоно.
            Батлахад эх нэхэмжлэхийн үлдэгдэлд тооцогдож, илүүдэл нь харилцагчийн кредит болно.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="text-sm text-[var(--ea-danger-fg)]">{loadError}</p>
        ) : !source ? (
          <p className="text-sm text-[var(--ea-text-3)]">Ачаалж байна…</p>
        ) : source.blocker ? (
          <p className="text-sm text-[var(--ea-danger-fg)]">{source.blocker}</p>
        ) : (
          <div className="space-y-3">
            <SwitchField
              label="Бараа буцаахгүй — зөвхөн үнийн хөнгөлөлт"
              hint="Асаавал бараатай мөрөнд тоо биш ДҮН оруулна; агуулахын хөдөлгөөн үүсэхгүй."
              checked={priceOnly}
              onChange={(value) => {
                setPriceOnly(value);
                setInputs({});
              }}
            />
            <div className="space-y-1">
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] gap-2 px-1 text-[11px] text-[var(--ea-text-3)]">
                <span>Мөр</span>
                <span className="text-right">Үлдэгдэл</span>
                <span className="text-right">Буцаах</span>
              </div>
              {netLines.map((line) => {
                const byQty = isItemQty(line);
                const max = byQty ? (line.remainingQuantity ?? 0) : line.remainingAmount;
                return (
                  <div
                    key={line.id}
                    className="grid grid-cols-[minmax(0,1fr)_110px_110px] items-center gap-2 rounded-md border border-[var(--ea-border)] px-2 py-1 text-sm"
                  >
                    <span className="truncate" title={line.description}>
                      <span className="font-mono text-xs text-[var(--ea-text-3)]">#{line.lineNo}</span> {line.description}
                    </span>
                    <span className="text-right font-mono text-xs">
                      {byQty ? `${fmtQty(line.remainingQuantity)} ш` : `${fmtMnt(line.remainingAmount)}${unit}`}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      max={max}
                      step="any"
                      disabled={max <= 0}
                      aria-label={`${line.description} — буцаах ${byQty ? "тоо" : "дүн"}`}
                      value={inputs[line.id] ?? ""}
                      className="font-mono text-right"
                      onChange={(event) =>
                        setInputs((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div className="rounded-md border border-[var(--ea-border)] px-3 py-2 text-sm">
              {preview?.error ? (
                <span className="text-[var(--ea-danger-fg)]">{preview.error}</span>
              ) : preview?.plan ? (
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <span>
                    НӨАТ <span className="font-mono">{fmtMnt(vatAmount)}{unit}</span>
                  </span>
                  <span className="font-semibold">
                    Нийт <span className="font-mono">{fmtMnt(preview.plan.total)}{unit}</span>
                  </span>
                  <span className="text-[var(--ea-text-3)]">
                    Эх нэхэмжлэхэд тооцох <span className="font-mono">{fmtMnt(applied)}{unit}</span>
                    {preview.plan.total - applied > 0.005 && (
                      <> · харилцагчийн кредит <span className="font-mono">{fmtMnt(preview.plan.total - applied)}{unit}</span></>
                    )}
                  </span>
                </div>
              ) : (
                <span className="text-[var(--ea-text-3)]">Буцаах тоо/дүн оруулна уу</span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
              <FormField label="Огноо" hint={`Эх нэхэмжлэх ${source.date}-аас хойш`}>
                <Input type="date" value={date} min={source.date} onChange={(event) => setDate(event.target.value)} />
              </FormField>
              <FormField label="Шалтгаан">
                <Input
                  value={reason}
                  placeholder="Гэмтэлтэй бараа, үнийн тохиролцоо…"
                  onChange={(event) => setReason(event.target.value)}
                />
              </FormField>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Болих
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            disabled={isPending || !preview?.plan || !!source?.blocker}
          >
            Ноорог хадгалах
          </Button>
          <Button onClick={() => submit(true)} disabled={isPending || !preview?.plan || !!source?.blocker}>
            Батлах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
