"use client";

// Найдваргүй авлага хасах / сэргээх (ENT-065, IFRS 9) — АР нэхэмжлэлийн
// панелийн НЭГ мөр. Хасалтгүй бол хоосон блок гаргахгүй (панелийн дүрэм).
// Сервер (writeOffArApDocument / recoverArApWriteOff / reverseArApWriteOff)
// бүх нөхцөлийг ДАХИН шалгана.

import { useCallback, useEffect, useState, useTransition } from "react";

import { useModuleCan } from "@/components/layout/module-access-context";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import {
  listArapWriteOffs,
  recoverArApWriteOff,
  reverseArApWriteOff,
  writeOffArApDocument,
} from "@/lib/actions/arap-ecl";
import { WRITE_OFF_REASON_MIN, type ArapWriteOffView } from "@/lib/arap/ecl";
import { currentDocumentDate } from "@/lib/periods/document-date";
import { fmtMnt } from "@/lib/reports/balances";
import { openVoucherPanel } from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

type Mode = { kind: "write_off" } | { kind: "recover"; writeOff: ArapWriteOffView } | null;

export function WriteOffSection({
  document,
  refreshToken,
  onChanged,
}: {
  document: {
    id: string;
    documentNo: string;
    documentType: string;
    status: string;
    date: string;
    currency: string;
    balance: number;
  };
  refreshToken?: number;
  onChanged: () => void;
}) {
  const canPost = useModuleCan("ar", "post");
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [rows, setRows] = useState<ArapWriteOffView[]>([]);
  const [mode, setMode] = useState<Mode>(null);
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    void listArapWriteOffs(document.id).then((result) => {
      if (!result.error) setRows(result.writeOffs ?? []);
    });
  }, [document.id]);
  useEffect(load, [load, refreshToken]);

  const open = ["posted", "partially_paid"].includes(document.status) && document.balance > 0.005;
  const canWriteOff = document.documentType === "ar_invoice" && open;
  if (document.documentType !== "ar_invoice" || (!canWriteOff && rows.length === 0)) return null;

  function start(next: Exclude<Mode, null>) {
    setMode(next);
    setDate(currentDocumentDate());
    setAmount(
      next.kind === "write_off"
        ? String(document.balance)
        : String(Math.round((next.writeOff.amount - next.writeOff.recoveredAmount) * 100) / 100)
    );
    setReason("");
    setError("");
  }

  function submit() {
    if (!mode) return;
    setError("");
    const value = Number(amount);
    startTransition(async () => {
      const result =
        mode.kind === "write_off"
          ? await writeOffArApDocument({ documentId: document.id, date, amount: value, reason })
          : await recoverArApWriteOff({ writeOffId: mode.writeOff.id, date, amount: value });
      if (result.error) {
        setError(result.error);
        return;
      }
      feedback.posted(
        mode.kind === "write_off"
          ? `${document.documentNo} найдваргүй болгож хасагдлаа`
          : `${document.documentNo} сэргэлт бүртгэгдлээ — орлогыг кассаар хаана уу`
      );
      setMode(null);
      load();
      onChanged();
    });
  }

  function reverse(row: ArapWriteOffView) {
    void confirm({
      title: "Хасалтыг буцаах",
      description: `${row.date}-ны ${fmtMnt(row.baseAmount)}₮ хасалтын журналыг урвуу мөрөөр буцааж, нэхэмжлэлийн үлдэгдлийг сэргээх үү?`,
      confirmText: "Буцаах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const result = await reverseArApWriteOff(row.id);
        if (result.error) {
          feedback.error(result.error);
          return;
        }
        feedback.saved("Хасалт буцаагдлаа");
        load();
        onChanged();
      });
    });
  }

  const reasonOk = mode?.kind !== "write_off" || reason.trim().length >= WRITE_OFF_REASON_MIN;
  const amountOk = Number(amount) > 0;

  return (
    <div className="space-y-1.5 border-t border-[var(--ea-border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--ea-text-1)]">Найдваргүй авлага</span>
        {canWriteOff && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canPost || isPending}
            title={canPost ? "IFRS 9: ECL нөөцөөс (хүрэлцэхгүй бол зардалд) хасна" : "Авлагын батлах эрх шаардана"}
            onClick={() => start({ kind: "write_off" })}
          >
            <Icon name="warning" size="sm" />
            Найдваргүй болгож хасах
          </Button>
        )}
      </div>
      {rows.map((row) => (
        <div key={row.id} className="flex flex-wrap items-center gap-2 text-xs text-[var(--ea-text-2)]">
          <span className={row.status === "active" ? "" : "line-through text-[var(--ea-text-3)]"}>
            {row.date} · {fmtMnt(row.baseAmount)}₮ хассан (нөөцөөс {fmtMnt(row.allowanceAmount)}, зардалд{" "}
            {fmtMnt(row.expenseAmount)})
            {row.recoveredAmount > 0 && ` · сэргэсэн ${fmtMnt(row.recoveredAmount)}`} · {row.reason}
            {row.status !== "active" && " · буцаагдсан"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => openVoucherPanel(row.voucherId)}>
            Журнал
          </Button>
          {row.status === "active" && canPost && row.amount - row.recoveredAmount > 0.005 && (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => start({ kind: "recover", writeOff: row })}>
              Сэргэлт
            </Button>
          )}
          {row.status === "active" && canPost && row.recoveredAmount <= 0.005 && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => reverse(row)}>
              Хасалтыг буцаах
            </Button>
          )}
        </div>
      ))}

      <Dialog open={mode !== null} onOpenChange={(value) => !value && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode?.kind === "recover" ? "Хассан авлагын сэргэлт" : "Найдваргүй болгож хасах"} — {document.documentNo}
            </DialogTitle>
            <DialogDescription>
              {mode?.kind === "recover"
                ? "Dr авлага / Cr ECL зардал — нэхэмжлэлийн үлдэгдэл дахин нээгдэнэ; орж ирсэн мөнгийг кассын орлогоор энэ нэхэмжлэлд холбоно."
                : "Dr ECL нөөц (хүрэлцэхгүй хэсэг Dr ECL зардал) / Cr авлага. Нэхэмжлэл насжилтаас гарна; мөнгө орвол «Сэргэлт»."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Огноо" hint={`Нэхэмжлэл ${document.date}-аас хойш`}>
              <Input type="date" value={date} min={document.date} onChange={(event) => setDate(event.target.value)} />
            </FormField>
            <FormField label={`Дүн (${document.currency})`}>
              <Input
                type="number"
                min="0"
                step="any"
                value={amount}
                className="font-mono text-right"
                onChange={(event) => setAmount(event.target.value)}
              />
            </FormField>
          </div>
          {mode?.kind === "write_off" && (
            <FormField
              label="Шалтгаан"
              htmlFor="write-off-reason"
              hint={`Заавал (${WRITE_OFF_REASON_MIN}+ тэмдэгт) — аудитад хадгалагдана. Татварын хасагдах эсэхийг ААНОАТ-ын нөхцөлөөр шалгана.`}
            >
              <textarea
                id="write-off-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Жишээ: Харилцагч татан буугдсан, шүүхийн шийдвэр №…"
                className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </FormField>
          )}
          {error && <p className="text-sm text-[var(--ea-danger-fg)]">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} disabled={isPending}>
              Болих
            </Button>
            <Button onClick={submit} disabled={isPending || !reasonOk || !amountOk || !date}>
              {mode?.kind === "recover" ? "Сэргээх" : "Хасах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </div>
  );
}
