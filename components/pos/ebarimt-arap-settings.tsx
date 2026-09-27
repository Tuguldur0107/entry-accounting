"use client";

// POS тохиргоо → eBarimt → «АР нэхэмжлэх» (docs/pos/05-ebarimt-invoice-plan.md Шат 2).
// Батлагдсан борлуулалтын нэхэмжлэхийг eBarimt НЭХЭМЖЛЭХ (B2B/B2C_INVOICE)
// болгож илгээнэ. PosAPI-ийн нэхэмжлэхийн урсгал албан баталгаажаагүй (Q1–Q2)
// тул анхнаасаа УНТРААЛТТАЙ — staging туршилтын дараа байгууллага өөрөө асаана.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { updatePosSettings } from "@/lib/actions/pos";
import type { PosSettingsView } from "@/lib/pos/types";
import { feedback } from "@/lib/ui/feedback";

/** «51100000 = 8311100» мөрүүд ↔ бичлэг. */
function codesToText(codes: Record<string, string>): string {
  return Object.entries(codes)
    .map(([account, code]) => `${account} = ${code}`)
    .join("\n");
}

function textToCodes(text: string): Record<string, string> {
  const codes: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [account, code = ""] = line.split(/\s*[=:]\s*|\s+/);
    codes[account.trim()] = code.trim();
  }
  return codes;
}

export function EbarimtArapSettings({ settings }: { settings: PosSettingsView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.ebarimtArapEnabled);
  const [paymentCode, setPaymentCode] = useState(settings.ebarimtArapPaymentCode);
  const [classification, setClassification] = useState(settings.ebarimtArapClassificationCode);
  const [accountText, setAccountText] = useState(codesToText(settings.ebarimtArapAccountCodes));

  const canEnable = settings.ebarimtEnabled && settings.ebarimtMode === "server";

  function save() {
    startTransition(async () => {
      const result = await updatePosSettings({
        ebarimtArapPaymentCode: paymentCode,
        ebarimtArapClassificationCode: classification,
        ebarimtArapAccountCodes: textToCodes(accountText),
        ebarimtArapEnabled: enabled,
      });
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      feedback.saved("АР нэхэмжлэхийн eBarimt тохиргоо хадгалагдлаа");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--ea-border)] p-3">
      <div>
        <div className="text-sm font-semibold text-[var(--ea-text-1)]">АР нэхэмжлэх → eBarimt нэхэмжлэх</div>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Авлагын модульд батлагдсан борлуулалтын нэхэмжлэх eBarimt-д нэхэмжлэхээр (байгууллагад B2B, хувь хүнд
          B2C) автоматаар илгээгдэнэ. Нэхэмжлэхийн төлөлтийг ТЕГ-д мэдэгдэх урсгал албан баталгаажаагүй тул
          одоогоор ЗӨВХӨН нэхэмжлэх илгээгдэнэ.
        </p>
        <p className="mt-1 text-xs text-[var(--ea-warning-fg)]">
          ⚠ PosAPI гарын авлагад нэхэмжлэхийн дүрэм тусгагдаагүй — туршилтын орчинд шалгаж баталгаажуулсны дараа асаана уу
          (docs/pos/05 §4).
        </p>
      </div>
      <SwitchField
        label="АР нэхэмжлэхийг eBarimt-д илгээх"
        hint={canEnable ? undefined : "eBarimt идэвхтэй, «Сервер» горимтой үед л асна"}
        checked={enabled}
        onChange={setEnabled}
        disabled={!canEnable && !enabled}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Төлөгдөөгүй дүнгийн төлбөрийн код" hint="Нэхэмжлэхийн төлөгдөөгүй хэсгийн eBarimt код (жишээ INVOICE) — ТЕГ-ээс баталгаажуулна">
          <Input value={paymentCode} placeholder="INVOICE" className="font-mono" onChange={(e) => setPaymentCode(e.target.value)} />
        </FormField>
        <FormField label="Анхдагч ангиллын код" hint="Бараагүй (үйлчилгээний) мөрийн 7 оронтой ангиллын код">
          <Input
            value={classification}
            placeholder="7 орон"
            inputMode="numeric"
            className="font-mono"
            onChange={(e) => setClassification(e.target.value)}
          />
        </FormField>
      </div>
      <FormField label="Орлогын данс → ангиллын код" hint="Мөр бүрд «данс = код», жишээ 51100000 = 8311100. Анхдагч кодоос түрүүлнэ; бараатай мөрт барааных.">
        <textarea
          rows={3}
          className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          value={accountText}
          placeholder="51100000 = 8311100"
          onChange={(e) => setAccountText(e.target.value)}
        />
      </FormField>
      <div className="flex justify-end">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
      </div>
    </div>
  );
}
