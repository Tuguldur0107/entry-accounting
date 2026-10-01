"use client";

// POS тохиргоо → eBarimt → «АР нэхэмжлэх» (docs/pos/05-ebarimt-invoice-plan.md Шат 2–3).
// Батлагдсан борлуулалтын нэхэмжлэхийг eBarimt НЭХЭМЖЛЭХ (B2B/B2C_INVOICE),
// кассын модульд бүртгэсэн төлөлт бүрийг `invoiceId`-тай төлбөрийн баримт болгож
// илгээнэ (албан спек 3.0.1). Нэхэмжлэхэд мерчантын ТЕГ-д бүртгэлтэй банкны данс
// ЗААВАЛ — PosAPI-аас татаж сонгоно. Анхнаасаа УНТРААЛТТАЙ — байгууллага өөрөө асаана.

import { useEffect, useState, useTransition } from "react";
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
  const [accountsError, setAccountsError] = useState<string | null>(null);
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

  function loadAccounts(silent = false) {
    startLoadingAccounts(async () => {
      const result = await listEbarimtBankAccounts();
      if (result.error) {
        setAccountsError(result.error);
        if (!silent) feedback.error(result.error);
        return;
      }
      setAccountsError(null);
      setAccounts(result.accounts ?? []);
    });
  }

  // ТЕГ-д бүртгэлтэй дансыг автоматаар асууна — ганц бол тохируулах шаардлагагүй
  // (сервер нь ч ижил дүрмээр — lib/ebarimt/invoice-bank.ts).
  useEffect(() => {
    if (canEnable) loadAccounts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onlyAccount = accounts && accounts.length === 1 ? accounts[0] : null;
  const usingAuto = !!onlyAccount && !bankAccountNo.trim();

  return (
    <div className="space-y-3 rounded-md border border-[var(--ea-border)] p-3">
      <div>
        <div className="text-sm font-semibold text-[var(--ea-text-1)]">Нэхэмжлэх → eBarimt (АР нэхэмжлэх, POS «Зээлээр»)</div>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Авлагын модульд батлагдсан борлуулалтын нэхэмжлэх eBarimt-д нэхэмжлэхээр (байгууллагад B2B, хувь хүнд
          B2C) автоматаар илгээгдэнэ. Кассын модульд (касс, банк, хуулга, QPay линк) бүртгэсэн төлөлт бүр
          нэхэмжлэхийн ДДТД-тэй төлбөрийн баримт болж ТЕГ-д очно — НӨАТ-ын тайланд давхар орохгүй.
        </p>
        <p className="mt-1 text-xs text-[var(--ea-text-3)]">
          Төлбөрийн хэлбэр ба банкны данс нь POS-ийн «Зээлээр» борлуулалтад ч хэрэглэгдэнэ (доорх тохиргооноос үл хамаарна).
        </p>
        {enabled && (
          <p className="mt-1 text-xs text-[var(--ea-warning-fg)]">
            ⚠ Эхний удаа бодит жижиг нэхэмжлэх дээр туршиж, ТЕГ-ийн системд зөв харагдаж буйг шалгасны дараа бүрэн ашиглана уу.
          </p>
        )}
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
        hint="Нэхэмжлэхийн eBarimt-ийн төлбөрийн код (ихэвчлэн банкны шилжүүлэг)"
      >
        <FilterChips options={PAYMENT_CODE_OPTIONS} value={paymentCode} onChange={setPaymentCode} className="flex-wrap" />
      </FormField>
      <FormField
        label="Нэхэмжлэхийн банкны данс"
        hint="Нэхэмжлэхэд ЗААВАЛ (ТЕГ 3.0.1) — танай ТЕГ-д бүртгэлтэй данс. Ганц бол автоматаар хэрэглэгдэнэ"
      >
        {isLoadingAccounts && !accounts ? (
          <div className="text-xs text-[var(--ea-text-3)]">ТЕГ-д бүртгэлтэй дансыг PosAPI-аас асууж байна…</div>
        ) : accounts && accounts.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {accounts.map((account) => {
                const selected = account.bankAccountNo === bankAccountNo || (usingAuto && account === onlyAccount);
                return (
                  <Button
                    key={account.bankAccountNo}
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    onClick={() => {
                      setBankAccountNo(account.bankAccountNo);
                      setIban(account.iBan ?? "");
                    }}
                  >
                    <span className="font-mono">{account.bankAccountNo}</span>
                    {account.bankName ? ` · ${account.bankName}` : ""}
                  </Button>
                );
              })}
            </div>
            <div className="text-xs text-[var(--ea-text-3)]">
              {usingAuto
                ? "ТЕГ-д ганц данс бүртгэлтэй — автоматаар хэрэглэгдэнэ, хадгалах шаардлагагүй."
                : accounts.length > 1 && !bankAccountNo.trim()
                  ? "ТЕГ-д олон данс бүртгэлтэй — нэхэмжлэхэд хэрэглэхийг сонгоод хадгална."
                  : `Сонгосон: ${bankAccountNo}${iban ? ` · IBAN ${iban}` : ""}`}
            </div>
          </div>
        ) : (
          // PosAPI-д хүрэхгүй (браузер горим г.м.) — дансаа гараар бичнэ.
          <div className="space-y-1.5">
            <Input
              value={bankAccountNo}
              placeholder="ТЕГ-д бүртгэлтэй дансны дугаар"
              inputMode="numeric"
              className="max-w-sm font-mono"
              onChange={(e) => {
                setBankAccountNo(e.target.value);
                setIban("");
              }}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ea-text-3)]">
              {accountsError && <span>{accountsError}</span>}
              {canEnable && (
                <Button size="sm" variant="outline" onClick={() => loadAccounts()} disabled={isLoadingAccounts}>
                  PosAPI-аас дахин асуух
                </Button>
              )}
            </div>
          </div>
        )}
      </FormField>
      {enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Анхдагч ангиллын код" hint="Бараагүй (үйлчилгээний) мөрийн 7 оронтой ангиллын код">
              <Input
                value={classification}
                placeholder="7 орон"
                inputMode="numeric"
                autoComplete="off"
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
        </>
      )}
      <div className="flex justify-end">
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Хадгалж байна…" : "Хадгалах"}
        </Button>
      </div>
    </div>
  );
}
