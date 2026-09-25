"use client";

// Захиалгын ДУТУУ хаалт (ENT-064): бараа бүрэн ирэхгүй болсон PO-г хаана.
// Хүлээн аваагүй үлдэгдэл цуцлагдаж, хүлээн авснаас илүү нэхэмжилсэн дүн
// хэрэглэгчийн ИЛ сонгосон зардлын дансанд бичигдэнэ (D-SC-1 — урьдчилан
// сонгосон данс байхгүй). Шалтгаан заавал, аудитад хадгалагдана (D-SC-3).
// Сервер (closePurchaseOrder) цоожтойгоор бүх нөхцөлийг ДАХИН шалгана.

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { closePurchaseOrder } from "@/lib/actions/procurement";
import { PO_SHORT_CLOSE_REASON_MIN } from "@/lib/procurement/po-math";
import type { PurchaseOrderDetail } from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

function fmtQty(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

export function PoShortCloseDialog({
  detail,
  closeDate,
  writeOffAccounts,
  open,
  onOpenChange,
  onClosed,
}: {
  detail: PurchaseOrderDetail;
  closeDate: string;
  writeOffAccounts: { number: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [account, setAccount] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const plan = detail.shortClose;
  const writeOffMnt = plan?.writeOffMnt ?? 0;
  const cancelledLines = useMemo(
    () =>
      detail.lines
        .map((line) => ({
          id: line.id,
          label: `${line.itemCode} · ${line.itemName}`,
          cancelled: Math.max(0, line.quantity - line.receivedQuantity),
          unit: line.unit,
        }))
        .filter((line) => line.cancelled > 0.00005),
    [detail.lines]
  );
  const accountOptions = useMemo(
    () => writeOffAccounts.map((row) => ({ value: row.number, label: row.name })),
    [writeOffAccounts]
  );

  const reasonOk = reason.trim().length >= PO_SHORT_CLOSE_REASON_MIN;
  const accountOk = writeOffMnt <= 0 || account !== "";
  const blocked = !plan || plan.blockers.length > 0;

  function submit() {
    setError("");
    startTransition(async () => {
      try {
        const result = await closePurchaseOrder({
          id: detail.id,
          closeDate,
          shortClose: { reason: reason.trim(), writeOffAccount: account || null },
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        feedback.posted(`${detail.documentNo} дутуу хаагдаж, түр дансууд тэгшитгэгдлээ`);
        onOpenChange(false);
        onClosed();
      } catch {
        setError("Захиалга хаагдсангүй");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Дутуу хаах — {detail.documentNo}</DialogTitle>
          <DialogDescription>
            Бараа бүрэн ирэхгүй болсон үед. Хүлээн аваагүй үлдэгдэл цуцлагдана; дахин нээхэд
            сэргэнэ. Хаах огноо {closeDate}.
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <ul className="space-y-1">
            {(plan?.blockers ?? ["Дутуу хаах нөхцөл тодорхойгүй — панелийг сэргээнэ үү"]).map(
              (blocker) => (
                <li key={blocker} className="text-sm text-[var(--ea-danger-fg)]">
                  {blocker}
                </li>
              )
            )}
          </ul>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1 rounded-md border border-[var(--ea-border)] px-3 py-2 text-sm">
              <div className="text-xs font-semibold text-[var(--ea-text-2)]">Цуцлагдах үлдэгдэл</div>
              {cancelledLines.length === 0 ? (
                <p className="text-xs text-[var(--ea-text-3)]">Бүх бараа хүлээн авагдсан — цуцлах үлдэгдэл алга.</p>
              ) : (
                cancelledLines.map((line) => (
                  <div key={line.id} className="flex justify-between gap-3 text-xs">
                    <span className="truncate">{line.label}</span>
                    <span className="shrink-0 font-mono">
                      {fmtQty(line.cancelled)} {line.unit}
                    </span>
                  </div>
                ))
              )}
            </div>

            {writeOffMnt > 0 && (
              <FormField
                label={`Илүү нэхэмжлэл ${fmtMnt(writeOffMnt)}₮ — зардлын данс`}
                hint="Хүлээн авснаас илүү нэхэмжилсэн дүн энэ дансанд Дт бичигдэнэ (6/7/8-аар эхэлсэн данс)."
              >
                <SearchableSelect
                  value={account}
                  onChange={setAccount}
                  options={accountOptions}
                  placeholder="Зардлын данс сонгох…"
                  emptyLabel="Идэвхтэй зардлын данс алга — дансны тохиргооноос нэмнэ үү"
                />
              </FormField>
            )}

            <FormField
              label="Шалтгаан"
              htmlFor="po-short-close-reason"
              hint={`Заавал (${PO_SHORT_CLOSE_REASON_MIN}+ тэмдэгт) — аудитын мөрд хадгалагдана.`}
            >
              <textarea
                id="po-short-close-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Жишээ: Нийлүүлэгч үлдсэн барааг нийлүүлэх боломжгүй болсон"
                className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </FormField>
          </div>
        )}

        {error && <p className="text-sm text-[var(--ea-danger-fg)]">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending || blocked || !reasonOk || !accountOk}>
            Дутуу хаах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
