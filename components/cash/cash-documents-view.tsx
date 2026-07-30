"use client";

// Мөнгөн гүйлгээний жагсаалт. Мөр дээр дарахад баримтын дэлгэрэнгүй ПАНЕЛЬ
// (cash-doc), "Шинэ гүйлгээ" нь бичих ПАНЕЛЬ (cash-new) нээгдэнэ — урьд нь
// хоёулаа Dialog байсан. Валютын ханш асуух жижиг prompt болон бүх confirm
// хэвээр dialog.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";

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
  deleteCashDocument,
  postCashDocument,
  postCashDocuments,
  reverseCashDocument,
  type CashDocumentType,
} from "@/lib/actions/cash";
import type {
  CashAccountView,
  CashDocumentView,
  CashGlAccountOption,
} from "@/lib/cash/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openCashDocPanel,
  openCashNewPanel,
  refreshOpenPanels,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";

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
  allowCreate?: boolean;
  title?: string;
  /** Render the type-tab row + summary footer (transactions page). */
  showToolbar?: boolean;
  /** Active type tab from URL (`?type=`). */
  initialType?: string;
  /** Active status filter from URL (`?status=`). */
  initialStatus?: string;
  /**
   * `?arap=` deep link (АР/АП-ийн "Төлөх" товч) — сервер талд нээлттэй
   * баримт мөн эсэхийг нь шалгаад дамжуулдаг; mount дээр НЭГ удаа cash-new
   * панелийг төлөлтийн prefill-тэй нээнэ.
   */
  initialArApDocumentId?: string | null;
}

type TypeTab = "all" | CashDocumentType;
type StatusTab = "all" | "draft" | "posted" | "reversed";

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

export function CashDocumentsView({
  documents,
  accounts,
  glAccounts,
  allowCreate = true,
  title = "Мөнгөн гүйлгээ",
  showToolbar = false,
  initialType,
  initialStatus,
  initialArApDocumentId = null,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // GL-derived FX draft being confirmed — needs a rate before it can post.
  const [rateDoc, setRateDoc] = useState<CashDocumentView | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const gridApiRef = useRef<GridApi<CashDocumentView> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // `?arap=` deep link: АР/АП баримтын төлөлтийг cash-new панелиэр НЭГ удаа
  // нээнэ (ref guard — рендер бүрд дахин нээгдэхээс сэргийлнэ).
  const arApOpenedRef = useRef(false);
  useEffect(() => {
    if (!initialArApDocumentId || arApOpenedRef.current) return;
    arApOpenedRef.current = true;
    openCashNewPanel({ arApDocumentId: initialArApDocumentId });
  }, [initialArApDocumentId]);

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
          refreshOpenPanels();
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
        refreshOpenPanels();
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
        title: "Буцаалт бичих",
        description: "Энэ батлагдсан баримтыг буцаалтын журналаар буцаах уу?",
        confirmText: "Буцаалт хийх",
        danger: true,
      });
      if (!ok) return;
      runAction(() => reverseCashDocument(id), "Баримт буцаагдлаа");
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
                    <Icon name="approve" />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Ноорог устгах"
                    aria-label="Ноорог устгах"
                    onClick={() => handleDelete(document.id)}
                  >
                    <Icon name="delete" />
                  </button>
                </>
              )}
              {document.status === "posted" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Буцаалт хийх"
                  aria-label="Буцаалт хийх"
                  onClick={() => handleReverse(document.id)}
                >
                  <Icon name="reset" />
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
          <Button onClick={() => openCashNewPanel()}>
            <Icon name="add" />
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
                <Icon name="approveAll" />
                Сонгосныг батлах ({selectedDrafts.length})
              </Button>
            )}
          </div>
        </div>
      )}

      {visibleDocuments.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Мөнгөн гүйлгээ байхгүй
        </div>
      ) : (
        <>
          <DataGridDynamic<CashDocumentView>
            rowData={visibleDocuments}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.id}
            height="flex"
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
              // shouldn't also open the detail panel.
              const colId = event.column.getColId();
              if (colId === "actions" || colId.startsWith("ag-Grid")) return;
              if (event.data)
                openCashDocPanel(event.data.id, event.data.documentNo);
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
              <Icon name="approve" />
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
