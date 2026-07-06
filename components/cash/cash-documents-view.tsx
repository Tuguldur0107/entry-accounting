"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import {
  createCashDocument,
  deleteCashDocument,
  postCashDocument,
  reverseCashDocument,
  type CashDocumentType,
} from "@/lib/actions/cash";
import type {
  CashAccountView,
  CashDocumentView,
  CashFlowOption,
  CashGlAccountOption,
} from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { CashDocumentDetailDialog } from "./cash-document-detail-dialog";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  payment: "Зарлага",
  transfer: "Шилжүүлэг",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

interface Props {
  documents: CashDocumentView[];
  accounts: CashAccountView[];
  glAccounts: CashGlAccountOption[];
  cashFlowOptions: CashFlowOption[];
  allowCreate?: boolean;
  title?: string;
  /** Render the type-tab row + summary footer (transactions page). */
  showToolbar?: boolean;
  /** Active type tab from URL (`?type=`). */
  initialType?: string;
  /** Active segment ids — needed to render GL account codes in the detail
   *  drawer per the segment display rule. */
  activeSegIds?: number[];
}

type TypeTab = "all" | CashDocumentType;

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "all", label: "Бүгд" },
  { value: "receipt", label: "Орлого" },
  { value: "payment", label: "Зарлага" },
  { value: "transfer", label: "Шилжүүлэг" },
];

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

export function CashDocumentsView({
  documents,
  accounts,
  glAccounts,
  cashFlowOptions,
  allowCreate = true,
  title = "Cash гүйлгээ",
  showToolbar = false,
  initialType,
  activeSegIds = [3],
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [detailDoc, setDetailDoc] = useState<CashDocumentView | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeTab: TypeTab = TYPE_TABS.some((t) => t.value === initialType)
    ? (initialType as TypeTab)
    : "all";

  function changeTab(next: TypeTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("type");
    else params.set("type", next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  // Type tab filters the already-date-filtered list. Summary totals below
  // reflect the *visible* (tab-filtered) documents so the numbers match
  // what the grid shows.
  const visibleDocuments = useMemo(
    () =>
      activeTab === "all"
        ? documents
        : documents.filter((d) => d.documentType === activeTab),
    [documents, activeTab]
  );

  const summary = useMemo(() => {
    let receipts = 0;
    let payments = 0;
    for (const d of visibleDocuments) {
      if (d.status === "reversed") continue;
      if (d.documentType === "receipt") receipts += d.amount;
      else if (d.documentType === "payment") payments += d.amount;
    }
    return { receipts, payments, net: receipts - payments, count: visibleDocuments.length };
  }, [visibleDocuments]);

  const accountNameMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );
  const glNameMap = useMemo(
    () => new Map(glAccounts.map((account) => [account.number, account.name])),
    [glAccounts]
  );

  const runAction = useCallback(
    (action: () => Promise<unknown>, successMessage: string) => {
      startTransition(async () => {
        try {
          await action();
          router.refresh();
          toast.success(successMessage);
        } catch (caught) {
          toast.error(
            caught instanceof Error ? caught.message : "Үйлдэл амжилтгүй"
          );
        }
      });
    },
    [router]
  );

  const handlePost = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Cash баримт батлах",
        description: "Энэ баримтыг баталж GL журнал автоматаар үүсгэх үү?",
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(() => postCashDocument(id), "Баримт батлагдаж GL-д бичигдлээ");
    },
    [runAction, confirm]
  );

  const handleReverse = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Сторно бичих",
        description: "Энэ батлагдсан баримтыг сторно журналаар буцаах уу?",
        confirmText: "Сторно",
        danger: true,
      });
      if (!ok) return;
      runAction(() => reverseCashDocument(id), "Баримт сторно хийгдлээ");
    },
    [runAction, confirm]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Ноорог устгах",
        description: "Энэ ноорог Cash баримтыг бүрмөсөн устгах уу?",
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(() => deleteCashDocument(id), "Ноорог устгагдлаа");
    },
    [runAction, confirm]
  );

  const columnDefs = useMemo<ColDef<CashDocumentView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Баримтын №",
        field: "documentNo",
        width: 190,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төрөл",
        field: "documentType",
        width: 110,
        valueGetter: (params) =>
          TYPE_LABELS[params.data?.documentType ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<CashDocumentView>) => {
          const type = params.data?.documentType ?? "";
          return (
            <span
              className={cn(
                "text-xs font-medium",
                type === "receipt" && "text-[var(--ea-success)]",
                type === "payment" && "text-[var(--ea-danger)]",
                type === "transfer" && "text-[var(--ea-primary)]"
              )}
            >
              {TYPE_LABELS[type] ?? type}
            </span>
          );
        },
      },
      {
        headerName: "Cash данс",
        colId: "cashAccount",
        minWidth: 180,
        flex: 1,
        valueGetter: (params) => {
          const document = params.data;
          if (!document) return "";
          if (document.documentType === "transfer") {
            return `${document.fromAccountName ?? ""} → ${
              document.toAccountName ?? ""
            }`;
          }
          const id =
            document.documentType === "receipt"
              ? document.toCashAccountId
              : document.fromCashAccountId;
          return id ? accountNameMap.get(id) ?? "" : "";
        },
      },
      {
        headerName: "Харилцагч / GL данс",
        colId: "counterparty",
        minWidth: 190,
        flex: 1,
        valueGetter: (params) => {
          const document = params.data;
          if (!document || document.documentType === "transfer") return "";
          const account = document.counterAccountNumber
            ? `${document.counterAccountNumber} ${
                glNameMap.get(document.counterAccountNumber) ?? ""
              }`
            : "";
          return [document.counterparty, account].filter(Boolean).join(" · ");
        },
      },
      {
        headerName: "Утга",
        field: "description",
        minWidth: 180,
        flex: 1,
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 122,
        valueGetter: (params) =>
          STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<CashDocumentView>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "posted"
                      ? "var(--ea-success)"
                      : status === "draft"
                        ? "var(--ea-warning)"
                        : "var(--ea-text-4)",
                }}
              />
              <span className="text-xs">
                {STATUS_LABELS[status] ?? status}
              </span>
            </div>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 112,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<CashDocumentView>) => {
          const document = params.data;
          if (!document) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              {document.status === "draft" && (
                <>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Баталж GL-д бичих"
                    aria-label="Баталж GL-д бичих"
                    onClick={() => handlePost(document.id)}
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Ноорог устгах"
                    aria-label="Ноорог устгах"
                    onClick={() => handleDelete(document.id)}
                  >
                    <Trash2 />
                  </button>
                </>
              )}
              {document.status === "posted" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Сторно хийх"
                  aria-label="Сторно хийх"
                  onClick={() => handleReverse(document.id)}
                >
                  <RotateCcw />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [
      accountNameMap,
      glNameMap,
      handleDelete,
      handlePost,
      handleReverse,
    ]
  );

  function showCreateDialog() {
    setForm(initialForm());
    setError("");
    setOpen(true);
  }

  function save(postNow: boolean) {
    setError("");
    const amount = Number(form.amount.replaceAll(",", ""));
    startTransition(async () => {
      try {
        await createCashDocument({
          documentType: form.documentType,
          date: form.date,
          fromCashAccountId: form.fromCashAccountId || undefined,
          toCashAccountId: form.toCashAccountId || undefined,
          counterAccountNumber: form.counterAccountNumber || undefined,
          cashFlowCode: form.cashFlowCode || undefined,
          counterparty: form.counterparty || undefined,
          description: form.description,
          amount,
          exchangeRate: Number(form.exchangeRate.replaceAll(",", "")) || undefined,
          postNow,
        });
        setOpen(false);
        router.refresh();
        toast.success(
          postNow ? "Гүйлгээ хадгалагдаж батлагдлаа" : "Ноорог гүйлгээ хадгалагдлаа"
        );
      } catch (caught) {
        // Keep the dialog open with the form intact so the user can fix
        // the input and retry — the error shows inline in the dialog.
        setError(
          caught instanceof Error ? caught.message : "Баримт хадгалж чадсангүй"
        );
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

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            {title}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Ноорог баримтыг батлах үед GL журнал автоматаар үүснэ.
          </p>
        </div>
        {allowCreate && (
          <Button onClick={showCreateDialog}>
            <Plus />
            Шинэ гүйлгээ
          </Button>
        )}
      </div>

      {showToolbar && (
        <div className="flex items-center gap-0 border-b border-[var(--ea-border)]">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => changeTab(tab.value)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-xs font-medium transition-colors",
                activeTab === tab.value
                  ? "border-[var(--ea-primary)] text-[var(--ea-primary)]"
                  : "border-transparent text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {visibleDocuments.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Cash гүйлгээ байхгүй
        </div>
      ) : (
        <>
          <DataGridDynamic<CashDocumentView>
            rowData={visibleDocuments}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height={Math.min(680, 86 + visibleDocuments.length * 38)}
            pagination={visibleDocuments.length > 25}
            paginationPageSize={25}
            paginationPageSizeSelector={false}
            wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onCellClicked={(event) => {
              // Ignore clicks in the actions column — those buttons have
              // their own handlers and shouldn't also open the drawer.
              if (event.column.getColId() === "actions") return;
              if (event.data) setDetailDoc(event.data);
            }}
          />

          {showToolbar && (
            <div
              className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md px-4 py-2.5 text-xs"
              style={{ background: "var(--ea-bg-2)", border: "1px solid var(--ea-border)" }}
            >
              <span className="mr-auto text-[var(--ea-text-3)]">
                {summary.count} гүйлгээ
                <span className="ml-1 text-[var(--ea-text-4)]">
                  (сторно хассан)
                </span>
              </span>
              <span className="text-[var(--ea-text-3)]">
                Орлого{" "}
                <span className="font-mono font-semibold text-[var(--ea-success-fg)]">
                  {fmtMnt(summary.receipts)}
                </span>
              </span>
              <span className="text-[var(--ea-text-3)]">
                Зарлага{" "}
                <span className="font-mono font-semibold text-[var(--ea-danger-fg)]">
                  {fmtMnt(summary.payments)}
                </span>
              </span>
              <span className="text-[var(--ea-text-3)]">
                Цэвэр{" "}
                <span
                  className={cn(
                    "font-mono font-semibold",
                    summary.net < 0
                      ? "text-[var(--ea-danger-fg)]"
                      : "text-[var(--ea-text-1)]"
                  )}
                >
                  {fmtMnt(summary.net)}
                </span>
              </span>
            </div>
          )}
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Шинэ Cash гүйлгээ</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
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
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        documentType: type,
                      }))
                    }
                    className={cn(
                      "h-9 border-r border-[var(--ea-border)] text-xs font-medium last:border-r-0",
                      form.documentType === type
                        ? "bg-[var(--ea-primary)] text-white"
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

            {form.documentType !== "transfer" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Харилцах GL данс">
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

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
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
              <Check />
              Хадгалж батлах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CashDocumentDetailDialog
        document={detailDoc}
        onClose={() => setDetailDoc(null)}
        accountName={(id) => (id ? accountNameMap.get(id) ?? "" : "")}
        glName={(code) => (code ? glNameMap.get(code) ?? "" : "")}
        activeSegIds={activeSegIds}
      />

      {confirmDialog}
    </section>
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
