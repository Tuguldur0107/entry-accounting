"use client";

// Нэхэмжлэхийг харилцагчийн урьдчилгаагаар хаах (docs/dev/arap.md §5l):
//   АР: Dr урьдчилж орсон орлого / Cr авлага; АП: Dr өглөг / Cr урьдчилж төлсөн.
// Дүн урьдчилгаа ба нэхэмжлэхийн үлдэгдлээс хэтрэхгүй (сервер дахин шалгана).
// Буцаалт нь нэхэмжлэхийн «Суутган тооцоо»-ны буцаалтаар.

import { useEffect, useState, useTransition } from "react";

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
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { applyAdvanceToInvoice, listAdvanceBalances } from "@/lib/actions/arap-advances";
import { ADVANCE_SIDE_LABELS, advanceSideOf } from "@/lib/arap/advance-math";
import { currentDocumentDate } from "@/lib/periods/document-date";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

export function ApplyAdvanceDialog({
  open,
  onOpenChange,
  documentId,
  documentNo,
  documentType,
  counterpartyId,
  counterpartyName,
  invoiceBalance,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentNo: string;
  documentType: string;
  counterpartyId: string;
  counterpartyName: string;
  invoiceBalance: number;
  onApplied: () => void;
}) {
  const side = advanceSideOf(documentType);
  const [isPending, startTransition] = useTransition();
  const [available, setAvailable] = useState<number | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => currentDocumentDate());
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !side) return;
    let cancelled = false;
    void listAdvanceBalances({ counterpartyId }).then((result) => {
      if (cancelled) return;
      if (result.error || !result.balances) {
        setError(result.error ?? "Урьдчилгааны үлдэгдлийг уншиж чадсангүй");
        setAvailable(0);
        return;
      }
      const balance = result.balances.find((row) => row.side === side)?.balance ?? 0;
      setAvailable(balance);
      setAccountNumber(
        side === "customer"
          ? result.settings?.customerAdvanceAccountNumber ?? ""
          : result.settings?.supplierAdvanceAccountNumber ?? ""
      );
      const suggested = Math.max(0, Math.min(balance, invoiceBalance));
      setAmount(suggested > 0 ? String(Math.round(suggested * 100) / 100) : "");
    });
    return () => {
      cancelled = true;
    };
  }, [open, side, counterpartyId, invoiceBalance]);

  function submit() {
    setError("");
    startTransition(async () => {
      const result = await applyAdvanceToInvoice({
        documentId,
        amount: amount ? Number(amount.replaceAll(",", "")) : null,
        date,
      });
      if (result.error) {
        setError(result.error);
        feedback.error();
        return;
      }
      feedback.posted();
      onApplied();
      onOpenChange(false);
    });
  }

  if (!side) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Урьдчилгаанаас хаах</DialogTitle>
          <DialogDescription>
            {documentNo} · {counterpartyName} — {ADVANCE_SIDE_LABELS[side]}
            {accountNumber ? ` (${accountNumber})` : ""}-аас суутгаж нэхэмжлэхийн
            үлдэгдлийг хаана. GL-д суутгалын журнал шууд бичигдэнэ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-xs text-[var(--ea-text-2)]">
          <div>
            <div className="text-[var(--ea-text-3)]">Урьдчилгааны үлдэгдэл</div>
            <div className="font-mono text-sm font-medium">
              {available == null ? "…" : `${fmtMnt(available)} ₮`}
            </div>
          </div>
          <div>
            <div className="text-[var(--ea-text-3)]">Нэхэмжлэхийн үлдэгдэл</div>
            <div className="font-mono text-sm font-medium">{fmtMnt(invoiceBalance)} ₮</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Суутгах дүн" htmlFor="advance-amount">
            <Input
              id="advance-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormField>
          <FormField label="Огноо" htmlFor="advance-date">
            <Input
              id="advance-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
        </div>
        {error && (
          <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger-fg)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={submit} disabled={isPending || !available || available <= 0}>
            <Icon name="success" size="sm" />
            Суутгах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
