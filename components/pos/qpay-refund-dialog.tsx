"use client";

// QPay-д орсон мөнгийг харилцагчид буцаах цонх (давхар төлбөр / дүн зөрсөн) —
// `refundQpayIntent` (lib/qpay/refund.ts). Журнал бүгд автоматаар: Dt QPay түр
// данс / Кт касс | банк | дэлгүүрийн кредитийн өглөг. Менежерийн (pos:post) эрх.

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
import { FormField } from "@/components/ui/form-field";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { getQpayRefundOptions, refundQpayIntent } from "@/lib/actions/qpay";
import { QPAY_REFUND_METHOD_LABELS, QPAY_REFUND_METHODS, type QpayRefundMethod } from "@/lib/qpay/constants";
import type { QpayIntentView } from "@/lib/qpay/types";
import { fmtMnt } from "@/lib/reports/balances";
import { feedback } from "@/lib/ui/feedback";

const METHOD_HINTS: Record<QpayRefundMethod, string> = {
  cash: "Тэр салбарын нээлттэй ээлжийн кассаас бэлнээр өгнө — ээлжийн бэлэн мөнгөнд тооцогдоно. Журнал: Dt QPay түр данс / Кт касс.",
  bank: "Харилцагчийн данс руу шилжүүлсэн бол тэр данс. Журнал: Dt QPay түр данс / Кт сонгосон данс.",
  store_credit: "Мөнгийг буцаахгүй, харилцагчид дараагийн худалдан авалтад ашиглах кредит үлдээнэ. Журнал: Dt QPay түр данс / Кт дэлгүүрийн кредитийн өглөг.",
};

const textareaClass =
  "min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function QpayRefundDialog({
  intent,
  onOpenChange,
  onDone,
}: {
  intent: QpayIntentView | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<QpayRefundMethod>("cash");
  const [accountId, setAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState<{
    accounts: SearchableOption[];
    customers: SearchableOption[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = intent !== null;
  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    void getQpayRefundOptions().then((result) => {
      if (cancelled) return;
      if (result.error) {
        setLoadError(result.error);
        return;
      }
      setOptions({
        accounts: (result.accounts ?? []).map((a) => ({
          value: a.id,
          label: a.name,
          hint: a.accountType === "bank" ? "Банк" : "Касс",
        })),
        customers: (result.customers ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, options]);

  const canSubmit = useMemo(() => {
    if (reason.trim().length < 3) return false;
    if (method === "bank") return !!accountId;
    if (method === "store_credit") return !!customerId;
    return true;
  }, [reason, method, accountId, customerId]);

  function close(next: boolean) {
    if (!next) {
      setMethod("cash");
      setAccountId("");
      setCustomerId("");
      setReason("");
    }
    onOpenChange(next);
  }

  function submit() {
    if (!intent || !canSubmit) return;
    startTransition(async () => {
      const result = await refundQpayIntent(intent.id, {
        method,
        reason,
        cashAccountId: method === "bank" ? accountId : null,
        counterpartyId: method === "store_credit" ? customerId : null,
      });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.posted(`QPay ${fmtMnt(result.amount ?? 0)}₮ буцаагдлаа — ${result.voucherNo}`);
      close(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>QPay төлбөр буцаах — {fmtMnt(intent?.refundableAmount ?? 0)}₮</DialogTitle>
          <DialogDescription>
            Сагс өөр хэлбэрээр аль хэдийн зарагдсан (давхар төлбөр) эсвэл дүн зөрсөн үед. Борлуулалт бүртгэгдэхгүй;
            журнал автоматаар бичигдэнэ.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label="Хэрхэн буцаах" hint={METHOD_HINTS[method]}>
            <select
              className="ea-form-select"
              value={method}
              onChange={(event) => setMethod(event.target.value as QpayRefundMethod)}
            >
              {QPAY_REFUND_METHODS.map((entry) => (
                <option key={entry} value={entry}>
                  {QPAY_REFUND_METHOD_LABELS[entry]}
                </option>
              ))}
            </select>
          </FormField>

          {method === "bank" && (
            <FormField label="Буцаан шилжүүлсэн данс">
              <SearchableSelect
                value={accountId}
                onChange={setAccountId}
                options={options?.accounts ?? []}
                placeholder={options ? "— Данс сонгох —" : "Ачаалж байна…"}
                emptyLabel="Идэвхтэй ₮ данс алга"
              />
            </FormField>
          )}

          {method === "store_credit" && (
            <FormField label="Кредит үлдээх харилцагч">
              <SearchableSelect
                value={customerId}
                onChange={setCustomerId}
                options={options?.customers ?? []}
                placeholder={options ? "— Харилцагч сонгох —" : "Ачаалж байна…"}
                emptyLabel="Харилцагч олдсонгүй — Авлага → Харилцагч-д бүртгэнэ"
              />
            </FormField>
          )}

          <FormField label="Шалтгаан" hint="Аудитын мөрөнд хадгалагдана.">
            <textarea
              className={textareaClass}
              value={reason}
              placeholder="Жишээ нь: Бэлнээр POS-2609-0007 болгож зарсан — давхар төлбөр"
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>

          {loadError && <p className="text-xs text-[var(--ea-danger-fg)]">{loadError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            Болих
          </Button>
          <Button onClick={submit} disabled={!canSubmit || pending}>
            {pending ? "Буцааж байна…" : "Буцаах"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
