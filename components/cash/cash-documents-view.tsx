"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { Check, CheckCheck, Plus, RotateCcw, Trash2 } from "lucide-react";

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
  postCashDocuments,
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
import { AccountInput } from "@/components/account/account-input";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode } from "@/lib/grid/segments";
import { extractMainAccount } from "@/lib/reports/balances";
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
  /** Active status filter from URL (`?status=`). */
  initialStatus?: string;
  /** Active segment ids — needed to render GL account codes in the detail
   *  drawer per the segment display rule. */
  activeSegIds?: number[];
  /** AccountInput-ийн сегмент picker-т — байхгүй бол энгийн жагсаалт. */
  segmentOptions?: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  initialArApSettlement?: CashArApSettlementTarget | null;
  /** Open (unpaid / partially paid) AR/AP documents — lets the user pick an
   *  invoice to settle right from the new-transaction dialog. */
  arApOpenDocuments?: CashArApSettlementTarget[];
}

type TypeTab = "all" | CashDocumentType;
type StatusTab = "all" | "draft" | "posted" | "reversed";

export interface CashArApSettlementTarget {
  id: string;
  documentNo: string;
  documentType: "ar_invoice" | "ap_bill";
  counterpartyName: string;
  date: string;
  currency: string;
  controlAccountNumber: string;
  balance: number;
  description: string;
}

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "all", label: "Бүгд" },
  { value: "receipt", label: "Орлого" },
  { value: "payment", label: "Зарлага" },
  { value: "transfer", label: "Шилжүүлэг" },
];

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Бүх төлөв" },
  { value: "draft", label: "Ноорог" },
  { value: "posted", label: "Батлагдсан" },
  { value: "reversed", label: "Буцаагдсан" },
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

function settlementForm(
  target: CashArApSettlementTarget,
  accounts: CashAccountView[]
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
    fromCashAccountId: documentType === "payment" ? matchingCashAccount?.id ?? "" : "",
    toCashAccountId: documentType === "receipt" ? matchingCashAccount?.id ?? "" : "",
    counterAccountNumber: target.controlAccountNumber,
    counterparty: target.counterpartyName,
    description: `${target.documentNo} төлөлт`,
    amount: String(target.balance),
  };
}

export function CashDocumentsView({
  documents,
  accounts,
  glAccounts,
  cashFlowOptions,
  allowCreate = true,
  title = "Мөнгөн гүйлгээ",
  showToolbar = false,
  initialType,
  initialStatus,
  activeSegIds = [3],
  segmentOptions,
  defaultSegments = {},
  initialArApSettlement = null,
  arApOpenDocuments = [],
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(Boolean(initialArApSettlement));
  const [form, setForm] = useState(() =>
    initialArApSettlement
      ? settlementForm(initialArApSettlement, accounts)
      : initialForm()
  );
  const [settlementTarget, setSettlementTarget] =
    useState<CashArApSettlementTarget | null>(initialArApSettlement);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [detailDoc, setDetailDoc] = useState<CashDocumentView | null>(null);
  // GL-derived FX draft being confirmed — needs a rate before it can post.
  const [rateDoc, setRateDoc] = useState<CashDocumentView | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const gridApiRef = useRef<GridApi<CashDocumentView> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeTab: TypeTab = TYPE_TABS.some((t) => t.value === initialType)
    ? (initialType as TypeTab)
    : "all";
  const activeStatus: StatusTab = STATUS_TABS.some(
    (t) => t.value === initialStatus
  )
    ? (initialStatus as StatusTab)
    : "all";

  function changeTab(next: TypeTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("type");
    else params.set("type", next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function changeStatus(next: StatusTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  // Type tab + status chips filter the already-date-filtered list. Status
  // counts are computed on the type-filtered set so the chips always show
  // how many drafts etc. sit behind the current tab.
  const typeFiltered = useMemo(
    () =>
      activeTab === "all"
        ? documents
        : documents.filter((d) => d.documentType === activeTab),
    [documents, activeTab]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: typeFiltered.length,
      draft: 0,
      posted: 0,
      reversed: 0,
    };
    for (const d of typeFiltered) {
      if (d.status === "draft" || d.status === "posted" || d.status === "reversed")
        counts[d.status] += 1;
    }
    return counts;
  }, [typeFiltered]);

  const visibleDocuments = useMemo(
    () =>
      activeStatus === "all"
        ? typeFiltered
        : typeFiltered.filter((d) => d.status === activeStatus),
    [typeFiltered, activeStatus]
  );

  // Effective selection = the grid's last-reported selection ∩ drafts still
  // visible. A filter change (grid unmounts without firing selectionChanged)
  // or a row posted through another path must not leave a stale count on
  // the batch button or send non-drafts to the server.
  const selectedDrafts = useMemo(
    () =>
      visibleDocuments.filter(
        (d) => d.status === "draft" && selectedDraftIds.includes(d.id)
      ),
    [visibleDocuments, selectedDraftIds]
  );

  // Footer totals count ONLY posted documents (MNT base amounts) so they tie
  // to the dashboard / GL balances, which are posted-only. Drafts surface as
  // their own chip instead of silently inflating the totals.
  const summary = useMemo(() => {
    let receipts = 0;
    let payments = 0;
    let draftCount = 0;
    let draftBase = 0;
    for (const d of visibleDocuments) {
      if (d.status === "draft") {
        draftCount += 1;
        draftBase += d.baseAmount;
        continue;
      }
      if (d.status !== "posted") continue;
      if (d.documentType === "receipt") receipts += d.baseAmount;
      else if (d.documentType === "payment") payments += d.baseAmount;
    }
    return {
      receipts,
      payments,
      net: receipts - payments,
      count: visibleDocuments.length,
      draftCount,
      draftBase,
    };
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
    async (document: CashDocumentView) => {
      // GL-derived FX draft without a rate: the GL figure is MNT, so the
      // foreign-unit amount is unknown until the accountant supplies the
      // transaction-date rate. Ask for it instead of failing on the server.
      if (
        document.sourceVoucherId &&
        document.currency !== "MNT" &&
        document.exchangeRate <= 0
      ) {
        setRateInput("");
        setRateDoc(document);
        return;
      }
      const ok = await confirm({
        title: "Мөнгөн гүйлгээ батлах",
        description: document.sourceVoucherId
          ? "Энэ баримт GL журналаас үүссэн — батлахад шинэ журнал үүсэхгүй, эх журналыг холбоно. Батлах уу?"
          : "Энэ баримтыг баталж GL журнал автоматаар үүсгэх үү?",
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(
        () => postCashDocument(document.id),
        document.sourceVoucherId
          ? "Баримт батлагдаж эх GL журналтай холбогдлоо"
          : "Баримт батлагдаж GL-д бичигдлээ"
      );
    },
    [runAction, confirm]
  );

  const handleBatchPost = useCallback(async () => {
    const drafts = selectedDrafts;
    if (drafts.length === 0) return;
    const total = drafts.reduce((sum, d) => sum + d.baseAmount, 0);
    const ok = await confirm({
      title: "Ноорог олноор батлах",
      description: `${drafts.length} ноорог баримт (нийт ${fmtMnt(total)}) баталж GL-тэй холбох уу? Алдаатай баримт алгасагдаж, тайлан гарна.`,
      confirmText: `Батлах (${drafts.length})`,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await postCashDocuments(drafts.map((d) => d.id));
        gridApiRef.current?.deselectAll();
        setSelectedDraftIds([]);
        router.refresh();
        if (result.failures.length === 0) {
          toast.success(`${result.posted} баримт батлагдлаа`);
        } else {
          const numberById = new Map(drafts.map((d) => [d.id, d.documentNo]));
          toast.warning(
            `${result.posted} батлагдаж, ${result.failures.length} баримт алдаатай`,
            {
              description: result.failures
                .map((f) => `${numberById.get(f.id) ?? f.id}: ${f.error}`)
                .join("\n"),
              duration: 10000,
            }
          );
        }
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Олноор батлах амжилтгүй"
        );
      }
    });
  }, [selectedDrafts, confirm, router]);

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<CashDocumentView>) => {
      gridApiRef.current = event.api;
      setSelectedDraftIds(
        event.api
          .getSelectedRows()
          .filter((row) => row.status === "draft")
          .map((row) => row.id)
      );
    },
    []
  );

  // Confirm a GL-derived FX draft once the rate is supplied.
  function submitRatePost() {
    if (!rateDoc) return;
    const rate = Number(rateInput.replaceAll(",", ""));
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error("Ханш 0-ээс их тоо байна");
      return;
    }
    const target = rateDoc;
    setRateDoc(null);
    runAction(
      () => postCashDocument(target.id, { exchangeRate: rate }),
      "Баримт батлагдаж эх GL журналтай холбогдлоо"
    );
  }

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
        description: "Энэ ноорог мөнгөн гүйлгээг бүрмөсөн устгах уу?",
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
        width: 210,
        cellClass: "font-mono text-xs",
        cellRenderer: (params: ICellRendererParams<CashDocumentView>) => {
          const doc = params.data;
          if (!doc) return null;
          return (
            <span className="flex h-full items-center gap-1.5">
              <span className="truncate">{doc.documentNo}</span>
              {doc.sourceVoucherId && (
                <span
                  className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase leading-none"
                  style={{
                    background: "var(--ea-primary-50)",
                    color: "var(--ea-primary-500)",
                  }}
                  title="GL журналаас автоматаар үүссэн"
                >
                  GL
                </span>
              )}
            </span>
          );
        },
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
        headerName: "Мөнгөн хөрөнгийн данс",
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
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        // Foreign-currency documents show currency units; a GL-derived FX
        // draft has no rate yet, so only its MNT base figure is real.
        valueFormatter: (params) => {
          const document = params.data;
          if (!document) return fmtMnt(Number(params.value ?? 0));
          if (document.currency === "MNT") return fmtMnt(document.amount);
          if (document.exchangeRate > 0 && document.amount > 0)
            return `${document.amount.toLocaleString("en-US")} ${document.currency}`;
          return `${fmtMnt(document.baseAmount)} · ханш?`;
        },
        tooltipValueGetter: (params) => {
          const document = params.data;
          if (!document || document.currency === "MNT") return null;
          if (document.exchangeRate > 0)
            return `MNT дүн: ${fmtMnt(document.baseAmount)} (ханш ${document.exchangeRate})`;
          return "Валютын ханш тодорхойгүй — батлахад ханш асууна";
        },
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
                    onClick={() => handlePost(document)}
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
    setSettlementTarget(null);
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
          counterAccountNumber: form.counterAccountNumber
            ? extractMainAccount(form.counterAccountNumber)
            : undefined,
          cashFlowCode: form.cashFlowCode || undefined,
          counterparty: form.counterparty || undefined,
          description: form.description,
          amount,
          exchangeRate: Number(form.exchangeRate.replaceAll(",", "")) || undefined,
          postNow,
          arApDocumentId: settlementTarget?.id,
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

  // Open AR/AP documents matching the dialog's direction: receipts settle
  // AR invoices, payments settle AP bills.
  const arApOptionsForType =
    form.documentType === "transfer"
      ? []
      : arApOpenDocuments.filter(
          (d) =>
            d.documentType ===
            (form.documentType === "receipt" ? "ar_invoice" : "ap_bill")
        );

  // Link an open AR/AP document: prefill the form from it so posting
  // settles the invoice automatically. The already-chosen date stays, and
  // so does the chosen cash account when its currency matches the invoice.
  function applySettlementTarget(target: CashArApSettlementTarget | null) {
    setSettlementTarget(target);
    if (!target) return;
    setForm((current) => {
      const next = { ...settlementForm(target, accounts), date: current.date };
      if (segmentOptions)
        next.counterAccountNumber = buildSegCode(
        { ...defaultSegments, 3: target.controlAccountNumber },
          activeSegIds,
          defaultSegments
        );
      const accountKey =
        next.documentType === "receipt" ? "toCashAccountId" : "fromCashAccountId";
      const chosen = accounts.find((a) => a.id === current[accountKey]);
      if (chosen?.isActive && chosen.currency === target.currency)
        next[accountKey] = chosen.id;
      return next;
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            {title}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Ноорог батлахад GL журнал үүснэ; GL тэмдэгтэй ноорог эх журналаа
            холбоно (давхар бичилт үүсэхгүй).
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
        <div className="flex flex-wrap items-center gap-x-0 gap-y-1.5 border-b border-[var(--ea-border)]">
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
          <div className="ml-auto flex items-center gap-1.5 pb-1.5 pl-3">
            {STATUS_TABS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => changeStatus(chip.value)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  activeStatus === chip.value
                    ? "border-[var(--ea-primary)] bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
                    : "border-[var(--ea-border)] text-[var(--ea-text-3)] hover:border-[var(--ea-border-strong)] hover:text-[var(--ea-text-1)]",
                  chip.value === "draft" &&
                    statusCounts.draft > 0 &&
                    activeStatus !== "draft" &&
                    "border-[var(--ea-warning)] text-[var(--ea-warning-fg)]"
                )}
              >
                {chip.label}
                {chip.value !== "all" && statusCounts[chip.value] > 0 && (
                  <span className="ml-1 font-mono">{statusCounts[chip.value]}</span>
                )}
              </button>
            ))}
            {selectedDrafts.length > 0 && (
              <Button
                size="sm"
                className="ml-1.5 h-7"
                onClick={handleBatchPost}
                disabled={isPending}
              >
                <CheckCheck />
                Сонгосныг батлах ({selectedDrafts.length})
              </Button>
            )}
          </div>
        </div>
      )}

      {visibleDocuments.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Мөнгөн гүйлгээ байхгүй
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
            rowSelection={
              showToolbar
                ? {
                    mode: "multiRow",
                    checkboxes: (params) => params.data?.status === "draft",
                    headerCheckbox: true,
                    hideDisabledCheckboxes: true,
                    isRowSelectable: (node) => node.data?.status === "draft",
                    enableClickSelection: false,
                  }
                : undefined
            }
            onGridReady={(event) => {
              gridApiRef.current = event.api;
            }}
            onSelectionChanged={handleSelectionChanged}
            onCellClicked={(event) => {
              // Ignore clicks in the actions column and the selection
              // checkbox column — those have their own behavior and
              // shouldn't also open the drawer.
              const colId = event.column.getColId();
              if (colId === "actions" || colId.startsWith("ag-Grid")) return;
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
                  (дүн — зөвхөн батлагдсан, MNT)
                </span>
              </span>
              {summary.draftCount > 0 && (
                <button
                  type="button"
                  onClick={() => changeStatus("draft")}
                  className="rounded-full border border-[var(--ea-warning)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--ea-warning-fg)] transition-colors hover:bg-[var(--ea-bg-3)]"
                  title="Ноорог баримтуудыг шүүж харах"
                >
                  Ноорог {summary.draftCount} ·{" "}
                  <span className="font-mono">{fmtMnt(summary.draftBase)}</span>
                </button>
              )}
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
            <DialogTitle>
              {settlementTarget ? "Авлага/өглөгийн төлөлт" : "Шинэ мөнгөн гүйлгээ"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            {settlementTarget && (
              <div className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--ea-text-1)]">
                    {settlementTarget.documentNo} · {settlementTarget.counterpartyName}
                  </span>
                  <span className="font-mono font-semibold text-[var(--ea-primary)]">
                    Үлдэгдэл {fmtMnt(settlementTarget.balance)} {settlementTarget.currency}
                  </span>
                </div>
                <p className="mt-1 text-[var(--ea-text-3)]">
                  Батлаад хадгалахад энэ мөнгөн гүйлгээ авлага/өглөгийн баримттай
                  автоматаар тулгагдана.
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
                      // An AR invoice settles via receipt, an AP bill via
                      // payment — unlink the invoice when the chosen type
                      // no longer matches it.
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

      {/* Rate prompt for confirming a GL-derived foreign-currency draft:
          the GL amount is MNT, so the accountant supplies the transaction
          rate and the currency amount is derived from it. */}
      <Dialog open={!!rateDoc} onOpenChange={(o) => !o && setRateDoc(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Валютын ханш оруулах</DialogTitle>
          </DialogHeader>
          {rateDoc && (
            <div className="grid gap-4">
              <p className="text-xs text-[var(--ea-text-3)]">
                <span className="font-mono">{rateDoc.documentNo}</span> — GL
                журналын дүн <b>{fmtMnt(rateDoc.baseAmount)}</b> (MNT). Энэ{" "}
                {rateDoc.currency} дансны гүйлгээний ханшийг оруулбал валютын
                дүн тооцогдож баталгаажна.
              </p>
              <Field label={`${rateDoc.currency}/MNT гүйлгээний ханш`}>
                <Input
                  type="number"
                  min="0.00000001"
                  step="0.00000001"
                  value={rateInput}
                  placeholder="0.00"
                  autoFocus
                  onChange={(event) => setRateInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submitRatePost();
                  }}
                />
              </Field>
              <Field label={`Тооцоолсон ${rateDoc.currency} дүн`}>
                <Input
                  readOnly
                  placeholder="0.00"
                  value={
                    Number(rateInput) > 0
                      ? `${(
                          Math.round(
                            (rateDoc.baseAmount / Number(rateInput)) * 100
                          ) / 100
                        ).toLocaleString("en-US")} ${rateDoc.currency}`
                      : ""
                  }
                />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRateDoc(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              onClick={submitRatePost}
              disabled={isPending || !(Number(rateInput) > 0)}
            >
              <Check />
              Ханшаар батлах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
