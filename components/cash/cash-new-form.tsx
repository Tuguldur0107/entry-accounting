"use client";

// Шинэ мөнгөн гүйлгээ / АР-АП төлөлт бичих ФОРМ — cash-new панелийн агуулга.
// Урьд нь cash-documents-view.tsx доторх Dialog байсныг задалж гаргасан.
// Орлого/Зарлага/Шилжүүлэг сэлгэгч, АР/АП төлөлтийн prefill, валютын ханш,
// ноорог-эсвэл-батлах footer — бүгд хэвээр.
//
// Dirty төлвөө эхний render-ийн snapshot-той харьцуулж onDirtyChange-д
// мэдэгдэнэ (панелийн хаалтын баталгаажуулалтад). Амжилттай хадгалахад
// onSaved, алдаанд формоо нээлттэй үлдээж inline алдаа үзүүлнэ.

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { toast } from "sonner";
import { feedback } from "@/lib/ui/feedback";

import { AccountInput } from "@/components/account/account-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createCashDocument,
  type CashDocumentType,
} from "@/lib/actions/cash";
import type { CashArApSettlementTarget } from "@/lib/cash/load-options";
import type {
  CashAccountView,
  CashFlowOption,
  CashGlAccountOption,
} from "@/lib/cash/types";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount, fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};

interface Props {
  accounts: CashAccountView[];
  glAccounts: CashGlAccountOption[];
  cashFlowOptions: CashFlowOption[];
  activeSegIds: number[];
  /** AccountInput-ийн сегмент picker-т — байхгүй бол энгийн жагсаалт. */
  segmentOptions?: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  /** Нээлттэй АР/АП баримтууд — төлөлт болгож холбох сонголт. */
  arApOpenDocuments: CashArApSettlementTarget[];
  /** Панелийн payload-оос ирсэн урьдчилан сонгогдсон төлөлтийн баримт. */
  initialSettlement?: CashArApSettlementTarget | null;
  /** Татварын төлөлтийн prefill — зарлага, харилцах данс нь татварын өглөг. */
  initialTaxPayment?: {
    counterAccountNumber: string;
    description: string;
  } | null;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}

const initialForm = () => ({
  documentType: "receipt" as CashDocumentType,
  date: new Date().toISOString().slice(0, 10),
  fromCashAccountId: "",
  toCashAccountId: "",
  counterAccountNumber: "",
  cashFlowCode: "",
  counterparty: "",
  description: "",
  amount: "",
  exchangeRate: "",
});

function settlementForm(
  target: CashArApSettlementTarget,
  accounts: CashAccountView[],
  activeSegIds: number[],
  defaultSegments: Record<number, string>
) {
  const documentType: CashDocumentType =
    target.documentType === "ar_invoice" ? "receipt" : "payment";
  const matchingCashAccount =
    accounts.find(
      (account) => account.isActive && account.currency === target.currency
    ) ?? null;
  return {
    ...initialForm(),
    documentType,
    fromCashAccountId:
      documentType === "payment" ? matchingCashAccount?.id ?? "" : "",
    toCashAccountId:
      documentType === "receipt" ? matchingCashAccount?.id ?? "" : "",
    // AccountInput бүтэн 10 хэсэгт код хүлээдэг (сегментийн гэрээ) —
    // түүхий 8 оронтой control дансыг default сегментүүдээр өргөтгөнө.
    counterAccountNumber: buildSegCode(
      { ...defaultSegments, 3: target.controlAccountNumber },
      activeSegIds,
      defaultSegments
    ),
    counterparty: target.counterpartyName,
    description: `${target.documentNo} төлөлт`,
    amount: String(target.balance),
  };
}

export function CashNewForm({
  accounts,
  glAccounts,
  cashFlowOptions,
  activeSegIds,
  segmentOptions,
  defaultSegments = {},
  arApOpenDocuments,
  initialSettlement = null,
  initialTaxPayment = null,
  onDirtyChange,
  onSaved,
  onCancel,
}: Props) {
  const [form, setForm] = useState(() =>
    initialSettlement
      ? settlementForm(initialSettlement, accounts, activeSegIds, defaultSegments)
      : initialTaxPayment
        ? {
            ...initialForm(),
            documentType: "payment" as CashDocumentType,
            fromCashAccountId:
              (accounts.find((a) => a.isActive && a.currency === "MNT") ??
                accounts.find((a) => a.isActive))?.id ?? "",
            counterAccountNumber: buildSegCode(
              { ...defaultSegments, 3: initialTaxPayment.counterAccountNumber },
              activeSegIds,
              defaultSegments
            ),
            description: initialTaxPayment.description,
          }
        : initialForm()
  );
  const [settlementTarget, setSettlementTarget] =
    useState<CashArApSettlementTarget | null>(initialSettlement);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той
  // харьцуулна (journal-entry-form-той ижил хэв маяг).
  const currentSnapshot = JSON.stringify({
    form,
    settlementId: settlementTarget?.id ?? null,
  });
  const [initialSnapshot] = useState(currentSnapshot);
  const dirty = currentSnapshot !== initialSnapshot;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  function save(postNow: boolean) {
    setError("");
    const amount = Number(form.amount.replaceAll(",", ""));
    startTransition(async () => {
      try {
        const result = await createCashDocument({
          documentType: form.documentType,
          date: form.date,
          fromCashAccountId: form.fromCashAccountId || undefined,
          toCashAccountId: form.toCashAccountId || undefined,
          counterAccountNumber: form.counterAccountNumber
            ? extractMainAccount(form.counterAccountNumber)
            : undefined,
          cashFlowCode: form.cashFlowCode || undefined,
          counterparty: form.counterparty || undefined,
          description: form.description,
          amount,
          exchangeRate:
            Number(form.exchangeRate.replaceAll(",", "")) || undefined,
          postNow,
          arApDocumentId: settlementTarget?.id,
        });
        if (result.error) {
          // Формоо нээлттэй үлдээж inline алдаа — хэрэглэгч засаад дахин
          // оролдоно.
          setError(result.error);
          return;
        }
        if (postNow) feedback.posted("Гүйлгээ хадгалагдаж батлагдлаа");
        else feedback.saved("Ноорог гүйлгээ хадгалагдлаа");
        onSaved();
      } catch {
        setError("Баримт хадгалж чадсангүй");
      }
    });
  }

  const activeAccounts = accounts.filter((account) => account.isActive);
  const selectedCurrency =
    accounts.find((account) =>
      form.documentType === "receipt"
        ? account.id === form.toCashAccountId
        : account.id === form.fromCashAccountId
    )?.currency ?? "MNT";

  // Формын чиглэлд таарах нээлттэй АР/АП баримтууд: орлого нь авлагын
  // нэхэмжлэл, зарлага нь өглөгийн нэхэмжлэх хаана.
  const arApOptionsForType =
    form.documentType === "transfer"
      ? []
      : arApOpenDocuments.filter(
          (d) =>
            d.documentType ===
            (form.documentType === "receipt" ? "ar_invoice" : "ap_bill")
        );

  // Нээлттэй АР/АП баримт холбох: формыг түүнээс prefill хийж, батлахад
  // нэхэмжлэл автоматаар тулгагдана. Сонгосон огноо хэвээр, валют нь таарч
  // байвал сонгосон cash данс мөн хэвээр.
  function applySettlementTarget(target: CashArApSettlementTarget | null) {
    setSettlementTarget(target);
    if (!target) return;
    setForm((current) => {
      const next = {
        ...settlementForm(target, accounts, activeSegIds, defaultSegments),
        date: current.date,
      };
      const accountKey =
        next.documentType === "receipt"
          ? "toCashAccountId"
          : "fromCashAccountId";
      const chosen = accounts.find((a) => a.id === current[accountKey]);
      if (chosen?.isActive && chosen.currency === target.currency)
        next[accountKey] = chosen.id;
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid w-full max-w-2xl gap-4">
          {settlementTarget && (
            <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--ea-text-1)]">
                  {settlementTarget.documentNo} ·{" "}
                  {settlementTarget.counterpartyName}
                </span>
                <span className="font-mono font-semibold text-[var(--ea-primary)]">
                  Үлдэгдэл {fmtMnt(settlementTarget.balance)}{" "}
                  {settlementTarget.currency}
                </span>
              </div>
              <p className="mt-1 text-[var(--ea-text-3)]">
                Батлаад хадгалахад энэ мөнгөн гүйлгээ авлага/өглөгийн
                баримттай автоматаар тулгагдана.
              </p>
            </div>
          )}

          <div
            className="grid grid-cols-3 overflow-hidden rounded-md border border-[var(--ea-border)]"
            role="group"
            aria-label="Гүйлгээний төрөл"
          >
            {(["receipt", "payment", "transfer"] as CashDocumentType[]).map(
              (type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    setForm((current) => ({
                      ...current,
                      documentType: type,
                    }));
                    // Авлагын нэхэмжлэл орлогоор, өглөгийн нэхэмжлэх
                    // зарлагаар хаагдана — сонгосон төрөл таарахаа болибол
                    // холболтыг салгана.
                    setSettlementTarget((current) =>
                      current &&
                      (current.documentType === "ar_invoice"
                        ? "receipt"
                        : "payment") !== type
                        ? null
                        : current
                    );
                  }}
                  className={cn(
                    "h-9 border-r border-[var(--ea-border)] text-xs font-medium last:border-r-0",
                    form.documentType === type
                      ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-3)]"
                  )}
                >
                  {TYPE_LABELS[type]}
                </button>
              )
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Огноо">
              <Input
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Дүн">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                placeholder="0.00"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amount: event.target.value,
                  }))
                }
              />
            </Field>
          </div>

          {(form.documentType === "payment" ||
            form.documentType === "transfer") && (
            <Field label="Гаргах данс">
              <CashAccountSelect
                value={form.fromCashAccountId}
                accounts={activeAccounts}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    fromCashAccountId: value,
                    exchangeRate: "",
                  }))
                }
              />
            </Field>
          )}

          {(form.documentType === "receipt" ||
            form.documentType === "transfer") && (
            <Field label="Хүлээн авах данс">
              <CashAccountSelect
                value={form.toCashAccountId}
                accounts={activeAccounts}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    toCashAccountId: value,
                    exchangeRate: "",
                  }))
                }
              />
            </Field>
          )}

          {selectedCurrency !== "MNT" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={`${selectedCurrency}/MNT гүйлгээний ханш`}>
                <Input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={form.exchangeRate}
                  placeholder="0.00000000"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      exchangeRate: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="GL-д бичигдэх MNT дүн">
                <Input
                  value={
                    Number(form.amount) > 0 && Number(form.exchangeRate) > 0
                      ? fmtMnt(
                          Math.round(
                            Number(form.amount) *
                              Number(form.exchangeRate) *
                              100
                          ) / 100
                        )
                      : ""
                  }
                  readOnly
                  placeholder="0.00"
                />
              </Field>
            </div>
          )}

          {arApOptionsForType.length > 0 && (
            <Field
              label={
                form.documentType === "receipt"
                  ? "Авлагын нэхэмжлэлээс сонгох"
                  : "Өглөгийн нэхэмжлэхээс сонгох"
              }
            >
              <SearchableSelect
                value={settlementTarget?.id ?? ""}
                onChange={(value) =>
                  applySettlementTarget(
                    arApOpenDocuments.find((d) => d.id === value) ?? null
                  )
                }
                options={[
                  { value: "", label: "— Нэхэмжлэх холбохгүй —" },
                  ...arApOptionsForType.map((d) => ({
                    value: d.id,
                    label: `${d.documentNo} · ${d.counterpartyName}`,
                    hint: `Үлдэгдэл ${fmtMnt(d.balance)} ${d.currency}`,
                  })),
                ]}
                placeholder="Нэхэмжлэх сонгох (заавал биш)..."
              hideValue
              />
            </Field>
          )}

          {form.documentType !== "transfer" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Харилцах GL данс">
                {segmentOptions ? (
                  <AccountInput
                    value={form.counterAccountNumber}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        counterAccountNumber: value,
                      }))
                    }
                    activeSegIds={activeSegIds}
                    segmentOptions={segmentOptions}
                    defaultSegments={defaultSegments}
                    placeholder="GL данс..."
                  />
                ) : (
                  <SearchableSelect
                    value={form.counterAccountNumber}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        counterAccountNumber: value,
                      }))
                    }
                    options={glAccounts.map((account) => ({
                      value: account.number,
                      label: account.name,
                    }))}
                    placeholder="GL данс сонгох..."
                  />
                )}
              </Field>
              <Field label="Харилцагч">
                <Input
                  value={form.counterparty}
                  placeholder="Нэр эсвэл байгууллага"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      counterparty: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
          )}

          <Field label="Мөнгөн гүйлгээний ангилал (S8)">
            <select
              value={form.cashFlowCode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  cashFlowCode: event.target.value,
                }))
              }
              className="ea-form-select"
            >
              <option value="">Ангилалгүй</option>
              {cashFlowOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Гүйлгээний утга">
            <Input
              value={form.description}
              placeholder="Баримтын тайлбар"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </Field>

          {error && (
            <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
              {error}
            </p>
          )}
        </div>
      </div>

      <footer
        className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 py-3"
        style={{ borderTop: "1px solid var(--ea-border)" }}
      >
        <Button variant="outline" onClick={onCancel} disabled={isPending}>
          Болих
        </Button>
        <Button
          variant="secondary"
          onClick={() => save(false)}
          disabled={isPending}
        >
          Ноорог хадгалах
        </Button>
        <Button onClick={() => save(true)} disabled={isPending}>
          <Icon name="approve" />
          Хадгалж батлах
        </Button>
      </footer>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function CashAccountSelect({
  value,
  accounts,
  onChange,
}: {
  value: string;
  accounts: CashAccountView[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="ea-form-select"
    >
      <option value="">Сонгох...</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {account.currency} · {fmtMnt(account.balance)}
        </option>
      ))}
    </select>
  );
}
