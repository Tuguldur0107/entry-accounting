"use client";

// Давтамжтай нэхэмжлэх (docs/dev/arap.md §5h): нэхэмжлэхийн панелиас «Давтамжтай
// болгох» (хуваарь сонгоно — мөр, данс, НӨАТ эх нэхэмжлэхээс) ба жагсаалтаас засах
// (батлах/илгээх, төлөх хугацаа, дуусах огноо, зогсоох/сэргээх, одоо үүсгэх, устгах).

import { useEffect, useState, useTransition } from "react";

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
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  createRecurringInvoice,
  deleteRecurringInvoice,
  getRecurringSourcePreview,
  runRecurringInvoiceNow,
  setRecurringInvoiceStatus,
  updateRecurringInvoice,
  type RecurringRow,
} from "@/lib/actions/ar-recurring";
import {
  RECURRING_INTERVALS,
  RECURRING_INTERVAL_LABELS,
  firstOccurrence,
  normalizeRecurringSchedule,
} from "@/lib/arap/recurring";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

const DAY_OPTIONS = [...Array.from({ length: 28 }, (_, index) => index + 1), 0];

function EmailPostSwitches({
  autoPost,
  sendEmail,
  onAutoPost,
  onSendEmail,
  disabled,
}: {
  autoPost: boolean;
  sendEmail: boolean;
  onAutoPost: (value: boolean) => void;
  onSendEmail: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <SwitchField
        label="Автоматаар батлах"
        hint="Унтраалттай бол НООРОГ үүснэ — нягтлан шалгаад батална (мэдэгдэл очно)."
        checked={autoPost}
        onChange={(value) => {
          onAutoPost(value);
          if (!value) onSendEmail(false);
        }}
        disabled={disabled}
      />
      <SwitchField
        label="Харилцагч руу и-мэйлээр илгээх"
        hint="Батлагдсан нэхэмжлэхийг PDF + онлайн линк (QPay-ээр төлөх) хамт харилцагчийн бүртгэлтэй и-мэйл рүү."
        checked={sendEmail}
        onChange={onSendEmail}
        disabled={disabled || !autoPost}
      />
    </div>
  );
}

export function CreateRecurringDialog({
  documentId,
  documentNo,
  open,
  onOpenChange,
  onCreated,
}: {
  documentId: string;
  documentNo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <CreateBody
            documentId={documentId}
            documentNo={documentNo}
            onClose={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateBody({
  documentId,
  documentNo,
  onClose,
  onCreated,
}: {
  documentId: string;
  documentNo: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [intervalMonths, setIntervalMonths] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [terms, setTerms] = useState("0");
  const [autoPost, setAutoPost] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getRecurringSourcePreview(documentId).then((result) => {
      if (cancelled) return;
      if (result.error !== undefined) {
        setLoadError(result.error);
        return;
      }
      setTotal(result.totalAmount);
      setDayOfMonth(result.dayOfMonth);
      setStartDate(result.startDate);
      setTerms(String(result.termsDays));
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const schedule = {
    intervalMonths,
    dayOfMonth,
    paymentTermsDays: Number(terms),
    startDate,
    endDate: endDate || null,
    autoPost,
    sendEmail,
  };
  const validation = startDate ? normalizeRecurringSchedule(schedule) : null;
  const problem = validation && "error" in validation ? validation.error : null;
  const first = startDate && !problem ? firstOccurrence(startDate, dayOfMonth, intervalMonths) : null;

  function save() {
    if (problem || !startDate) return;
    startTransition(async () => {
      const result = await createRecurringInvoice(documentId, schedule);
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved(`Давтамжтай нэхэмжлэх хадгалагдлаа — эхнийх ${result.nextRunDate}`);
      onClose();
      onCreated?.();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Давтамжтай болгох</DialogTitle>
        <DialogDescription>
          № {documentNo}-ийн мөр, данс, дүнгээр{total != null ? ` (${fmtMnt(total)}₮)` : ""} хуваарийн дагуу шинэ
          нэхэмжлэх үүснэ. Түрээс, захиалга, үйлчилгээний гэрээнд.
        </DialogDescription>
      </DialogHeader>
      {loadError ? (
        <p className="text-sm text-[var(--ea-danger-fg)]">{loadError}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Давтамж">
              <select
                className="ea-form-select"
                value={intervalMonths}
                onChange={(event) => setIntervalMonths(Number(event.target.value))}
              >
                {RECURRING_INTERVALS.map((value) => (
                  <option key={value} value={value}>
                    {RECURRING_INTERVAL_LABELS[value]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Сарын өдөр">
              <select
                className="ea-form-select"
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(Number(event.target.value))}
              >
                {DAY_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? "Сарын сүүлийн өдөр" : `${value}`}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Эхлэх огноо" hint={first ? `Эхний нэхэмжлэх: ${first}` : undefined}>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </FormField>
            <FormField label="Дуусах огноо" hint="Хоосон бол хугацаагүй">
              <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </FormField>
            <FormField label="Төлөх хугацаа (хоног)" hint="Нэхэмжлэхийн огнооноос">
              <Input inputMode="numeric" value={terms} onChange={(event) => setTerms(event.target.value)} />
            </FormField>
          </div>
          <EmailPostSwitches
            autoPost={autoPost}
            sendEmail={sendEmail}
            onAutoPost={setAutoPost}
            onSendEmail={setSendEmail}
            disabled={isPending}
          />
          {problem && <p className="text-xs text-[var(--ea-danger-fg)]">{problem}</p>}
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          Болих
        </Button>
        <Button onClick={save} disabled={isPending || !!loadError || !!problem || !startDate}>
          Хадгалах
        </Button>
      </DialogFooter>
    </>
  );
}

export function EditRecurringDialog({
  row,
  onOpenChange,
  onChanged,
}: {
  row: RecurringRow | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {row && <EditBody key={row.id} row={row} onClose={() => onOpenChange(false)} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

function EditBody({ row, onClose, onChanged }: { row: RecurringRow; onClose: () => void; onChanged: () => void }) {
  const [autoPost, setAutoPost] = useState(row.autoPost);
  const [sendEmail, setSendEmail] = useState(row.sendEmail);
  const [terms, setTerms] = useState(String(row.paymentTermsDays));
  const [endDate, setEndDate] = useState(row.endDate ?? "");
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirm();

  const validation = normalizeRecurringSchedule({
    intervalMonths: row.intervalMonths,
    dayOfMonth: row.dayOfMonth,
    startDate: row.startDate,
    paymentTermsDays: Number(terms),
    endDate: endDate || null,
    autoPost,
    sendEmail,
  });
  const problem = "error" in validation ? validation.error : null;

  const run = (task: () => Promise<{ error?: string }>, done: string, close = true) =>
    startTransition(async () => {
      const result = await task();
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved(done);
      onChanged();
      if (close) onClose();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row.counterpartyName} — давтамжтай нэхэмжлэх</DialogTitle>
        <DialogDescription>
          {row.description} · {fmtMnt(row.totalAmount)}₮ · {row.scheduleLabel}. Дараагийнх {row.nextRunDate}. Давтамж,
          өдрийг өөрчлөх бол шинээр үүсгэнэ (тэр сарын нэхэмжлэх давхардахаас сэргийлж).
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {row.lastError && (
          <p className="rounded-md border border-[var(--ea-warning)] bg-[var(--ea-warning-bg)] px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
            Сүүлийн алдаа: {row.lastError}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Төлөх хугацаа (хоног)">
            <Input inputMode="numeric" value={terms} onChange={(event) => setTerms(event.target.value)} />
          </FormField>
          <FormField label="Дуусах огноо" hint="Хоосон бол хугацаагүй">
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </FormField>
        </div>
        <EmailPostSwitches
          autoPost={autoPost}
          sendEmail={sendEmail}
          onAutoPost={setAutoPost}
          onSendEmail={setSendEmail}
          disabled={isPending}
        />
        {sendEmail && !row.counterpartyHasEmail && (
          <p className="text-xs text-[var(--ea-warning-fg)]">Харилцагчид и-мэйл бүртгэлгүй — Харилцагчид хэсэгт нэмнэ үү.</p>
        )}
        {problem && <p className="text-xs text-[var(--ea-danger-fg)]">{problem}</p>}
      </div>
      <DialogFooter className="flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={isPending}
          onClick={async () => {
            const ok = await confirm({
              title: "Давтамжтай нэхэмжлэхийг устгах уу?",
              description: "Цаашид нэхэмжлэх үүсэхгүй. Аль хэдийн үүссэн нэхэмжлэхүүд хэвээр үлдэнэ.",
              confirmText: "Устгах",
              danger: true,
            });
            if (ok) run(() => deleteRecurringInvoice(row.id), "Устгагдлаа");
          }}
        >
          Устгах
        </Button>
        {row.status !== "ended" && (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() =>
              run(
                () => setRecurringInvoiceStatus(row.id, row.status !== "paused"),
                row.status === "paused" ? "Сэргээлээ — зогссон хугацааных нөхөгдөхгүй" : "Түр зогсоолоо"
              )
            }
          >
            {row.status === "paused" ? "Сэргээх" : "Түр зогсоох"}
          </Button>
        )}
        {row.status !== "ended" && (
          <Button
            variant="outline"
            disabled={isPending}
            title="Дараагийн нэхэмжлэхийг өнөөдрийн огноогоор одоо үүсгэнэ — хуваарийн өдөр давхар үүсэхгүй"
            onClick={() =>
              startTransition(async () => {
                const result = await runRecurringInvoiceNow(row.id);
                if (result.error) {
                  feedback.error(result.error);
                  return;
                }
                feedback.saved(
                  result.documentNo
                    ? `Нэхэмжлэх ${result.documentNo} үүслээ${result.emailed ? ", и-мэйлээр илгээв" : ""}${result.note ? ` (${result.note})` : ""}`
                    : `Энэ үеийн нэхэмжлэх аль хэдийн үүссэн`
                );
                onChanged();
                onClose();
              })
            }
          >
            Дараагийнхыг одоо үүсгэх
          </Button>
        )}
        <Button
          disabled={isPending || !!problem}
          onClick={() =>
            run(
              () =>
                updateRecurringInvoice(row.id, {
                  autoPost,
                  sendEmail,
                  paymentTermsDays: Number(terms),
                  endDate: endDate || null,
                }),
              "Хадгалагдлаа"
            )
          }
        >
          Хадгалах
        </Button>
      </DialogFooter>
      {dialog}
    </>
  );
}
