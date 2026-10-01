"use client";

// POS тохиргоо → eBarimt → «АР нэхэмжлэх» (docs/pos/05-ebarimt-invoice-plan.md Шат 2–3).
// Батлагдсан борлуулалтын нэхэмжлэхийг eBarimt НЭХЭМЖЛЭХ (B2B/B2C_INVOICE),
// кассын модульд бүртгэсэн төлөлт бүрийг `invoiceId`-тай төлбөрийн баримт болгож
// илгээнэ (албан спек 3.0.1). Нэхэмжлэхэд мерчантын ТЕГ-д бүртгэлтэй банкны данс
// ЗААВАЛ — PosAPI-аас татаж сонгоно. Анхнаасаа УНТРААЛТТАЙ — байгууллага өөрөө асаана.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { FilterChips } from "@/components/ui/tabs";
import { listEbarimtBankAccounts } from "@/lib/actions/ebarimt";
import { updatePosSettings } from "@/lib/actions/pos";
import { EBARIMT_PAYMENT_CODES, EBARIMT_PAYMENT_CODE_LABELS, type EbarimtPaymentCode } from "@/lib/ebarimt/constants";
import type { PosApiBankAccount } from "@/lib/ebarimt/types";
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

const PAYMENT_CODE_OPTIONS = EBARIMT_PAYMENT_CODES.map((code) => ({
  value: code,
  label: EBARIMT_PAYMENT_CODE_LABELS[code],
}));

export function EbarimtArapSettings({ settings }: { settings: PosSettingsView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(settings.ebarimtArapEnabled);
  const [paymentCode, setPaymentCode] = useState<EbarimtPaymentCode>(
    (EBARIMT_PAYMENT_CODES as readonly string[]).includes(settings.ebarimtArapPaymentCode)
      ? (settings.ebarimtArapPaymentCode as EbarimtPaymentCode)
      : "BANK_TRANSFER"
  );
  const [bankAccountNo, setBankAccountNo] = useState(settings.ebarimtArapBankAccountNo);
  const [iban, setIban] = useState(settings.ebarimtArapIban);
  const [accounts, setAccounts] = useState<PosApiBankAccount[] | null>(null);
  const [isLoadingAccounts, startLoadingAccounts] = useTransition();
  const [classification, setClassification] = useState(settings.ebarimtArapClassificationCode);
  const [accountText, setAccountText] = useState(codesToText(settings.ebarimtArapAccountCodes));

  const canEnable = settings.ebarimtEnabled && settings.ebarimtMode === "server";

  function save() {
    startTransition(async () => {
      const result = await updatePosSettings({
        ebarimtArapPaymentCode: paymentCode,
        ebarimtArapBankAccountNo: bankAccountNo,
        ebarimtArapIban: iban,
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

  function loadAccounts() {
    startLoadingAccounts(async () => {
      const result = await listEbarimtBankAccounts();
      if (result.error) {
        feedback.error(result.error);
        return;
      }
      setAccounts(result.accounts ?? []);
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-[var(--ea-border)] p-3">
      <div>
        <div className="text-sm font-semibold text-[var(--ea-text-1)]">АР нэхэмжлэх → eBarimt нэхэмжлэх</div>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Авлагын модульд батлагдсан борлуулалтын нэхэмжлэх eBarimt-д нэхэмжлэхээр (байгууллагад B2B, хувь хүнд
          B2C) автоматаар илгээгдэнэ. Кассын модульд (касс, банк, хуулга, QPay линк) бүртгэсэн төлөлт бүр
          нэхэмжлэхийн ДДТД-тэй төлбөрийн баримт болж ТЕГ-д очно — НӨАТ-ын тайланд давхар орохгүй.
        </p>
        <p className="mt-1 text-xs text-[var(--ea-warning-fg)]">
          ⚠ Эхний удаа бодит жижиг нэхэмжлэх дээр туршиж, ТЕГ-ийн системд зөв харагдаж буйг шалгасны дараа бүрэн
          ашиглана уу (docs/pos/05 §4).
        </p>
      </div>
      <SwitchField
        label="АР нэхэмжлэхийг eBarimt-д илгээх"
        hint={canEnable ? undefined : "eBarimt идэвхтэй, «Сервер» горимтой үед л асна"}
        checked={enabled}
        onChange={setEnabled}
        disabled={!canEnable && !enabled}
      />
      <FormField
        label="Нэхэмжлэхийн төлбөрийн хэлбэр"
        hint="Нэхэмжлэхийн eBarimt-ийн төлбөрийн код (ихэвчлэн банкны шилжүүлэг). POS-ийн «Зээлээр» борлуулалт ч энэ код, дансаар нэхэмжлэх болж явна — дээрх switch-ээс үл хамаарна"
      >
        <FilterChips options={PAYMENT_CODE_OPTIONS} value={paymentCode} onChange={setPaymentCode} className="flex-wrap" />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Банкны дансны дугаар" hint="Нэхэмжлэхэд ЗААВАЛ — танай байгууллагын ТЕГ-д бүртгэлтэй данс">
          <Input
            value={bankAccountNo}
            placeholder="5000123456"
            inputMode="numeric"
            className="font-mono"
            onChange={(e) => setBankAccountNo(e.target.value)}
          />
        </FormField>
        <FormField label="IBAN" hint="Заавал биш — байвал хамт илгээгдэнэ">
          <Input value={iban} placeholder="MN…" className="font-mono" onChange={(e) => setIban(e.target.value)} />
        </FormField>
      </div>
      <div className="space-y-2">
        <Button size="sm" variant="outline" onClick={loadAccounts} disabled={isLoadingAccounts}>
          {isLoadingAccounts ? "Татаж байна…" : "PosAPI-аас бүртгэлтэй данс татах"}
        </Button>
        {accounts && (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((account) => (
              <Button
                key={account.bankAccountNo}
                size="sm"
                variant={account.bankAccountNo === bankAccountNo ? "default" : "outline"}
                onClick={() => {
                  setBankAccountNo(account.bankAccountNo);
                  setIban(account.iBan ?? "");
                }}
              >
                <span className="font-mono">{account.bankAccountNo}</span>
                {account.bankName ? ` · ${account.bankName}` : ""}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
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
