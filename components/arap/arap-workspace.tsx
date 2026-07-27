"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { nanoid } from "nanoid";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import {
  AlertTriangle,
  Building2,
  FilePlus2,
  Plus,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useDirtyClose } from "@/lib/ui/use-dirty-close";
import { CLEARING_ACCOUNT } from "@/lib/costing/costing";

import { AccountInput } from "@/components/account/account-input";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createArApDocument,
  postArApDocument,
  createCounterparty,
  toggleCounterparty,
} from "@/lib/actions/arap";
import type {
  ArApDocumentType,
  ArApDocumentView,
  ArApLineInput,
  CounterpartyView,
} from "@/lib/arap/types";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { parseMntInput } from "@/lib/grid/formatters";
import { buildSegCode, fmtAccountDisplay, normalizePastedAccount } from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";

type Focus = "dashboard" | "counterparties" | "documents" | "reports";
type ArApMode = "combined" | "receivable" | "payable";

type LineRow = ArApLineInput & { id: string };
type ReportRow = {
  counterpartyName: string;
  currency: string;
  documentCount: number;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  baseBalance: number;
  currentAmount: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  daysOver90: number;
};

interface InventoryItemOption {
  id: string;
  code: string;
  name: string;
  unit: string;
}

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  focus?: Focus;
  mode?: ArApMode;
  counterparties: CounterpartyView[];
  documents: ArApDocumentView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  defaultAccountNumbers: {
    receivable: string;
    payable: string;
  };
  reportAsOf?: string;
  /** Бараатай мөр бичихэд — АП орлого / АР зарлагын inventory холбоос. */
  inventoryItems?: InventoryItemOption[];
  warehouses?: WarehouseOption[];
}

const TYPE_LABELS: Record<string, string> = {
  ar_invoice: "Авлага",
  ap_bill: "Өглөг",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  partially_paid: "Хэсэгчлэн төлсөн",
  paid: "Төлсөн",
  reversed: "Буцаагдсан",
};

const MODE_CONFIG: Record<
  ArApMode,
  {
    title: string;
    description: string;
    documentType: ArApDocumentType;
    counterpartyType: "customer" | "supplier" | "both";
    documentTitle: string;
    reportTitle: string;
    createLabel: string;
    emptyDocuments: string;
  }
> = {
  combined: {
    title: "Харилцагчийн тооцоо",
    description: "Авлага, өглөгийн баримт, харилцагчийн default данс, GL бичилтийн хяналт",
    documentType: "ar_invoice",
    counterpartyType: "both",
    documentTitle: "Авлага, өглөгийн баримт",
    reportTitle: "Авлага, өглөгийн тайлан",
    createLabel: "Баримт үүсгэх",
    emptyDocuments: "Баримт бүртгээгүй байна",
  },
  receivable: {
    title: "Авлага",
    description: "Харилцагчийн авлага, нэхэмжлэл, төлөлтийн үлдэгдэл",
    documentType: "ar_invoice",
    counterpartyType: "customer",
    documentTitle: "Авлагын нэхэмжлэл",
    reportTitle: "Авлагын тайлан",
    createLabel: "Нэхэмжлэл үүсгэх",
    emptyDocuments: "Авлагын нэхэмжлэл бүртгээгүй байна",
  },
  payable: {
    title: "Өглөг",
    description: "Нийлүүлэгчийн өглөг, нэхэмжлэх, төлөлтийн үлдэгдэл",
    documentType: "ap_bill",
    counterpartyType: "supplier",
    documentTitle: "Өглөгийн нэхэмжлэх",
    reportTitle: "Өглөгийн тайлан",
    createLabel: "Нэхэмжлэх бүртгэх",
    emptyDocuments: "Өглөгийн нэхэмжлэх бүртгээгүй байна",
  },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function emptyLine(activeSegIds: number[], defaultSegments: Record<number, string>): LineRow {
  return {
    id: nanoid(),
    account: buildSegCode({}, activeSegIds, defaultSegments),
    description: "",
    amount: 0,
  };
}

export function ArApWorkspace({
  focus = "dashboard",
  mode = "combined",
  counterparties,
  documents,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  defaultAccountNumbers,
  reportAsOf = today(),
  inventoryItems = [],
  warehouses = [],
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const config = MODE_CONFIG[mode];
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [counterpartyOpen, setCounterpartyOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);
  const [reportDate, setReportDate] = useState(reportAsOf);
  const [counterpartyForm, setCounterpartyForm] = useState(() => ({
    name: "",
    counterpartyType: config.counterpartyType,
    registerNo: "",
    defaultReceivableAccountNumber: defaultAccountNumbers.receivable
      ? buildSegCode({ 3: defaultAccountNumbers.receivable }, activeSegIds, defaultSegments)
      : "",
    defaultPayableAccountNumber: defaultAccountNumbers.payable
      ? buildSegCode({ 3: defaultAccountNumbers.payable }, activeSegIds, defaultSegments)
      : "",
    defaultCurrency: "MNT",
    paymentTermsDays: "30",
  }));
  const [documentForm, setDocumentForm] = useState(() => {
    const date = today();
    return {
      documentType: config.documentType,
      documentNo: "",
      counterpartyId: "",
      date,
      dueDate: addDays(date, 30),
      currency: "MNT",
      exchangeRate: "1",
      controlAccountNumber: "",
      description: "",
      lines: [emptyLine(activeSegIds, defaultSegments)],
    };
  });
  // Баримтын dialog нээгдэх агшны snapshot (JSON) — хаах үед үүнтэй
  // харьцуулж "хадгалаагүй өөрчлөлт" эсэхийг мэдэрнэ.
  const [documentBaseline, setDocumentBaseline] = useState("");
  const [error, setError] = useState("");

  const filteredDocuments = useMemo(
    () =>
      mode === "combined"
        ? documents
        : documents.filter((doc) =>
            mode === "receivable"
              ? doc.documentType === "ar_invoice"
              : doc.documentType === "ap_bill"
          ),
    [documents, mode]
  );

  const filteredCounterparties = useMemo(
    () =>
      mode === "combined"
        ? counterparties
        : counterparties.filter((item) =>
            mode === "receivable"
              ? item.counterpartyType === "customer" || item.counterpartyType === "both"
              : item.counterpartyType === "supplier" || item.counterpartyType === "both"
          ),
    [counterparties, mode]
  );

  const cpOptions = useMemo(
    () =>
      counterparties
        .filter((item) => item.isActive)
        .filter((item) =>
          mode === "combined"
            ? true
            : mode === "receivable"
              ? item.counterpartyType === "customer" || item.counterpartyType === "both"
              : item.counterpartyType === "supplier" || item.counterpartyType === "both"
        )
        .map((item) => ({
          value: item.id,
          label: item.name,
          hint:
            item.counterpartyType === "both"
              ? "Авлага/Өглөг"
              : item.counterpartyType === "customer"
                ? "Авлага"
                : "Өглөг",
        })),
    [counterparties, mode]
  );

  const arBalance = filteredDocuments
    .filter((doc) => doc.documentType === "ar_invoice" && doc.status !== "reversed")
    .reduce((sum, doc) => sum + doc.baseBalance, 0);
  const apBalance = filteredDocuments
    .filter((doc) => doc.documentType === "ap_bill" && doc.status !== "reversed")
    .reduce((sum, doc) => sum + doc.baseBalance, 0);
  const openBalance = filteredDocuments
    .filter((doc) => doc.status !== "reversed")
    .reduce((sum, doc) => sum + doc.baseBalance, 0);
  const overdueCount = filteredDocuments.filter(
    (doc) => doc.status !== "paid" && doc.status !== "reversed" && doc.dueDate < reportAsOf
  ).length;
  const overdueBalance = filteredDocuments
    .filter(
      (doc) =>
        doc.status !== "paid" &&
        doc.status !== "reversed" &&
        doc.dueDate < reportAsOf
    )
    .reduce((sum, doc) => sum + doc.baseBalance, 0);
  const reportRows = useMemo(
    () => buildReportRows(filteredDocuments, reportAsOf),
    [filteredDocuments, reportAsOf]
  );
  const actionDocuments = useMemo(
    () =>
      filteredDocuments
        .filter(
          (doc) => doc.status !== "paid" && doc.status !== "reversed" && doc.balance > 0
        )
        .sort((a, b) => {
          const aOverdue = a.dueDate < reportAsOf ? 0 : 1;
          const bOverdue = b.dueDate < reportAsOf ? 0 : 1;
          return aOverdue - bOverdue || a.dueDate.localeCompare(b.dueDate);
        })
        .slice(0, 5),
    [filteredDocuments, reportAsOf]
  );
  const recentDocuments = filteredDocuments.slice(0, 5);

  const counterpartyColumns = useMemo<ColDef<CounterpartyView>[]>(
    () => [
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      {
        headerName: "Төрөл",
        field: "counterpartyType",
        width: 120,
        valueGetter: (params) =>
          params.data?.counterpartyType === "both"
            ? "Хоёулаа"
            : params.data?.counterpartyType === "customer"
              ? "Авлага"
              : "Өглөг",
      },
      { headerName: "Валют", field: "defaultCurrency", width: 90 },
      {
        headerName: "Авлагын данс",
        field: "defaultReceivableAccountNumber",
        minWidth: 170,
        valueFormatter: (params) =>
          fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
      },
      {
        headerName: "Өглөгийн данс",
        field: "defaultPayableAccountNumber",
        minWidth: 170,
        valueFormatter: (params) =>
          fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
      },
      {
        headerName: "Төлөв",
        field: "isActive",
        width: 110,
        valueGetter: (params) => (params.data?.isActive ? "Идэвхтэй" : "Идэвхгүй"),
      },
      {
        headerName: "",
        colId: "action",
        width: 100,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: CounterpartyView }) =>
          data ? (
            <button
              type="button"
              className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
              onClick={() =>
                startTransition(async () => {
                  try {
                    await toggleCounterparty(data.id, !data.isActive);
                    toast.success("Харилцагчийн төлөв шинэчлэгдлээ");
                  } catch (caught) {
                    toast.error(caught instanceof Error ? caught.message : "Алдаа гарлаа");
                  }
                })
              }
            >
              {data.isActive ? "Идэвхгүй" : "Идэвхтэй"}
            </button>
          ) : null,
      },
    ],
    [activeSegIds]
  );

  const documentColumns = useMemo<ColDef<ArApDocumentView>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 112, cellClass: "font-mono text-xs" },
      { headerName: "№", field: "documentNo", minWidth: 165, cellClass: "font-mono text-xs" },
      {
        headerName: "Төрөл",
        field: "documentType",
        width: 100,
        valueGetter: (params) => TYPE_LABELS[params.data?.documentType ?? ""] ?? "",
      },
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 180, flex: 1 },
      {
        headerName: "Төлөх огноо",
        field: "dueDate",
        width: 120,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Валют", field: "currency", width: 84 },
      {
        headerName: "Дүн",
        field: "totalAmount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 130,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
      },
      {
        headerName: "Төлөлт",
        colId: "payment",
        width: 145,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: ArApDocumentView }) =>
          data?.status === "posted" || data?.status === "partially_paid" ? (
            <Link
              href={`/cash/transactions?arap=${data.id}`}
              className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
            >
              Мөнгөн хөрөнгөөр хаах
            </Link>
          ) : data?.status === "draft" ? (
            <button
              type="button"
              className="text-xs font-medium text-[var(--ea-success-fg)] hover:underline"
              onClick={() => postDraftDocument(data)}
            >
              Батлах
            </button>
          ) : (
            <span className="text-xs text-[var(--ea-text-4)]">—</span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function resetDocument(type: ArApDocumentType = config.documentType) {
    const date = today();
    const next = {
      documentType: type,
      documentNo: "",
      counterpartyId: "",
      date,
      dueDate: addDays(date, 30),
      currency: "MNT",
      exchangeRate: "1",
      controlAccountNumber: "",
      description: "",
      lines: [emptyLine(activeSegIds, defaultSegments)],
    };
    setDocumentForm(next);
    setDocumentBaseline(JSON.stringify(next));
    setError("");
    setDocumentOpen(true);
  }

  function saveCounterparty() {
    setError("");
    startTransition(async () => {
      try {
        await createCounterparty({
          ...counterpartyForm,
          paymentTermsDays: Number(counterpartyForm.paymentTermsDays) || 0,
        });
        setCounterpartyOpen(false);
        toast.success("Харилцагч үүслээ");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  function saveDocument(postNow: boolean) {
    setError("");
    startTransition(async () => {
      try {
        await createArApDocument({
          ...documentForm,
          exchangeRate: Number(documentForm.exchangeRate),
          postNow,
          lines: documentForm.lines.map(
            ({ account, description, amount, itemId, quantity, warehouseId }) => ({
              account,
              description,
              amount,
              itemId: itemId || undefined,
              quantity: quantity || undefined,
              warehouseId: warehouseId || undefined,
            })
          ),
        });
        setDocumentOpen(false);
        toast.success(postNow ? "Баримт GL-д бичигдлээ" : "Ноорог хадгалагдлаа");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  // Хадгалалт нь setDocumentOpen(false)-ийг шууд дуудна — тиймээс амжилттай
  // хадгалсны дараа "гарах уу?" асуулт гарахгүй.
  const guardDocumentClose = useDirtyClose({
    dirty: documentOpen && JSON.stringify(documentForm) !== documentBaseline,
    confirm,
    setOpen: setDocumentOpen,
  });

  async function postDraftDocument(document: ArApDocumentView) {
    const ok = await confirm({
      title: "Баримт батлах",
      description: `${document.documentNo} ноорог баримтыг баталж GL журнал үүсгэх үү? Бараатай мөрүүд нь Бараа материалд тоо хэмжээний ноорог үүсгэнэ.`,
      confirmText: "Батлах",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await postArApDocument(document.id);
        router.refresh();
        toast.success("Баримт батлагдаж GL-д бичигдлээ");
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Батлах амжилтгүй"
        );
      }
    });
  }

  const showCounterparties = focus === "counterparties";
  const showDocuments = focus === "documents";
  const showReports = focus === "reports";

  return (
    <section className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            {config.title}
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            {config.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(focus === "dashboard" || focus === "counterparties") && (
            <Button variant="outline" onClick={() => setCounterpartyOpen(true)}>
              <Plus />
              Харилцагч
            </Button>
          )}
          {(focus === "dashboard" || focus === "documents") && (
            <Button onClick={() => resetDocument(config.documentType)}>
              <FilePlus2 />
              {config.createLabel}
            </Button>
          )}
        </div>
      </div>

      <section className="grid grid-cols-2 border-y border-[var(--ea-border)] lg:grid-cols-4">
        <Metric
          label={
            mode === "payable"
              ? "Нийт өглөг (MNT)"
              : "Нийт авлага (MNT)"
          }
          value={fmtMnt(mode === "payable" ? apBalance : arBalance)}
          icon={mode === "payable" ? ReceiptText : WalletCards}
        />
        <Metric
          label={mode === "combined" ? "Нийт өглөг (MNT)" : "Нээлттэй (MNT)"}
          value={fmtMnt(mode === "combined" ? apBalance : openBalance)}
          icon={mode === "combined" ? ReceiptText : WalletCards}
        />
        <Metric
          label={`Хэтэрсэн (MNT) · ${overdueCount}`}
          value={fmtMnt(overdueBalance)}
          icon={AlertTriangle}
        />
        <Metric label="Харилцагч" value={String(filteredCounterparties.length)} icon={Building2} />
      </section>

      {focus === "dashboard" &&
        (filteredDocuments.length === 0 && filteredCounterparties.length === 0 ? (
          <OnboardingState
            mode={mode}
            onCounterparty={() => setCounterpartyOpen(true)}
          />
        ) : (
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <CompactDocumentList
              title="Анхаарах шаардлагатай"
              rows={actionDocuments}
              asOf={reportAsOf}
              emptyText="Хугацаа хэтэрсэн эсвэл нээлттэй баримт алга"
            />
            <CompactDocumentList
              title="Сүүлийн баримтууд"
              rows={recentDocuments}
              asOf={reportAsOf}
              emptyText="Баримт бүртгээгүй байна"
            />
          </div>
        ))}

      {showDocuments && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              {config.documentTitle}
            </h2>
            <div className="text-[11px] text-[var(--ea-text-3)]">
              Төлөлт нь Мөнгөн хөрөнгийн модулиар хаагдана
            </div>
          </div>
          {filteredDocuments.length === 0 ? (
            <EmptyState
              text={config.emptyDocuments}
              actionLabel={config.createLabel}
              onAction={() => resetDocument(config.documentType)}
            />
          ) : (
            <DataGridDynamic<ArApDocumentView>
              rowData={filteredDocuments}
              columnDefs={documentColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </section>
      )}

      {showReports && (
        <ReportSection
          title={config.reportTitle}
          rows={reportRows}
          asOf={reportDate}
          onAsOfChange={setReportDate}
          onRefresh={() => router.push(`${pathname}?asOf=${reportDate}`)}
        />
      )}

      {showCounterparties && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Харилцагчид
          </h2>
          {filteredCounterparties.length === 0 ? (
            <EmptyState
              text="Харилцагч үүсгээгүй байна"
              actionLabel="Харилцагч нэмэх"
              onAction={() => setCounterpartyOpen(true)}
            />
          ) : (
            <DataGridDynamic<CounterpartyView>
              rowData={filteredCounterparties}
              columnDefs={counterpartyColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </section>
      )}

      <CounterpartyDialog
        open={counterpartyOpen}
        onOpenChange={setCounterpartyOpen}
        form={counterpartyForm}
        setForm={setCounterpartyForm}
        activeSegIds={activeSegIds}
        segmentOptions={segmentOptions}
        defaultSegments={defaultSegments}
        isPending={isPending}
        error={error}
        onSave={saveCounterparty}
      />

      <DocumentDialog
        open={documentOpen}
        onOpenChange={guardDocumentClose}
        form={documentForm}
        setForm={setDocumentForm}
        counterparties={counterparties}
        cpOptions={cpOptions}
        activeSegIds={activeSegIds}
        segmentOptions={segmentOptions}
        defaultSegments={defaultSegments}
        isPending={isPending}
        error={error}
        onSave={saveDocument}
        mode={mode}
        inventoryItems={inventoryItems}
        warehouses={warehouses}
      />
      {confirmDialog}
    </section>
  );
}

function daysBetween(later: string, earlier: string) {
  const laterTime = Date.parse(`${later}T00:00:00Z`);
  const earlierTime = Date.parse(`${earlier}T00:00:00Z`);
  return Math.floor((laterTime - earlierTime) / 86_400_000);
}

function buildReportRows(documents: ArApDocumentView[], asOf: string): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const doc of documents) {
    if (doc.status === "reversed" || doc.date > asOf) continue;
    const key = `${doc.counterpartyId}:${doc.currency}`;
    const existing =
      rows.get(key) ??
      {
        counterpartyName: doc.counterpartyName,
        currency: doc.currency,
        documentCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        balance: 0,
        baseBalance: 0,
        currentAmount: 0,
        days1To30: 0,
        days31To60: 0,
        days61To90: 0,
        daysOver90: 0,
      };
    existing.documentCount += 1;
    existing.totalAmount += doc.totalAmount;
    existing.paidAmount += doc.paidAmount;
    existing.balance += doc.balance;
    existing.baseBalance += doc.baseBalance;
    const overdueDays = daysBetween(asOf, doc.dueDate);
    if (overdueDays <= 0) existing.currentAmount += doc.balance;
    else if (overdueDays <= 30) existing.days1To30 += doc.balance;
    else if (overdueDays <= 60) existing.days31To60 += doc.balance;
    else if (overdueDays <= 90) existing.days61To90 += doc.balance;
    else existing.daysOver90 += doc.balance;
    rows.set(key, existing);
  }
  return [...rows.values()].sort((a, b) => b.baseBalance - a.baseBalance);
}

function ArApLinesGrid({
  lines,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  inventoryItems,
  warehouses,
  documentType,
}: {
  lines: LineRow[];
  onChange: (updater: (prev: LineRow[]) => LineRow[]) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  documentType: ArApDocumentType;
}) {
  const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  // Бараатай мөр: АП батлагдахад орлогын, АР батлагдахад зарлагын тоо
  // хэмжээний draft inventory-д үүснэ (бараа бүртгэлтэй үед л харагдана).
  const itemLabelById = useMemo(
    () =>
      new Map(
        inventoryItems.map((item) => [item.id, `${item.code} · ${item.name}`])
      ),
    [inventoryItems]
  );
  const warehouseLabelById = useMemo(
    () =>
      new Map(
        warehouses.map((warehouse) => [
          warehouse.id,
          `${warehouse.code} · ${warehouse.name}`,
        ])
      ),
    [warehouses]
  );
  const columns = useMemo<ColDef<LineRow>[]>(
    () => [
      { headerName: "#", width: 48, valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1 },
      {
        headerName: "Данс",
        field: "account",
        minWidth: 240,
        flex: 1,
        editable: true,
        cellEditor: AccountSegmentEditor,
        cellEditorParams: {
          activeSegIds,
          segOptions: segmentOptions,
          extraDefaults: defaultSegments,
        },
        valueFormatter: (params) =>
          fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
      },
      {
        headerName: "Тайлбар",
        field: "description",
        minWidth: 180,
        flex: 1,
        editable: true,
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        editable: true,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          const value = parseMntInput(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : 0;
        },
        valueFormatter: (params) =>
          params.value ? fmtMnt(Number(params.value)) : "",
      },
      ...(inventoryItems.length > 0
        ? ([
            {
              headerName: "Бараа",
              field: "itemId",
              minWidth: 170,
              editable: true,
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: ["", ...inventoryItems.map((item) => item.id)],
              },
              valueFormatter: (params) =>
                params.value ? itemLabelById.get(String(params.value)) ?? "" : "—",
            },
            {
              headerName: "Тоо",
              field: "quantity",
              width: 96,
              editable: true,
              cellClass: "ag-right-aligned-cell font-mono",
              headerClass: "ag-right-aligned-header",
              valueParser: (params) => {
                const value = Number(String(params.newValue).replaceAll(",", ""));
                return Number.isFinite(value) && value > 0 ? value : undefined;
              },
              valueFormatter: (params) =>
                params.value ? String(params.value) : "",
            },
            {
              headerName: "Агуулах",
              field: "warehouseId",
              minWidth: 140,
              editable: true,
              cellEditor: "agSelectCellEditor",
              cellEditorParams: {
                values: ["", ...warehouses.map((warehouse) => warehouse.id)],
              },
              valueFormatter: (params) =>
                params.value
                  ? warehouseLabelById.get(String(params.value)) ?? ""
                  : "—",
            },
          ] as ColDef<LineRow>[])
        : []),
      {
        headerName: "",
        colId: "action",
        width: 44,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: LineRow }) => (
          <button
            type="button"
            title="Мөр устгах"
            className="text-lg text-[var(--ea-text-4)] hover:text-[var(--ea-danger)]"
            onClick={() =>
              onChange((prev) =>
                prev.length <= 1 ? prev : prev.filter((line) => line.id !== data?.id)
              )
            }
          >
            ×
          </button>
        ),
      },
    ],
    [
      activeSegIds,
      defaultSegments,
      onChange,
      segmentOptions,
      inventoryItems,
      warehouses,
      itemLabelById,
      warehouseLabelById,
    ]
  );

  return (
    <div className="space-y-2">
      <DataGridDynamic<LineRow>
        rowData={lines}
        columnDefs={columns}
        getRowId={(params) => params.data.id}
        onCellValueChanged={(event: CellValueChangedEvent<LineRow>) => {
          const field = event.colDef.field as keyof LineRow | undefined;
          if (!field) return;
          onChange((prev) =>
            prev.map((line) => {
              if (line.id !== event.data.id) return line;
              const next = { ...line, [field]: event.newValue };
              // АП-ийн бараатай мөр клирингийн дансанд суух ёстой (server
              // талд мөн шалгадаг) — бараа сонгонгуут дансыг автоматаар
              // 14000099 болгоно.
              if (
                field === "itemId" &&
                event.newValue &&
                documentType === "ap_bill"
              )
                next.account = buildSegCode(
                  { 3: CLEARING_ACCOUNT },
                  activeSegIds,
                  defaultSegments
                );
              return next;
            })
          );
        }}
        processDataFromClipboard={(params) =>
          (params.data ?? []).map((row) =>
            row.map((cell, index) =>
              index === 1
                ? normalizePastedAccount(cell, activeSegIds, defaultSegments)
                : cell
            )
          )
        }
        height={Math.min(360, 86 + lines.length * 38)}
        wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
        singleClickEdit
      />
      <div className="flex items-center justify-between text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange((prev) => [...prev, emptyLine(activeSegIds, defaultSegments)])
          }
        >
          + Мөр нэмэх
        </Button>
        <span className="font-mono font-semibold text-[var(--ea-text-1)]">
          Нийт: {fmtMnt(total)}
        </span>
      </div>
    </div>
  );
}

function ReportSection({
  title,
  rows,
  asOf,
  onAsOfChange,
  onRefresh,
}: {
  title: string;
  rows: ReportRow[];
  asOf: string;
  onAsOfChange: (value: string) => void;
  onRefresh: () => void;
}) {
  const columns = useMemo<ColDef<ReportRow>[]>(
    () => [
      { headerName: "Харилцагч", field: "counterpartyName", minWidth: 190, flex: 1 },
      { headerName: "Валют", field: "currency", width: 84 },
      {
        headerName: "Баримт",
        field: "documentCount",
        width: 100,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Нийт дүн",
        field: "totalAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлсөн",
        field: "paidAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "balance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл (MNT)",
        field: "baseBalance",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      ...([
        ["Хугацаа болоогүй", "currentAmount"],
        ["1–30 хоног", "days1To30"],
        ["31–60 хоног", "days31To60"],
        ["61–90 хоног", "days61To90"],
        ["90+ хоног", "daysOver90"],
      ] as const).map(([headerName, field]) => ({
        headerName,
        field,
        width: 145,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params: { value: unknown }) =>
          fmtMnt(Number(params.value ?? 0)),
      })),
    ],
    []
  );

  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">{title}</h2>
          <p className="mt-0.5 text-[11px] text-[var(--ea-text-3)]">
            Харилцагч ба валютаар ангилсан насжилт
          </p>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Тайлант огноо">
            <Input
              type="date"
              value={asOf}
              onChange={(event) => onAsOfChange(event.target.value)}
            />
          </Field>
          <Button variant="outline" onClick={onRefresh}>Шинэчлэх</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState text="Тайланд харуулах үлдэгдэл алга" />
      ) : (
        <DataGridDynamic<ReportRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => `${params.data.counterpartyName}:${params.data.currency}`}
          height={Math.min(480, 86 + rows.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}
    </section>
  );
}

function CounterpartyDialog({
  open,
  onOpenChange,
  form,
  setForm,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  isPending,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: {
    name: string;
    counterpartyType: "customer" | "supplier" | "both";
    registerNo: string;
    defaultReceivableAccountNumber: string;
    defaultPayableAccountNumber: string;
    defaultCurrency: string;
    paymentTermsDays: string;
  };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  isPending: boolean;
  error: string;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Харилцагч үүсгэх</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Нэр">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </Field>
          <Field label="Төрөл">
            <select
              className="ea-form-select"
              value={form.counterpartyType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  counterpartyType: event.target.value as "customer" | "supplier" | "both",
                }))
              }
            >
              <option value="both">Авлага/Өглөг</option>
              <option value="customer">Авлага</option>
              <option value="supplier">Өглөг</option>
            </select>
          </Field>
          <Field label="Регистр">
            <Input
              value={form.registerNo}
              onChange={(event) =>
                setForm((current) => ({ ...current, registerNo: event.target.value }))
              }
            />
          </Field>
          <Field label="Валют">
            <Input
              value={form.defaultCurrency}
              onChange={(event) =>
                setForm((current) => ({ ...current, defaultCurrency: event.target.value }))
              }
            />
          </Field>
          <Field label="Авлагын default данс">
            <AccountInput
              value={form.defaultReceivableAccountNumber}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  defaultReceivableAccountNumber: value,
                }))
              }
              activeSegIds={activeSegIds}
              segmentOptions={segmentOptions}
              defaultSegments={defaultSegments}
            />
          </Field>
          <Field label="Өглөгийн default данс">
            <AccountInput
              value={form.defaultPayableAccountNumber}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  defaultPayableAccountNumber: value,
                }))
              }
              activeSegIds={activeSegIds}
              segmentOptions={segmentOptions}
              defaultSegments={defaultSegments}
            />
          </Field>
          <Field label="Төлбөрийн нөхцөл /хоног/">
            <Input
              type="number"
              value={form.paymentTermsDays}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  paymentTermsDays: event.target.value,
                }))
              }
            />
          </Field>
        </div>
        {error && <p className="text-xs text-[var(--ea-danger)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={onSave} disabled={isPending}>
            Хадгалах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDialog({
  open,
  onOpenChange,
  form,
  setForm,
  counterparties,
  cpOptions,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  isPending,
  error,
  onSave,
  mode,
  inventoryItems,
  warehouses,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: {
    documentType: ArApDocumentType;
    documentNo: string;
    counterpartyId: string;
    date: string;
    dueDate: string;
    currency: string;
    exchangeRate: string;
    controlAccountNumber: string;
    description: string;
    lines: LineRow[];
  };
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  counterparties: CounterpartyView[];
  cpOptions: Array<{ value: string; label: string; hint?: string }>;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  isPending: boolean;
  error: string;
  onSave: (postNow: boolean) => void;
  mode: ArApMode;
}) {
  const selectedCounterparty = counterparties.find(
    (item) => item.id === form.counterpartyId
  );
  const transactionTotal = form.lines.reduce(
    (sum, line) => sum + Number(line.amount || 0),
    0
  );
  function defaultsFor(
    counterpartyId: string,
    documentType: ArApDocumentType,
    date: string
  ) {
    const counterparty = counterparties.find((item) => item.id === counterpartyId);
    if (!counterparty) return {};
    const control =
      documentType === "ar_invoice"
        ? counterparty.defaultReceivableAccountNumber
        : counterparty.defaultPayableAccountNumber;
    return {
      currency: counterparty.defaultCurrency,
      exchangeRate: counterparty.defaultCurrency === "MNT" ? "1" : "",
      dueDate: addDays(date, counterparty.paymentTermsDays),
      controlAccountNumber: control ?? "",
    };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "payable"
              ? "Өглөгийн нэхэмжлэх"
              : mode === "receivable"
                ? "Авлагын нэхэмжлэл"
                : "Авлага/өглөгийн баримт"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 lg:grid-cols-4">
          <Field label="Төрөл">
            <select
              className="ea-form-select"
              value={form.documentType}
              onChange={(event) =>
                setForm((current) => {
                  const documentType = event.target.value as ArApDocumentType;
                  return {
                    ...current,
                    documentType,
                    ...defaultsFor(current.counterpartyId, documentType, current.date),
                  };
                })
              }
            >
              {mode !== "payable" && (
                <option value="ar_invoice">Авлагын нэхэмжлэл</option>
              )}
              {mode !== "receivable" && (
                <option value="ap_bill">Өглөгийн нэхэмжлэх</option>
              )}
            </select>
          </Field>
          <Field label="Нэхэмжлэхийн дугаар">
            <Input
              value={form.documentNo}
              placeholder="Хоосон бол автоматаар үүснэ"
              maxLength={40}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  documentNo: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Харилцагч">
            <SearchableSelect
              value={form.counterpartyId}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  counterpartyId: value,
                  ...defaultsFor(value, current.documentType, current.date),
                }))
              }
              options={cpOptions}
              placeholder="Харилцагч сонгох..."
            />
          </Field>
          <Field label="Огноо">
            <Input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  date: event.target.value,
                  ...defaultsFor(
                    current.counterpartyId,
                    current.documentType,
                    event.target.value
                  ),
                }))
              }
            />
          </Field>
          <Field label="Төлөх огноо">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(event) =>
                setForm((current) => ({ ...current, dueDate: event.target.value }))
              }
            />
          </Field>
          <div className="lg:col-span-2">
            <Field label="Хяналтын данс">
              <AccountInput
                value={form.controlAccountNumber}
                onChange={(value) =>
                  setForm((current) => ({ ...current, controlAccountNumber: value }))
                }
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
                placeholder={
                  form.documentType === "ar_invoice"
                    ? "Авлагын данс..."
                    : "Өглөгийн данс..."
                }
              />
            </Field>
          </div>
          <Field label="Валют">
            <Input
              value={form.currency}
              onChange={(event) =>
                setForm((current) => {
                  const currency = event.target.value.toUpperCase();
                  return {
                    ...current,
                    currency,
                    exchangeRate: currency === "MNT" ? "1" : current.exchangeRate,
                  };
                })
              }
              maxLength={3}
            />
          </Field>
          {form.currency !== "MNT" && (
            <Field label={`${form.currency || "Валют"}/MNT ханш`}>
              <Input
                type="number"
                min="0.00000001"
                step="0.00000001"
                value={form.exchangeRate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    exchangeRate: event.target.value,
                  }))
                }
              />
            </Field>
          )}
          {form.currency !== "MNT" && Number(form.exchangeRate) > 0 && (
            <div className="flex items-end pb-2 text-xs text-[var(--ea-text-3)]">
              GL дүн: {fmtMnt(transactionTotal * Number(form.exchangeRate))} MNT
            </div>
          )}
          <div className="lg:col-span-4">
            <Field label="Утга">
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder={
                  selectedCounterparty
                    ? `${selectedCounterparty.name} - тооцооны баримт`
                    : "Баримтын тайлбар"
                }
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Мөрүүд
          </div>
          <ArApLinesGrid
            lines={form.lines}
            onChange={(updater) =>
              setForm((current) => ({ ...current, lines: updater(current.lines) }))
            }
            activeSegIds={activeSegIds}
            segmentOptions={segmentOptions}
            defaultSegments={defaultSegments}
            inventoryItems={inventoryItems}
            warehouses={warehouses}
            documentType={form.documentType}
          />
        </div>

        {error && <p className="text-xs text-[var(--ea-danger)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button variant="outline" onClick={() => onSave(false)} disabled={isPending}>
            Ноорог
          </Button>
          <Button onClick={() => onSave(true)} disabled={isPending}>
            GL-д бичих
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function CompactDocumentList({
  title,
  rows,
  asOf,
  emptyText,
}: {
  title: string;
  rows: ArApDocumentView[];
  asOf: string;
  emptyText: string;
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">{title}</h2>
      <div className="divide-y divide-[var(--ea-border)] border-y border-[var(--ea-border)]">
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-[var(--ea-text-4)]">
            {emptyText}
          </div>
        ) : (
          rows.map((doc) => {
            const overdue = doc.dueDate < asOf && doc.balance > 0;
            return (
              <div
                key={doc.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-1 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ea-text-1)]">
                    {doc.counterpartyName}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[var(--ea-text-3)]">
                    <span className="font-mono">{doc.documentNo}</span>
                    <span>{doc.dueDate}</span>
                    {overdue && (
                      <span className="font-medium text-[var(--ea-danger-fg)]">
                        Хугацаа хэтэрсэн
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-semibold text-[var(--ea-text-1)]">
                    {fmtMnt(doc.balance)} {doc.currency}
                  </div>
                  {(doc.status === "posted" || doc.status === "partially_paid") && (
                    <Link
                      href={`/cash/transactions?arap=${doc.id}`}
                      className="text-[11px] font-medium text-[var(--ea-primary)] hover:underline"
                    >
                      Мөнгөн хөрөнгөөр хаах
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function OnboardingState({
  mode,
  onCounterparty,
}: {
  mode: ArApMode;
  onCounterparty: () => void;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center border-y border-[var(--ea-border)] px-4 text-center">
      <Building2 size={22} className="text-[var(--ea-text-3)]" />
      <div className="mt-3 text-sm font-medium text-[var(--ea-text-1)]">
        {mode === "payable" ? "Нийлүүлэгч бүртгээгүй байна" : "Харилцагч бүртгээгүй байна"}
      </div>
      <Button className="mt-4" onClick={onCounterparty}>
        <Plus />
        {mode === "payable" ? "Нийлүүлэгч нэмэх" : "Харилцагч нэмэх"}
      </Button>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number }>;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 border-b border-r border-[var(--ea-border)] px-4 py-4 last:border-r-0 lg:border-b-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--ea-bg-2)] text-[var(--ea-primary)]">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-[var(--ea-text-3)]">{label}</div>
        <div className="mt-0.5 truncate font-mono text-base font-semibold text-[var(--ea-text-1)]">
          {value}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-36 flex-1 flex-col items-center justify-center rounded-md border border-[var(--ea-border)] px-4 text-center text-sm text-[var(--ea-text-4)]">
      <span>{text}</span>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
          <Plus />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
