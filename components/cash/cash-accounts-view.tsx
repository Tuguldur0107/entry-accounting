"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  createCashAccount,
  deleteCashAccount,
  toggleCashAccount,
  updateCashAccount,
} from "@/lib/actions/cash";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type {
  CashAccountView,
  CashGlAccountOption,
} from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FormField, SwitchField } from "@/components/ui/form-field";
import { QPAY_BANK_CODES, guessQpayBankCode } from "@/lib/qpay/reference";
import { EmptyState } from "@/components/ui/empty-state";
import { CurrencySelect } from "@/components/ui/currency-select";
import { useNewParam } from "@/components/ui/use-new-param";
import { READ_ONLY_HINT, useModuleCan } from "@/components/layout/module-access-context";

interface Props {
  accounts: CashAccountView[];
  glAccounts: CashGlAccountOption[];
}

/** Банк сонгогч: QPay банкны код (lib/qpay/reference.ts) + «Бусад» (нэрийг гараар). */
const OTHER_BANK = "other";
const BANK_OPTIONS = [
  ...QPAY_BANK_CODES.map((b) => ({ value: b.code, label: b.name })),
  { value: OTHER_BANK, label: "Бусад банк (нэрийг гараар)" },
];

const emptyForm = () => ({
  name: "",
  accountType: "bank" as "cash" | "bank",
  bankName: "",
  bankCode: "",
  accountNumber: "",
  accountHolder: "",
  iban: "",
  qpayPayout: false,
  qpayDefault: false,
  currency: "MNT",
  glAccountNumber: "",
  openingBalance: "0",
  openingDate: "",
  openingRate: "",
});

export function CashAccountsView({ accounts, glAccounts }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // null = шинэ данс үүсгэх; утгатай бол тухайн дансыг засах горим.
  const [editing, setEditing] = useState<CashAccountView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const glNameMap = useMemo(
    () => new Map(glAccounts.map((account) => [account.number, account.name])),
    [glAccounts]
  );

  const handleToggle = useCallback(
    (id: string, isActive: boolean) => {
      startTransition(async () => {
        try {
          const result = await toggleCashAccount(id, isActive);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          router.refresh();
          toast.success(isActive ? "Данс идэвхжлээ" : "Данс идэвхгүй боллоо");
          if (result.warning) toast.warning(result.warning);
        } catch (caught) {
          toast.error(
            caught instanceof Error ? caught.message : "Төлөв сольж чадсангүй"
          );
        }
      });
    },
    [router]
  );

  const columnDefs = useMemo<ColDef<CashAccountView>[]>(
    () => [
      {
        headerName: "Нэр",
        field: "name",
        minWidth: 180,
        flex: 1,
        cellRenderer: (params: ICellRendererParams<CashAccountView>) => (
          <div className="flex h-full items-center gap-2">
            {params.data?.accountType === "bank" ? (
              <Icon name="bank" size="sm" className="text-[var(--ea-primary)]" />
            ) : (
              <Icon name="cash" size="sm" className="text-[var(--ea-success)]" />
            )}
            <span>{params.value}</span>
          </div>
        ),
      },
      {
        headerName: "Төрөл",
        field: "accountType",
        width: 100,
        valueGetter: (params) =>
          params.data?.accountType === "bank" ? "Банк" : "Касс",
      },
      {
        headerName: "Банк",
        field: "bankName",
        minWidth: 130,
      },
      {
        headerName: "Дансны дугаар",
        field: "accountNumber",
        minWidth: 150,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Валют",
        field: "currency",
        width: 90,
        cellClass: "font-mono text-xs",
      },
      {
        // QPay төлбөр хүлээн авах данс (docs/deployment/qpay.md §2b) — ★ үндсэн.
        headerName: "QPay",
        field: "qpayPayout",
        width: 100,
        valueGetter: (params) =>
          params.data?.qpayPayout ? (params.data.qpayDefault ? "★ Үндсэн" : "Тийм") : "",
        cellClass: "text-xs",
      },
      {
        headerName: "GL данс",
        field: "glAccountNumber",
        minWidth: 190,
        valueGetter: (params) => {
          const number = params.data?.glAccountNumber ?? "";
          return `${number} ${glNameMap.get(number) ?? ""}`.trim();
        },
      },
      {
        headerName: "Эхний үлдэгдэл",
        field: "openingBalance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Одоогийн үлдэгдэл",
        field: "balance",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 100,
        valueGetter: (params) => (params.data?.isActive ? "Тийм" : "Үгүй"),
        cellRenderer: (params: ICellRendererParams<CashAccountView>) => {
          const account = params.data;
          if (!account) return null;
          return (
            <div className="flex h-full items-center">
              <Switch
                checked={account.isActive}
                disabled={isPending}
                onCheckedChange={(checked) =>
                  handleToggle(account.id, checked)
                }
                aria-label={`${account.name} идэвхтэй`}
              />
            </div>
          );
        },
      },
    ],
    [glNameMap, handleToggle, isPending]
  );

  function showDialog() {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setOpen(true);
  }
  // SIM2-032: «+ Шинэ» цэс / хоосон төлөвийн CTA (?new=1) — цонх шууд нээгдэнэ.
  useNewParam(showDialog);
  // SIM2-047: үзэгч эрхтэй бол бичих товч урьдчилан идэвхгүй.
  const canWrite = useModuleCan("cash", "write");

  function showEditDialog(account: CashAccountView) {
    setEditing(account);
    const bankCode = account.bankCode ?? guessQpayBankCode(account.bankName) ?? "";
    setForm({
      name: account.name,
      accountType: account.accountType === "cash" ? "cash" : "bank",
      bankName: account.bankName ?? "",
      bankCode: bankCode || (account.bankName ? OTHER_BANK : ""),
      accountNumber: account.accountNumber ?? "",
      accountHolder: account.accountHolder ?? "",
      iban: account.iban ?? "",
      qpayPayout: account.qpayPayout ?? false,
      qpayDefault: account.qpayDefault ?? false,
      currency: account.currency,
      glAccountNumber: account.glAccountNumber,
      openingBalance: String(account.openingBalance),
      openingDate: account.openingDate ?? "",
      openingRate: account.openingRate == null ? "" : String(account.openingRate),
    });
    setError("");
    setOpen(true);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const payload = {
        name: form.name,
        accountType: form.accountType,
        bankName: form.bankName,
        bankCode: form.bankCode && form.bankCode !== OTHER_BANK ? form.bankCode : null,
        accountNumber: form.accountNumber,
        accountHolder: form.accountHolder,
        iban: form.iban,
        qpayPayout: form.qpayPayout,
        qpayDefault: form.qpayDefault,
        currency: form.currency,
        glAccountNumber: form.glAccountNumber,
        openingBalance: Number(form.openingBalance.replaceAll(",", "")),
        openingDate: form.openingDate || null,
        openingRate:
          form.currency === "MNT" || !form.openingRate.trim()
            ? null
            : Number(form.openingRate.replaceAll(",", "")),
      };
      const result = editing
        ? await updateCashAccount({ id: editing.id, ...payload })
        : await createCashAccount(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      toast.success(editing ? "Данс хадгалагдлаа" : "Данс үүслээ");
      // QPay мерчантын данс sync амжилтгүй (best effort) — хадгалалт хэвээр.
      if (result.warning) toast.warning(result.warning);
    });
  }

  function remove() {
    if (!editing) return;
    const account = editing;
    void (async () => {
      const ok = await confirm({
        title: "Данс устгах уу?",
        description: `«${account.name}» данс бүрмөсөн устана. Гүйлгээтэй данс устгагдахгүй — түүнийг идэвхгүй болгоно.`,
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      startTransition(async () => {
        const result = await deleteCashAccount(account.id);
        if (result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
        toast.success("Данс устгагдлаа");
        if (result.warning) toast.warning(result.warning);
      });
    })();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Касс, банкны данс
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Мөнгөн хөрөнгийн данс бүрийг нэг үндсэн GL данстай холбоно.
          </p>
        </div>
        <Button
          onClick={showDialog}
          disabled={!canWrite}
          title={canWrite ? undefined : READ_ONLY_HINT}
        >
          <Icon name="add" />
          Данс нэмэх
        </Button>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon="cash"
          title="Мөнгөн хөрөнгийн данс үүсгээгүй байна"
          description="Касс, банкны данс бүрийг GL данстай холбож нэмнэ — дараа нь орлого, зарлага бичнэ."
          actions={canWrite ? [{ label: "Данс нэмэх", onClick: showDialog, icon: "add", primary: true }] : []}
        />
      ) : (
        <DataGridDynamic<CashAccountView>
          rowData={accounts}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          onRowDoubleClicked={(event) => {
            if (event.data) showEditDialog(event.data);
          }}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Мөнгөн хөрөнгийн данс засах"
                : "Мөнгөн хөрөнгийн данс нэмэх"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div
              className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--ea-border)]"
              role="group"
              aria-label="Дансны төрөл"
            >
              {[
                { value: "bank" as const, label: "Банкны данс" },
                { value: "cash" as const, label: "Касс" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      accountType: option.value,
                    }))
                  }
                  className={
                    form.accountType === option.value
                      ? "h-9 bg-[var(--ea-primary)] text-xs font-medium text-[var(--primary-foreground)]"
                      : "h-9 bg-[var(--ea-bg-2)] text-xs font-medium text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-3)]"
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>

            <FormField label="Дансны нэр">
              <Input
                value={form.name}
                placeholder={
                  form.accountType === "bank"
                    ? "Жишээ: Голомт банк MNT"
                    : "Жишээ: Төв касс"
                }
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </FormField>

            {form.accountType === "bank" && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Банк">
                    <SearchableSelect
                      value={form.bankCode}
                      options={BANK_OPTIONS}
                      hideValue
                      placeholder="Банк сонгох"
                      onChange={(code) =>
                        setForm((current) => ({
                          ...current,
                          bankCode: code,
                          bankName:
                            code === OTHER_BANK
                              ? current.bankName
                              : (QPAY_BANK_CODES.find((b) => b.code === code)?.name ?? current.bankName),
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="Дансны дугаар">
                    <Input
                      value={form.accountNumber}
                      placeholder="0000000000"
                      className="font-mono"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          accountNumber: event.target.value,
                        }))
                      }
                    />
                  </FormField>
                </div>
                {form.bankCode === OTHER_BANK && (
                  <FormField label="Банкны нэр" hint="Жагсаалтад байхгүй банк — QPay төлбөр хүлээн авах боломжгүй">
                    <Input
                      value={form.bankName}
                      placeholder="Банкны нэр"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          bankName: event.target.value,
                        }))
                      }
                    />
                  </FormField>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Данс эзэмшигч" hint="Хоосон бол компанийн нэр">
                    <Input
                      value={form.accountHolder}
                      placeholder="ж: Монгол Трейд ХХК"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          accountHolder: event.target.value,
                        }))
                      }
                    />
                  </FormField>
                  <FormField label="IBAN" hint="Сонголтоор">
                    <Input
                      value={form.iban}
                      placeholder="MN…"
                      className="font-mono"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          iban: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </FormField>
                </div>
                <div className="grid gap-2 rounded-md border border-[var(--ea-border)] p-3">
                  <SwitchField
                    label="QPay төлбөр хүлээн авах"
                    hint={
                      form.currency !== "MNT"
                        ? "QPay зөвхөн MNT данс руу төлбөр хүлээн авна"
                        : "Энэ данс QPay мерчантын дансанд бүртгэгдэж, салбар (агуулах) бүр өөрийн дансаа сонгоно. Банк жагсаалтаас, дугаар заавал."
                    }
                    checked={form.qpayPayout}
                    disabled={form.currency !== "MNT" || form.bankCode === OTHER_BANK || !form.bankCode}
                    onChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        qpayPayout: checked,
                        qpayDefault: checked ? current.qpayDefault : false,
                      }))
                    }
                  />
                  {form.qpayPayout && (
                    <SwitchField
                      label="Байгууллагын үндсэн QPay данс"
                      hint="Салбарт данс сонгоогүй үед энэ данс руу. Нэг л данс үндсэн байна — бусдаас тэмдэг автоматаар авагдана."
                      checked={form.qpayDefault}
                      onChange={(checked) => setForm((current) => ({ ...current, qpayDefault: checked }))}
                    />
                  )}
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Валют">
                <CurrencySelect
                  value={form.currency}
                  onChange={(currency) => setForm((current) => ({ ...current, currency }))}
                />
              </FormField>
              <FormField label="Эхний үлдэгдэл">
                <Input
                  type="number"
                  step="0.01"
                  value={form.openingBalance}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      openingBalance: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Нээлтийн огноо"
                hint="Эхний үлдэгдэлтэй бол заавал — нээлтийн журнал энэ огноогоор бичигдэнэ"
              >
                <Input
                  type="date"
                  value={form.openingDate}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      openingDate: event.target.value,
                    }))
                  }
                />
              </FormField>
              {form.currency !== "MNT" ? (
                <FormField
                  label="Нээлтийн ханш"
                  hint="Хоосон бол нээлтийн огнооны Монголбанкны албан ханш"
                >
                  <Input
                    type="number"
                    step="0.0001"
                    value={form.openingRate}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        openingRate: event.target.value,
                      }))
                    }
                  />
                </FormField>
              ) : null}
            </div>

            <FormField label="Холбох GL данс">
              <SearchableSelect
                value={form.glAccountNumber}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    glAccountNumber: value,
                  }))
                }
                options={glAccounts.map((account) => ({
                  value: account.number,
                  label: account.name,
                }))}
                placeholder="GL данс сонгох..."
              />
            </FormField>

            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className={editing ? "sm:justify-between" : undefined}>
            {editing && (
              <Button
                variant="destructive"
                onClick={remove}
                disabled={isPending}
              >
                <Icon name="delete" />
                Устгах
              </Button>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Болих
              </Button>
              <Button onClick={save} disabled={isPending}>
                {editing ? "Хадгалах" : "Данс үүсгэх"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </section>
  );
}

