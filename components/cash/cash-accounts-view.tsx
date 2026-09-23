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
import { FormField } from "@/components/ui/form-field";

interface Props {
  accounts: CashAccountView[];
  glAccounts: CashGlAccountOption[];
}

const emptyForm = () => ({
  name: "",
  accountType: "bank" as "cash" | "bank",
  bankName: "",
  accountNumber: "",
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
          await toggleCashAccount(id, isActive);
          router.refresh();
          toast.success(isActive ? "Данс идэвхжлээ" : "Данс идэвхгүй боллоо");
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

  function showEditDialog(account: CashAccountView) {
    setEditing(account);
    setForm({
      name: account.name,
      accountType: account.accountType === "cash" ? "cash" : "bank",
      bankName: account.bankName ?? "",
      accountNumber: account.accountNumber ?? "",
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
        accountNumber: form.accountNumber,
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
        <Button onClick={showDialog}>
          <Icon name="add" />
          Данс нэмэх
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Мөнгөн хөрөнгийн данс үүсгээгүй байна
        </div>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Банк">
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
                <FormField label="Дансны дугаар">
                  <Input
                    value={form.accountNumber}
                    placeholder="0000000000"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        accountNumber: event.target.value,
                      }))
                    }
                  />
                </FormField>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Валют">
                <select
                  value={form.currency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      currency: event.target.value,
                    }))
                  }
                  className="ea-form-select"
                >
                  <option value="MNT">MNT</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="CNY">CNY</option>
                  <option value="RUB">RUB</option>
                </select>
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

