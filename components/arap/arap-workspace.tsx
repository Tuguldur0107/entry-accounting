"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useMemo, useRef, useState, useTransition } from "react";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";
import { feedback } from "@/lib/ui/feedback";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useDirtyClose } from "@/lib/ui/use-dirty-close";

import { AccountInput } from "@/components/account/account-input";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { EmptyState } from "@/components/ui/empty-state";
import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { SavedViewsMenu } from "@/components/datagrid/SavedViewsMenu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import {
  createCounterparty,
  deleteArApDocument,
  deleteCounterparty,
  postArApDocument,
  settleArApOffset,
  toggleCounterparty,
  updateCounterparty,
} from "@/lib/actions/arap";
import {
  DEFAULT_COUNTERPARTY_ENTITY_KIND,
  SYSTEM_ENTITY_KINDS,
  baseKindOf,
  registerNoLabel,
  registerNoMismatch,
  registerNoPlaceholder,
  type EntityKindOption,
} from "@/lib/arap/counterparty-kind";
import { EntityKindsDialog } from "@/components/arap/entity-kinds-dialog";
import type { ArApDocumentView, CounterpartyView } from "@/lib/arap/types";
import { downloadWorkbook } from "@/lib/excel/core";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { buildSegCode, fmtAccountDisplay } from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";
import { openArapDocPanel, openCashNewPanel } from "@/lib/store/panel-store";
import { currentDocumentDate } from "@/lib/periods/document-date";
import { arapBalanceSummary, arapKpis } from "@/lib/arap/kpis";
import { ArapBalanceHero } from "@/components/arap/arap-balance-hero";
import { MobileCardList, useIsMobileViewport } from "@/components/datagrid/mobile-card-list";
import { col } from "@/lib/grid/columnTypes";

type Focus = "dashboard" | "counterparties" | "documents" | "reports";
type ArApMode = "combined" | "receivable" | "payable";
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

interface Props {
  focus?: Focus;
  mode?: ArApMode;
  counterparties: CounterpartyView[];
  /** Харилцагчийн төрлүүд (систем + байгууллагын нэмсэн). */
  entityKinds?: EntityKindOption[];
  documents: ArApDocumentView[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  defaultAccountNumbers: {
    receivable: string;
    payable: string;
  };
  reportAsOf?: string;
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
    counterpartyType: "both",
    documentTitle: "Авлага, өглөгийн баримт",
    reportTitle: "Авлага, өглөгийн тайлан",
    createLabel: "Баримт үүсгэх",
    emptyDocuments: "Баримт бүртгээгүй байна",
  },
  receivable: {
    title: "Авлага",
    description: "Харилцагчийн авлага, нэхэмжлэл, төлөлтийн үлдэгдэл",
    counterpartyType: "customer",
    documentTitle: "Авлагын нэхэмжлэл",
    reportTitle: "Авлагын тайлан",
    createLabel: "Нэхэмжлэл үүсгэх",
    emptyDocuments: "Авлагын нэхэмжлэл бүртгээгүй байна",
  },
  payable: {
    title: "Өглөг",
    description: "Нийлүүлэгчийн өглөг, нэхэмжлэх, төлөлтийн үлдэгдэл",
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

export function ArApWorkspace({
  focus = "dashboard",
  mode = "combined",
  counterparties,
  entityKinds = SYSTEM_ENTITY_KINDS as EntityKindOption[],
  documents,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  defaultAccountNumbers,
  reportAsOf = today(),
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const config = MODE_CONFIG[mode];

  // eBarimt файл → сервер задаргаа → АП НООРОГ; амжилтад панель нээнэ.
  async function importEbarimtFile(file: File) {
    setEbarimtBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/arap/ebarimt", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        id?: string | null;
        title?: string | null;
        dedup?: boolean;
        error?: string;
      };
      if (!response.ok || result.error) {
        toast.error(result.error || "eBarimt уншиж чадсангүй");
        return;
      }
      toast.success(
        result.dedup
          ? "Энэ eBarimt өмнө нь орсон байна — байгаа баримтыг нээлээ"
          : `АП ноорог үүслээ${result.title ? `: ${result.title}` : ""}`
      );
      if (result.id)
        openArapDocPanel({ documentId: result.id, mode: "payable" });
      router.refresh();
    } catch {
      toast.error("eBarimt уншиж чадсангүй — дахин оролдоно уу");
    } finally {
      setEbarimtBusy(false);
      if (ebarimtFileRef.current) ebarimtFileRef.current.value = "";
    }
  }
// П17 — баримтын жагсаалтын хадгалсан харагдац.
  const documentsGridRef = useRef<DataGridHandle>(null);
  // П24 — eBarimt/PDF-ээс АП ноорог (зөвхөн payable горимд).
  const ebarimtFileRef = useRef<HTMLInputElement>(null);
  const [ebarimtBusy, setEbarimtBusy] = useState(false);
    const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [counterpartyOpen, setCounterpartyOpen] = useState(false);
  const [reportDate, setReportDate] = useState(reportAsOf);
  // null = шинээр үүсгэх; id = тухайн харилцагчийг засах.
  const [kindsOpen, setKindsOpen] = useState(false);
  const [editingCounterpartyId, setEditingCounterpartyId] = useState<
    string | null
  >(null);
  // АР↔АП суутган тооцооны dialog — аль баримтын мөрөөс нээснийг хадгална.
  const [offsetSource, setOffsetSource] = useState<ArApDocumentView | null>(
    null
  );
  function emptyCounterpartyForm() {
    return {
      name: "",
      code: "",
      counterpartyType: config.counterpartyType,
      entityKind: DEFAULT_COUNTERPARTY_ENTITY_KIND as string,
      registerNo: "",
      defaultReceivableAccountNumber: defaultAccountNumbers.receivable
        ? buildSegCode({ 3: defaultAccountNumbers.receivable }, activeSegIds, defaultSegments)
        : "",
      defaultPayableAccountNumber: defaultAccountNumbers.payable
        ? buildSegCode({ 3: defaultAccountNumbers.payable }, activeSegIds, defaultSegments)
        : "",
      defaultCurrency: "MNT",
      paymentTermsDays: "30",
      email: "",
      phone: "",
      address: "",
      contactPerson: "",
      bankName: "",
      bankAccountNo: "",
      customerGroup: "",
      creditLimit: "",
    };
  }
  const [counterpartyForm, setCounterpartyForm] = useState(emptyCounterpartyForm);
  // Харилцагчийн dialog нээгдэх агшны snapshot (JSON) — хаах үед үүнтэй
  // харьцуулж "хадгалаагүй өөрчлөлт" эсэхийг мэдэрнэ.
  const [counterpartyBaseline, setCounterpartyBaseline] = useState("");
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

  // Ноорог нь өр биш — KPI зөвхөн батлагдсан баримтаар (ENT-017).
  const { draftCount, draftAmount } = arapKpis(filteredDocuments, reportAsOf);
  const arBalanceSummary = useMemo(
    () => arapBalanceSummary(filteredDocuments, reportAsOf, "ar_invoice"),
    [filteredDocuments, reportAsOf]
  );
  const apBalanceSummary = useMemo(
    () => arapBalanceSummary(filteredDocuments, reportAsOf, "ap_bill"),
    [filteredDocuments, reportAsOf]
  );
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
      {
        headerName: "Код",
        field: "code",
        width: 110,
        cellClass: "font-mono text-xs",
        headerTooltip: "Харилцагчийн код — РД-ээс тусдаа, давтагдашгүй",
      },
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      {
        headerName: "Төрөл",
        field: "entityKind",
        width: 130,
        valueGetter: (params) => params.data?.entityKindName ?? "",
      },
      {
        headerName: "Тооцоо",
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
        width: 200,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: CounterpartyView }) =>
          data ? (
            <div className="flex h-full items-center justify-end gap-3">
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
                onClick={() => openEditCounterparty(data)}
              >
                Засах
              </button>
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-text-3)] hover:underline"
                onClick={() =>
                  startTransition(async () => {
                    try {
                      const r = await toggleCounterparty(
                        data.id,
                        !data.isActive
                      );
                      if (r.error !== undefined) {
                        toast.error(r.error);
                        return;
                      }
                      toast.success("Харилцагчийн төлөв шинэчлэгдлээ");
                    } catch (caught) {
                      toast.error(caught instanceof Error ? caught.message : "Алдаа гарлаа");
                    }
                  })
                }
              >
                {data.isActive ? "Идэвхгүй" : "Идэвхтэй"}
              </button>
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-danger-fg)] hover:underline"
                onClick={() => removeCounterparty(data)}
              >
                Устгах
              </button>
            </div>
          ) : null,
      },
    ],
    // openEditCounterparty / removeCounterparty нь зөвхөн тогтвортой
    // setter, action ашигладаг тул хуучирсан хувилбар нь ч зөв ажиллана.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // Төлөв — зүүн талд бэхэлсэн дүрс (lib/status.ts, UI гайдын карт 1).
      col<ArApDocumentView>({ eaType: "status", field: "status" }),
      {
        headerName: "Илгээлт",
        field: "sendStatus",
        width: 110,
        valueGetter: (params) =>
          params.data?.sendStatus === "viewed"
            ? "Үзсэн"
            : params.data?.sendStatus === "sent"
              ? "Илгээсэн"
              : "",
        cellClass: (params) =>
          cn(
            "text-xs",
            params.data?.sendStatus === "viewed"
              ? "text-[var(--ea-success-fg)]"
              : "text-[var(--ea-text-3)]"
          ),
      },
      {
        headerName: "Үйлдэл",
        colId: "payment",
        width: 235,
        sortable: false,
        filter: false,
        cellRenderer: ({ data }: { data?: ArApDocumentView }) =>
          data?.status === "posted" || data?.status === "partially_paid" ? (
            // Мөнгөн хөрөнгийн хуудас руу үсрэхгүй — төлөлтийн панель нээгээд
            // хэрэглэгч АР/АП контекстдээ үлдэнэ.
            <span className="flex items-center gap-2.5">
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
                onClick={() => openCashNewPanel({ arApDocumentId: data.id })}
              >
                Мөнгөн хөрөнгөөр хаах
              </button>
              <button
                type="button"
                title="Нэг харилцагчийн авлага, өглөгийг хооронд нь хаана (суутган тооцоо)"
                className="text-xs font-medium text-[var(--ea-primary)] hover:underline"
                onClick={() => setOffsetSource(data)}
              >
                Тооцоогоор
              </button>
              {data.status === "posted" && (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--ea-danger-fg)] hover:underline"
                  onClick={() => deleteDraftDocument(data)}
                >
                  Устгах
                </button>
              )}
            </span>
          ) : data?.status === "draft" ? (
            <span className="flex items-center gap-2.5">
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-success-fg)] hover:underline"
                onClick={() => postDraftDocument(data)}
              >
                Батлах
              </button>
              <button
                type="button"
                className="text-xs font-medium text-[var(--ea-danger-fg)] hover:underline"
                onClick={() => deleteDraftDocument(data)}
              >
                Устгах
              </button>
            </span>
          ) : (
            <span className="text-xs text-[var(--ea-text-4)]">—</span>
          ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Dialog нээгдэх агшинд snapshot авна — бөглөж эхэлснийг үүнтэй
  // харьцуулж Esc/overlay дээр "гарах уу?" асууна.
  function openCounterpartyDialog() {
    const base = emptyCounterpartyForm();
    setEditingCounterpartyId(null);
    setCounterpartyForm(base);
    setCounterpartyBaseline(JSON.stringify(base));
    setError("");
    setCounterpartyOpen(true);
  }

  /** Бүртгэгдсэн харилцагчийг засах — форм нь одоогийн утгуудаар бөглөгдөнө. */
  function openEditCounterparty(counterparty: CounterpartyView) {
    const filled = {
      name: counterparty.name,
      counterpartyType: (["customer", "supplier", "both"].includes(
        counterparty.counterpartyType
      )
        ? counterparty.counterpartyType
        : "both") as "customer" | "supplier" | "both",
      entityKind: counterparty.entityKind || DEFAULT_COUNTERPARTY_ENTITY_KIND,
      code: counterparty.code ?? "",
      registerNo: counterparty.registerNo ?? "",
      defaultReceivableAccountNumber:
        counterparty.defaultReceivableAccountNumber ?? "",
      defaultPayableAccountNumber:
        counterparty.defaultPayableAccountNumber ?? "",
      defaultCurrency: counterparty.defaultCurrency,
      paymentTermsDays: String(counterparty.paymentTermsDays),
      email: counterparty.email ?? "",
      phone: counterparty.phone ?? "",
      address: counterparty.address ?? "",
      contactPerson: counterparty.contactPerson ?? "",
      bankName: counterparty.bankName ?? "",
      bankAccountNo: counterparty.bankAccountNo ?? "",
      customerGroup: counterparty.customerGroup ?? "",
      creditLimit: counterparty.creditLimit == null ? "" : String(counterparty.creditLimit),
    };
    setEditingCounterpartyId(counterparty.id);
    setCounterpartyForm(filled);
    setCounterpartyBaseline(JSON.stringify(filled));
    setError("");
    setCounterpartyOpen(true);
  }

  /** Харилцагч устгах — баримттай бол action тодорхой шалтгаанаар татгалзана. */
  function removeCounterparty(counterparty: CounterpartyView) {
    void confirm({
      title: "Харилцагч устгах",
      description: `${counterparty.name} харилцагчийг устгах уу? Зөвхөн АР/АП баримтгүй харилцагч устгагдана — түүхтэй бол идэвхгүй болгохыг зөвлөнө.`,
      confirmText: "Устгах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        const result = await deleteCounterparty(counterparty.id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`${counterparty.name} устгагдлаа`);
        router.refresh();
      });
    });
  }

  function saveCounterparty() {
    setError("");
    startTransition(async () => {
      try {
        const payload = {
          ...counterpartyForm,
          paymentTermsDays: Number(counterpartyForm.paymentTermsDays) || 0,
          creditLimit:
            counterpartyForm.creditLimit.trim() === ""
              ? null
              : Number(counterpartyForm.creditLimit),
        };
        // Server action нь алдааг УТГААР буцаана (production дээр шидсэн
        // алдаа React #441 болж нуугддаг — lib/action-result.ts).
        const result = editingCounterpartyId
          ? await updateCounterparty(editingCounterpartyId, payload)
          : await createCounterparty(payload);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success(
          editingCounterpartyId ? "Харилцагч шинэчлэгдлээ" : "Харилцагч үүслээ"
        );
        setCounterpartyOpen(false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  // Хадгалалт нь setCounterpartyOpen(false)-ийг шууд дуудна — тиймээс
  // амжилттай хадгалсны дараа "гарах уу?" асуулт гарахгүй.
  const guardCounterpartyClose = useDirtyClose({
    dirty:
      counterpartyOpen &&
      JSON.stringify(counterpartyForm) !== counterpartyBaseline,
    confirm,
    setOpen: setCounterpartyOpen,
  });

  /** АР↔АП суутган тооцоо — dialog-оос баталгаажсан утгаар action дуудна. */
  function submitOffset(
    source: ArApDocumentView,
    input: { targetId: string; amount: number; date: string }
  ) {
    const sourceIsAr = source.documentType === "ar_invoice";
    startTransition(async () => {
      const result = await settleArApOffset({
        arDocumentId: sourceIsAr ? source.id : input.targetId,
        apDocumentId: sourceIsAr ? input.targetId : source.id,
        amount: input.amount,
        date: input.date,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      feedback.posted("Суутган тооцоо хийгдэж GL-д бичигдлээ");
      setOffsetSource(null);
      router.refresh();
    });
  }

  async function postDraftDocument(document: ArApDocumentView) {
    const ok = await confirm({
      title: "Баримт батлах",
      description: `${document.documentNo} ноорог баримтыг баталж GL журнал үүсгэх үү? Бараатай мөрүүд нь Бараа материалд тоо хэмжээний ноорог үүсгэнэ.`,
      confirmText: "Батлах",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await postArApDocument(document.id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        router.refresh();
        feedback.posted("Баримт батлагдаж GL-д бичигдлээ");
      } catch {
        toast.error("Батлах амжилтгүй");
      }
    });
  }

  async function deleteDraftDocument(document: ArApDocumentView) {
    const posted = document.status !== "draft";
    const ok = await confirm({
      title: posted ? "Баримт устгах" : "Ноорог устгах",
      description: posted
        ? `${document.documentNo} · ${document.counterpartyName} БАТЛАГДСАН нэхэмжлэхийг GL журналтай нь хамт бүрмөсөн устгах уу? (Төлөлттэй бол татгалзана — эхлээд төлөлтийн баримтыг устгана.)`
        : `${document.documentNo} · ${document.counterpartyName} ноорог баримтыг устгах уу? Мөрүүд нь хамт устана.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await deleteArApDocument(document.id);
        if (result.error) {
          toast.error(result.error);
          return;
        }
        router.refresh();
        toast.success("Ноорог баримт устгагдлаа");
      } catch {
        toast.error("Устгах амжилтгүй");
      }
    });
  }

  const isMobile = useIsMobileViewport();
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
          {focus === "counterparties" && (
            <Button
              variant="outline"
              onClick={() => setKindsOpen(true)}
              title="Харилцагчийн төрөл нэмэх, засах (Байгууллага, Хувь хүн + өөрийн)"
            >
              <Icon name="settings" />
              Төрөл
            </Button>
          )}
          {(focus === "dashboard" || focus === "counterparties") && (
            <Button variant="outline" onClick={openCounterpartyDialog}>
              <Icon name="add" />
              Харилцагч
            </Button>
          )}
          {mode === "payable" &&
            (focus === "dashboard" || focus === "documents") && (
              <>
                <input
                  ref={ebarimtFileRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importEbarimtFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={ebarimtBusy}
                  onClick={() => ebarimtFileRef.current?.click()}
                  title="eBarimt/PDF баримтаас АП нэхэмжлэхийн ноорог үүсгэнэ"
                >
                  <Icon
                    name={ebarimtBusy ? "loading" : "upload"}
                    className={ebarimtBusy ? "animate-spin" : undefined}
                  />
                  {ebarimtBusy ? "Уншиж байна…" : "eBarimt импорт"}
                </Button>
              </>
            )}
          {(focus === "dashboard" || focus === "documents") && (
            <Button onClick={() => openArapDocPanel({ mode })}>
              <Icon name="addDocument" />
              {config.createLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Нэг гол тоо + насжилтын зурвас (UI гайдын карт 6) — ноорог нь өр биш. */}
      <section className="flex flex-col divide-y divide-[var(--ea-border)] border-y border-[var(--ea-border)] lg:flex-row lg:divide-x lg:divide-y-0">
        {mode !== "payable" && (
          <ArapBalanceHero
            title="Авлага"
            summary={arBalanceSummary}
            reportHref="/receivables/reports"
            draftCount={mode === "receivable" ? draftCount : undefined}
            draftAmount={draftAmount}
          />
        )}
        {mode !== "receivable" && (
          <ArapBalanceHero
            title="Өглөг"
            summary={apBalanceSummary}
            reportHref="/payables/reports"
            draftCount={draftCount}
            draftAmount={draftAmount}
          />
        )}
      </section>

      {focus === "dashboard" &&
        (filteredDocuments.length === 0 && filteredCounterparties.length === 0 ? (
          <OnboardingState mode={mode} onCounterparty={openCounterpartyDialog} />
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
            <div className="flex items-center gap-3">
              <div className="text-[11px] text-[var(--ea-text-3)]">
                Төлөлт нь Мөнгөн хөрөнгийн модулиар хаагдана
              </div>
              <SavedViewsMenu
                surfaceId={mode === "payable" ? "ap-documents" : "ar-documents"}
                gridRef={documentsGridRef}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportDocuments(filteredDocuments, activeSegIds)}
              >
                <Icon name="download" size="sm" />
                Excel экспорт
              </Button>
            </div>
          </div>
          {filteredDocuments.length === 0 ? (
            <EmptyState
              icon="document"
              title={config.emptyDocuments}
              actions={[
                { label: config.createLabel, onClick: () => openArapDocPanel({ mode }), icon: "add", primary: true },
              ]}
            />
          ) : isMobile ? (
            // Утсан дээр карт (UI гайдын карт 12).
            <MobileCardList
              rows={filteredDocuments}
              ariaLabel={config.documentTitle}
              toCard={(doc) => ({
                id: doc.id,
                status: doc.status,
                corner: doc.date.replaceAll("-", "."),
                title: doc.counterpartyName,
                meta: `${doc.documentNo} · төлөх ${doc.dueDate.replaceAll("-", ".")}`,
                amount: `${fmtMnt(doc.balance)} ${doc.currency}`,
              })}
              onOpen={(doc) =>
                openArapDocPanel({
                  documentId: doc.id,
                  mode,
                  title: `${doc.documentNo} · ${doc.counterpartyName}`,
                  navIds: filteredDocuments.map((entry) => entry.id),
                })
              }
            />
          ) : (
            <DataGridDynamic<ArApDocumentView>
              ref={documentsGridRef}
              rowData={filteredDocuments}
              columnDefs={documentColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
              onRowDoubleClicked={(event) => {
                // Нүдэн доторх товч/линк (Батлах, Мөнгөн хөрөнгөөр хаах)
                // дарахад баримтын панель давхар нээгдэхгүй.
                const target = event.event?.target as HTMLElement | null;
                if (target?.closest("button,a")) return;
                if (event.data)
                  openArapDocPanel({
                    documentId: event.data.id,
                    mode,
                    title: `${event.data.documentNo} · ${event.data.counterpartyName}`,
                    // Панель дотроос жагсаалтын өмнөх/дараагийн баримт руу
                    // шилжих нав — одоогийн шүүлтийн дарааллаар.
                    navIds: filteredDocuments.map((doc) => doc.id),
                  });
              }}
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
              icon="document"
              title="Харилцагч үүсгээгүй байна"
              actions={[{ label: "Харилцагч нэмэх", onClick: openCounterpartyDialog, icon: "add", primary: true }]}
            />
          ) : (
            <DataGridDynamic<CounterpartyView>
              rowData={filteredCounterparties}
              columnDefs={counterpartyColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
              onRowDoubleClicked={(event) => {
                const target = event.event?.target as HTMLElement | null;
                if (target?.closest("button,a")) return;
                if (event.data) openEditCounterparty(event.data);
              }}
            />
          )}
        </section>
      )}

      {offsetSource && (
        <OffsetDialog
          key={offsetSource.id}
          source={offsetSource}
          documents={documents}
          isPending={isPending}
          onOpenChange={(open) => {
            if (!open) setOffsetSource(null);
          }}
          onSubmit={(input) => submitOffset(offsetSource, input)}
        />
      )}

      <CounterpartyDialog
        open={counterpartyOpen}
        onOpenChange={guardCounterpartyClose}
        title={editingCounterpartyId ? "Харилцагч засах" : "Харилцагч үүсгэх"}
        form={counterpartyForm}
        setForm={setCounterpartyForm}
        entityKinds={entityKinds}
        activeSegIds={activeSegIds}
        segmentOptions={segmentOptions}
        defaultSegments={defaultSegments}
        isPending={isPending}
        error={error}
        onSave={saveCounterparty}
      />
      <EntityKindsDialog
        open={kindsOpen}
        onOpenChange={setKindsOpen}
        kinds={entityKinds}
        counterparties={counterparties}
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

/** Шүүгдсэн баримтуудыг Excel болгож татуулна (стандарт экспорт). */
async function exportDocuments(
  documents: ArApDocumentView[],
  activeSegIds: number[]
) {
  if (documents.length === 0) {
    toast.error("Экспортлох баримт алга");
    return;
  }
  await downloadWorkbook({
    slug: "entry-arap-documents",
    sheetName: "Баримтууд",
    columns: [
      { header: "Дугаар", width: 16 },
      { header: "Төрөл", width: 20 },
      { header: "Харилцагч", width: 26 },
      { header: "Огноо", width: 12 },
      { header: "Төлөх огноо", width: 12 },
      { header: "Валют", width: 8 },
      { header: "Хяналтын данс", width: 20 },
      { header: "Журналын нэр", width: 30 },
      { header: "Нийт дүн", width: 16, kind: "number" },
      { header: "Төлсөн", width: 16, kind: "number" },
      { header: "Үлдэгдэл", width: 16, kind: "number" },
      { header: "Статус", width: 16 },
    ],
    rows: documents.map((doc) => [
      doc.documentNo,
      doc.documentType === "ar_invoice"
        ? "Авлагын нэхэмжлэл"
        : "Өглөгийн нэхэмжлэх",
      doc.counterpartyName,
      doc.date,
      doc.dueDate,
      doc.currency,
      fmtAccountDisplay(doc.controlAccountNumber, activeSegIds),
      doc.description,
      doc.totalAmount,
      doc.paidAmount,
      doc.balance,
      STATUS_LABELS[doc.status] ?? doc.status,
    ]),
  });
}

/**
 * Насжилт = ҮЛДЭГДЭЛТЭЙ баримтууд asOf-оор. Бүрэн төлөгдсөн баримт орохгүй —
 * ажлын багц нь тайлант үе + нээлттэй баримт (lib/arap/load-data.ts) тул
 * төлөгдсөнийг тоолбол тайлант үеийн сонголтоос хамаарч зөрөх байсан.
 */
function buildReportRows(documents: ArApDocumentView[], asOf: string): ReportRow[] {
  const rows = new Map<string, ReportRow>();
  for (const doc of documents) {
    // Ноорог нь насжилтад орохгүй (ENT-017); төлөгдсөнийг огноогоор нь
    // (asOf-ийн дараа төлсөн бол тэр өдөр нээлттэй байсан) тооцно.
    if (doc.status === "reversed" || doc.status === "draft" || doc.date > asOf) continue;
    if (Math.abs(doc.balance) < 0.005) continue;
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
          <FormField label="Тайлант огноо">
            <Input
              type="date"
              value={asOf}
              onChange={(event) => onAsOfChange(event.target.value)}
            />
          </FormField>
          <Button variant="outline" onClick={onRefresh}>Шинэчлэх</Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="document" title="Тайланд харуулах үлдэгдэл алга" />
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

/**
 * АР↔АП суутган тооцооны dialog. Эх баримтын эсрэг төрлийн, нэг харилцагчийн,
 * нээлттэй MNT баримтуудаас сонгож хооронд нь хаана. GL: Дт өглөгийн данс /
 * Кт авлагын данс — НӨАТ-д нөлөөгүй.
 */
function OffsetDialog({
  source,
  documents,
  isPending,
  onOpenChange,
  onSubmit,
}: {
  source: ArApDocumentView;
  documents: ArApDocumentView[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { targetId: string; amount: number; date: string }) => void;
}) {
  const sourceIsAr = source.documentType === "ar_invoice";
  const candidates = documents.filter(
    (doc) =>
      doc.documentType === (sourceIsAr ? "ap_bill" : "ar_invoice") &&
      doc.counterpartyId === source.counterpartyId &&
      (doc.status === "posted" || doc.status === "partially_paid") &&
      doc.currency === "MNT" &&
      doc.balance > 0.005
  );
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
  const target = candidates.find((doc) => doc.id === targetId);
  const [amountText, setAmountText] = useState(() =>
    candidates[0] ? String(Math.min(source.balance, candidates[0].balance)) : ""
  );
  const [date, setDate] = useState(currentDocumentDate);
  const amount = Number(amountText);
  const amountValid =
    Number.isFinite(amount) &&
    amount > 0 &&
    !!target &&
    amount <= source.balance + 0.005 &&
    amount <= target.balance + 0.005;

  const sourceNotOffsettable = source.currency !== "MNT";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Тооцоогоор хаах — суутган тооцоо</DialogTitle>
        </DialogHeader>
        {sourceNotOffsettable ? (
          <p className="text-sm text-[var(--ea-text-3)]">
            Гадаад валютын баримтын суутган тооцоо одоогоор дэмжигдэхгүй —
            зөвхөн MNT баримтууд хоорондоо хаагдана.
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-[var(--ea-text-3)]">
            {source.counterpartyName} харилцагчид хаах боломжтой нээлттэй{" "}
            {sourceIsAr ? "өглөгийн нэхэмжлэх" : "авлагын нэхэмжлэл"} алга.
            Хоёр тал хоёулаа батлагдсан, үлдэгдэлтэй, MNT байх шаардлагатай.
          </p>
        ) : (
          <div className="space-y-3">
            <FormField label={sourceIsAr ? "Авлагын нэхэмжлэл" : "Өглөгийн нэхэмжлэх"}>
              <div className="rounded-md border border-[var(--ea-border)] px-3 py-2 text-sm">
                <span className="font-mono text-xs">{source.documentNo}</span>
                <span className="ml-2 text-xs text-[var(--ea-text-3)]">
                  үлдэгдэл {fmtMnt(source.balance)}
                </span>
              </div>
            </FormField>
            <FormField
              label={sourceIsAr ? "Хаах өглөгийн нэхэмжлэх" : "Хаах авлагын нэхэмжлэл"}
            >
              <select
                className="ea-form-select"
                value={targetId}
                onChange={(event) => {
                  const next = candidates.find(
                    (doc) => doc.id === event.target.value
                  );
                  setTargetId(event.target.value);
                  if (next)
                    setAmountText(
                      String(Math.min(source.balance, next.balance))
                    );
                }}
              >
                {candidates.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.documentNo} · үлдэгдэл {fmtMnt(doc.balance)}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Дүн (₮)">
                <Input
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                />
              </FormField>
              <FormField label="Тооцооны актын огноо">
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </FormField>
            </div>
            <p className="text-xs text-[var(--ea-text-3)]">
              GL: Дт өглөгийн хяналтын данс / Кт авлагын хяналтын данс —
              НӨАТ-д нөлөөгүй. Хоёр талын үлдэгдэл энэ дүнгээр хаагдана.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button
            disabled={isPending || !amountValid || sourceNotOffsettable}
            onClick={() =>
              target &&
              onSubmit({ targetId: target.id, amount, date })
            }
          >
            Хаах
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CounterpartyDialog({
  open,
  onOpenChange,
  title,
  form,
  setForm,
  entityKinds,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  isPending,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: {
    name: string;
    code: string;
    counterpartyType: "customer" | "supplier" | "both";
    /** Төрлийн код — систем эсвэл нэмсэн (kind_<n>). */
    entityKind: string;
    registerNo: string;
    defaultReceivableAccountNumber: string;
    defaultPayableAccountNumber: string;
    defaultCurrency: string;
    paymentTermsDays: string;
    email: string;
    phone: string;
    address: string;
    contactPerson: string;
    bankName: string;
    bankAccountNo: string;
    customerGroup: string;
    creditLimit: string;
  };
  setForm: React.Dispatch<React.SetStateAction<typeof form>>;
  entityKinds: EntityKindOption[];
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  isPending: boolean;
  error: string;
  onSave: () => void;
}) {
  // Бизнесийн логик (регистрийн шошго, шалгалт) СУУРЬ төрлөөр.
  const baseKind = baseKindOf(form.entityKind, entityKinds);
  // Идэвхгүй болсон төрлийг зөвхөн одоогийн утга байвал харуулна.
  const kindOptions = entityKinds.filter((kind) => kind.isActive || kind.code === form.entityKind);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Нэр">
            <Input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </FormField>
          <FormField label="Төрөл">
            <select
              className="ea-form-select"
              value={form.entityKind}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  entityKind: event.target.value,
                }))
              }
            >
              {kindOptions.map((kind) => (
                <option key={kind.code} value={kind.code}>
                  {kind.name}
                  {kind.isActive ? "" : " (идэвхгүй)"}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Тооцоо">
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
          </FormField>
          <FormField label="Код">
            <Input
              value={form.code}
              placeholder="Ж: 10001 (заавал биш, давтагдахгүй)"
              onChange={(event) =>
                setForm((current) => ({ ...current, code: event.target.value }))
              }
            />
          </FormField>
          <FormField
            label={registerNoLabel(baseKind)}
            hint={registerNoMismatch(baseKind, form.registerNo) ?? undefined}
          >
            <Input
              value={form.registerNo}
              placeholder={registerNoPlaceholder(baseKind)}
              onChange={(event) =>
                setForm((current) => ({ ...current, registerNo: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Валют">
            <Input
              value={form.defaultCurrency}
              onChange={(event) =>
                setForm((current) => ({ ...current, defaultCurrency: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Авлагын default данс">
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
          </FormField>
          <FormField label="Өглөгийн default данс">
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
          </FormField>
          <FormField label="И-мэйл (нэхэмжлэх илгээхэд)">
            <Input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
              placeholder="billing@company.mn"
            />
          </FormField>
          <FormField label="Утас">
            <Input
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Хаяг">
            <Input
              value={form.address}
              onChange={(event) =>
                setForm((current) => ({ ...current, address: event.target.value }))
              }
            />
          </FormField>
          <FormField label="Холбоо барих хүн">
            <Input
              value={form.contactPerson}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contactPerson: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Банк">
            <Input
              value={form.bankName}
              onChange={(event) =>
                setForm((current) => ({ ...current, bankName: event.target.value }))
              }
              placeholder="Хаан банк"
            />
          </FormField>
          <FormField label="Банкны данс">
            <Input
              value={form.bankAccountNo}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bankAccountNo: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Төлбөрийн нөхцөл /хоног/">
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
          </FormField>
          <FormField label="Хөнгөлөлтийн бүлэг (VIP, ажилтан…)">
            <Input
              value={form.customerGroup}
              placeholder="POS-ийн харилцагчийн бүлгийн дүрэмд"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  customerGroup: event.target.value,
                }))
              }
            />
          </FormField>
          <FormField label="Зээлийн лимит ₮">
            <Input
              type="number"
              min="0"
              value={form.creditLimit}
              placeholder="Хоосон = хязгааргүй"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  creditLimit: event.target.value,
                }))
              }
            />
          </FormField>
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
                    // Төлөлтийн панель — хэрэглэгч АР/АП контекстдээ үлдэнэ.
                    <button
                      type="button"
                      className="text-[11px] font-medium text-[var(--ea-primary)] hover:underline"
                      onClick={() => openCashNewPanel({ arApDocumentId: doc.id })}
                    >
                      Мөнгөн хөрөнгөөр хаах
                    </button>
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
      <Icon name="company" size="xl" className="text-[var(--ea-text-3)]" />
      <div className="mt-3 text-sm font-medium text-[var(--ea-text-1)]">
        {mode === "payable" ? "Нийлүүлэгч бүртгээгүй байна" : "Харилцагч бүртгээгүй байна"}
      </div>
      <Button className="mt-4" onClick={onCounterparty}>
        <Icon name="add" />
        {mode === "payable" ? "Нийлүүлэгч нэмэх" : "Харилцагч нэмэх"}
      </Button>
    </div>
  );
}


