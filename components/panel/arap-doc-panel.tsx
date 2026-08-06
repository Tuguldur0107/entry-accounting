"use client";

// АР/АП баримтын панель — үүсгэх (documentId байхгүй) эсвэл харах (байвал).
// Payload: { documentId?: string; mode: "receivable" | "payable" | "combined" }.
// Сонголтын өгөгдлөө (харилцагч, сегмент, бараа/агуулах) server action-аар
// татна; формын dirty төлвийг setDirty(panel.id, ...)-д мэдэгдэнэ.

import { useEffect, useMemo, useState, useTransition } from "react";
import { IconAction } from "@/components/ui/icon-action";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import type {
  CellValueChangedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import { toast } from "sonner";

import { AccountInput } from "@/components/account/account-input";
import { AccountSegmentPanel } from "@/components/account/account-segment-panel";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { arapLinesSpec, type ArapLineImport } from "@/lib/excel/specs";
import { usePanelPrint } from "@/lib/ui/use-panel-print";
import { InvoiceSendDialog } from "@/components/arap/invoice-send-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  createArApDocument,
  deleteArApDocument,
  getArapDocPanelData,
  postArApDocument,
  type ArapDocPanelData,
} from "@/lib/actions/arap";
import type {
  ArApDocumentDetail,
  InventoryItemOption,
  WarehouseOption,
} from "@/lib/arap/load-data";
import type { ArApDocumentType, ArApLineInput } from "@/lib/arap/types";
import { AccountSegmentEditor } from "@/lib/grid/editors/AccountSegmentEditor";
import type { SegOption } from "@/lib/grid/editors/SegSelect";
import { parseMntInput } from "@/lib/grid/formatters";
import {
  buildSegCode,
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openCashDocPanel,
  openCashNewPanel,
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";

type ArApMode = "combined" | "receivable" | "payable";
type LineRow = ArApLineInput & { id: string };

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Баримт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

const TYPE_LABELS: Record<string, string> = {
  ar_invoice: "Авлагын нэхэмжлэл",
  ap_bill: "Өглөгийн нэхэмжлэх",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  partially_paid: "Хэсэгчлэн төлсөн",
  paid: "Төлсөн",
  reversed: "Буцаагдсан",
};

const STATUS_TONES: Record<string, StatusTone> = {
  draft: "muted",
  posted: "success",
  partially_paid: "warning",
  paid: "success",
  reversed: "danger",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function emptyLine(
  activeSegIds: number[],
  defaultSegments: Record<number, string>
): LineRow {
  return {
    id: nanoid(),
    account: buildSegCode({}, activeSegIds, defaultSegments),
    description: "",
    amount: 0,
  };
}

export function ArapDocPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const documentId = panel.payload.documentId as string | undefined;
  const mode = (panel.payload.mode as ArApMode | undefined) ?? "combined";
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: ArapDocPanelData; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг). Хадгалаагүй өөрчлөлттэй үед хэрэглэгчийн бичсэнийг дарж болохгүй
  // тул алгасна.
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getArapDocPanelData(documentId)
      .then((result) => {
        if (cancelled) return;
        // Fetch явж байх зуур хэрэглэгч бөглөж эхэлсэн бол хариуг хаяна —
        // key remount бичсэнийг нь арчих байсан.
        const now = usePanelStore
          .getState()
          .panels.find((entry) => entry.id === panel.id);
        if (now?.dirty) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({
          status: "ready",
          data: result.data,
          loadedToken: refreshToken,
        });
        if (result.data.document) {
          const doc = result.data.document;
          setTitle(panel.id, `${doc.documentNo} · ${doc.counterpartyName}`);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Icon name="loading" className="animate-spin" />
        Ачаалж байна…
      </div>
    );

  if (state.status === "error")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {state.message}
      </div>
    );

  const { data } = state;

  if (data.document)
    return (
      <ArapDocReadOnly
        key={state.loadedToken}
        panel={panel}
        document={data.document}
        data={data}
        requestClose={requestClose}
      />
    );

  return (
    <ArapDocForm
      // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ.
      key={state.loadedToken}
      panel={panel}
      data={data}
      mode={mode}
      requestClose={requestClose}
    />
  );
}

// ── Үүсгэх горим ────────────────────────────────────────────────────────────

function ArapDocForm({
  panel,
  data,
  mode,
  requestClose,
}: {
  panel: PanelInstance;
  data: ArapDocPanelData;
  mode: ArApMode;
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const setDirty = usePanelStore((state) => state.setDirty);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const {
    counterparties,
    activeSegIds,
    segmentOptions,
    defaultSegments,
    inventoryItems,
    warehouses,
    clearingAccountNumber,
    defaultAccountNumbers,
  } = data;

  // Модулийн default хяналтын данс (бүтэн сегмент кодоор) — харилцагч
  // сонгоогүй эсвэл харилцагчид default данс байхгүй үед хэрэглэнэ.
  function moduleControlFor(documentType: ArApDocumentType) {
    const number =
      documentType === "ar_invoice"
        ? defaultAccountNumbers.receivable
        : defaultAccountNumbers.payable;
    return number
      ? buildSegCode({ 3: number }, activeSegIds, defaultSegments)
      : "";
  }

  const [form, setForm] = useState(() => {
    const date = today();
    const documentType = (mode === "payable"
      ? "ap_bill"
      : "ar_invoice") as ArApDocumentType;
    return {
      documentType,
      documentNo: "",
      counterpartyId: "",
      date,
      dueDate: addDays(date, 30),
      currency: "MNT",
      exchangeRate: "1",
      controlAccountNumber: moduleControlFor(documentType),
      description: "",
      lines: [emptyLine(activeSegIds, defaultSegments)],
    };
  });

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той
  // харьцуулна (lazy useState нь ref-ээс ялгаатай render-цэвэр).
  const currentSnapshot = JSON.stringify(form);
  const [baseline] = useState(currentSnapshot);
  const dirty = currentSnapshot !== baseline;

  useEffect(() => {
    setDirty(panel.id, dirty);
  }, [dirty, panel.id, setDirty]);

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
      // Харилцагчид default данс байхгүй бол модулийн default-аар нөхнө —
      // хяналтын данс хоосон үлдэж хадгалахад алдаа өгдөг байсан.
      controlAccountNumber: control || moduleControlFor(documentType),
    };
  }

  function save(postNow: boolean) {
    // Клиент талын урьдчилсан шалгалт — server-ийн ерөнхий алдааны оронд
    // ЮУ дутуу байгааг тодорхой хэлнэ.
    if (!form.counterpartyId) {
      setError("Харилцагч сонгоно уу");
      return;
    }
    if (!form.controlAccountNumber.trim()) {
      setError(
        form.documentType === "ar_invoice"
          ? "Хяналтын (авлагын) данс сонгоно уу"
          : "Хяналтын (өглөгийн) данс сонгоно уу"
      );
      return;
    }
    if (!form.description.trim()) {
      setError("Баримтын утга оруулна уу");
      return;
    }
    const hasValidLine = form.lines.some(
      (line) => line.account && Number(line.amount) > 0
    );
    if (!hasValidLine) {
      setError("Дор хаяж нэг мөрөнд данс болон 0-ээс их дүн оруулна уу");
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        await createArApDocument({
          ...form,
          exchangeRate: Number(form.exchangeRate),
          postNow,
          lines: form.lines.map(
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
        toast.success(postNow ? "Баримт GL-д бичигдлээ" : "Ноорог хадгалагдлаа");
        closePanel(panel.id);
        refreshOpenPanels();
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Хадгалж чадсангүй");
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="sm:col-span-2">
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
        <div className="sm:col-span-2 lg:col-span-4">
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
          clearingAccountNumber={clearingAccountNumber}
        />
      </div>

      {error && <p className="text-xs text-[var(--ea-danger)]">{error}</p>}
      <div className="mt-auto flex justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={requestClose}>
          Болих
        </Button>
        <Button variant="outline" onClick={() => save(false)} disabled={isPending}>
          Ноорог
        </Button>
        <Button onClick={() => save(true)} disabled={isPending}>
          GL-д бичих
        </Button>
      </div>
    </div>
  );
}

// ── Харах горим ─────────────────────────────────────────────────────────────
// GL журналын read-only панельтэй ижил зарчим: талбарууд label + утга,
// мөрүүд нь read-only хүснэгтээр.

function ArapDocReadOnly({
  panel,
  document,
  data,
  requestClose,
}: {
  panel: PanelInstance;
  document: ArApDocumentDetail;
  data: ArapDocPanelData;
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const { print, renderSheet } = usePanelPrint();
  // Нэхэмжлэх илгээх dialog (зөвхөн posted АР нэхэмжлэхэд).
  const [sendOpen, setSendOpen] = useState(false);

  const { activeSegIds, segmentOptions, inventoryItems, warehouses, payments } =
    data;
  const hasItems = document.lines.some((line) => line.itemId);

  // Данс дээр дарахад журнал бичихтэй ижил сегментийн panel нээгдэнэ.
  const [segPanel, setSegPanel] = useState<{
    code: string;
    anchor: DOMRect;
  } | null>(null);

  const accountNameByMain = useMemo(
    () =>
      new Map(
        (segmentOptions[3] ?? []).map((option) => [option.code, option.name])
      ),
    [segmentOptions]
  );
  const accountName = (code: string) => {
    const parts = String(code ?? "").split(".");
    const main = parts.length === 10 ? parts[2] : String(code ?? "");
    return accountNameByMain.get(main) ?? "";
  };
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

  type LineView = ArApDocumentDetail["lines"][number];
  // Журнал бичих дэлгэцтэй ижил дараалал: Данс · Дансны нэр · Дүн ·
  // (Бараа · Тоо · Агуулах) · Тайлбар СҮҮЛД + pinned нийт дүн.
  const columns = useMemo<ColDef<LineView>[]>(
    () => [
      {
        headerName: "#",
        width: 48,
        cellClass: "ag-center-cell text-xs",
        valueGetter: (p) =>
          p.node?.rowPinned || p.node?.rowIndex == null ? "" : p.node.rowIndex + 1,
      },
      {
        headerName: "Данс",
        field: "account",
        minWidth: 200,
        flex: 1,
        cellClass: (p) =>
          p.node?.rowPinned
            ? "font-semibold text-[var(--ea-text-1)]"
            : "font-mono text-xs",
        valueFormatter: (params) =>
          params.node?.rowPinned
            ? "Нийт дүн"
            : fmtAccountDisplay(String(params.value ?? ""), activeSegIds),
        // Дарахад сегментээр задалж харах panel (журнал бичихтэй ижил UX).
        cellRenderer: (p: ICellRendererParams<LineView>) => {
          if (!p.data || p.node?.rowPinned) return p.valueFormatted ?? "";
          const code = String(p.data.account ?? "");
          return (
            <button
              type="button"
              data-account-segment-trigger
              aria-haspopup="dialog"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setSegPanel((prev) =>
                  prev && prev.code === code ? null : { code, anchor: rect }
                );
              }}
              title="Сегментээр харах"
              className="flex h-full w-full items-center gap-1.5 text-left transition-colors hover:text-[var(--ea-primary)]"
            >
              <span className="min-w-0 truncate">{p.valueFormatted ?? ""}</span>
              <Icon name="chevronDown" size="xs" className="shrink-0 text-[var(--ea-text-4)]" />
            </button>
          );
        },
      },
      {
        headerName: "Дансны нэр",
        colId: "account-name",
        width: 190,
        cellClass: "text-xs text-[var(--ea-text-2)]",
        valueGetter: (p) =>
          !p.data || p.node?.rowPinned ? "" : accountName(p.data.account),
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value != null && params.value !== "" ? fmtMnt(Number(params.value)) : "",
      },
      ...(hasItems
        ? ([
            {
              headerName: "Бараа",
              field: "itemId",
              minWidth: 160,
              valueFormatter: (params) =>
                params.node?.rowPinned
                  ? ""
                  : params.value
                    ? itemLabelById.get(String(params.value)) ?? "—"
                    : "—",
            },
            {
              headerName: "Тоо",
              field: "quantity",
              width: 96,
              cellClass: "ag-right-aligned-cell font-mono",
              headerClass: "ag-right-aligned-header",
              valueFormatter: (params) =>
                params.node?.rowPinned
                  ? ""
                  : params.value != null
                    ? String(params.value)
                    : "",
            },
            {
              headerName: "Агуулах",
              field: "warehouseId",
              minWidth: 140,
              valueFormatter: (params) =>
                params.node?.rowPinned
                  ? ""
                  : params.value
                    ? warehouseLabelById.get(String(params.value)) ?? "—"
                    : "—",
            },
          ] as ColDef<LineView>[])
        : []),
      {
        headerName: "Тайлбар",
        field: "description",
        minWidth: 170,
        flex: 1,
        cellClass: "text-xs",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSegIds, hasItems, itemLabelById, warehouseLabelById, accountNameByMain]
  );

  const pinnedTotals = useMemo(
    () =>
      [
        {
          id: "__totals__",
          account: "",
          description: "",
          amount: document.lines.reduce(
            (sum, line) => sum + Number(line.amount ?? 0),
            0
          ),
        } as LineView,
      ],
    [document.lines]
  );

  function postDraft() {
    void confirm({
      title: "Баримт батлах",
      description: `${document.documentNo} ноорог баримтыг баталж GL журнал үүсгэх үү? Бараатай мөрүүд нь Бараа материалд тоо хэмжээний ноорог үүсгэнэ.`,
      confirmText: "Батлах",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          await postArApDocument(document.id);
          toast.success("Баримт батлагдаж GL-д бичигдлээ");
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        } catch (caught) {
          toast.error(caught instanceof Error ? caught.message : "Батлах амжилтгүй");
        }
      });
    });
  }

  function deleteDraft() {
    const posted = document.status !== "draft";
    void confirm({
      title: posted ? "Баримт устгах" : "Ноорог устгах",
      description: posted
        ? `${document.documentNo} · ${document.counterpartyName} БАТЛАГДСАН нэхэмжлэхийг GL журналтай нь хамт бүрмөсөн устгах уу? (Төлөлттэй бол татгалзана.)`
        : `${document.documentNo} · ${document.counterpartyName} ноорог баримтыг устгах уу? Мөрүүд нь хамт устана.`,
      confirmText: "Устгах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          await deleteArApDocument(document.id);
          toast.success("Ноорог баримт устгагдлаа");
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        } catch (caught) {
          toast.error(caught instanceof Error ? caught.message : "Устгах амжилтгүй");
        }
      });
    });
  }

  const foreign = document.currency !== "MNT";
  const isAr = document.documentType === "ar_invoice";

  // Хэвлэх маягт — НЭХЭМЖЛЭХ (АР) / ХУДАЛДАН АВАЛТЫН БАРИМТ (АП).
  const printSheet = (
    <div className="ea-print-sheet hidden bg-white p-8 text-black print:block">
      <div className="mb-1 text-center text-lg font-bold uppercase tracking-wide">
        {isAr ? "НЭХЭМЖЛЭХ" : "ХУДАЛДАН АВАЛТЫН БАРИМТ"}
      </div>
      <div className="mb-5 text-center text-xs text-neutral-500">
        № {document.documentNo}
      </div>
      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-neutral-500">{isAr ? "Худалдан авагч" : "Нийлүүлэгч"}: </span>
          {document.counterpartyName}
        </div>
        <div>
          <span className="text-neutral-500">Огноо: </span>
          <span className="font-mono">{document.date}</span>
        </div>
        <div>
          <span className="text-neutral-500">Төлөх огноо: </span>
          <span className="font-mono">{document.dueDate}</span>
        </div>
        <div className="col-span-3">
          <span className="text-neutral-500">Утга: </span>
          {document.description || "—"}
        </div>
      </div>

      <div
        className="grid border-b border-t border-black text-xs"
        style={{
          gridTemplateColumns: hasItems
            ? "0.4fr 2fr 1.4fr 0.7fr 1fr"
            : "0.4fr 2.6fr 1.6fr 1fr",
        }}
      >
        <div className="border-b border-neutral-400 py-1.5 font-semibold">№</div>
        <div className="border-b border-neutral-400 py-1.5 font-semibold">Тайлбар</div>
        {hasItems && (
          <div className="border-b border-neutral-400 py-1.5 font-semibold">Бараа</div>
        )}
        {hasItems && (
          <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">Тоо</div>
        )}
        {!hasItems && (
          <div className="border-b border-neutral-400 py-1.5 font-semibold">Данс</div>
        )}
        <div className="border-b border-neutral-400 py-1.5 text-right font-semibold">
          Дүн ({document.currency})
        </div>
        {document.lines.map((line, index) => (
          <div key={line.id} className="contents">
            <div className="py-1">{index + 1}</div>
            <div className="py-1">{line.description || "—"}</div>
            {hasItems && (
              <div className="py-1">
                {line.itemId ? itemLabelById.get(line.itemId) ?? "" : ""}
              </div>
            )}
            {hasItems && (
              <div className="py-1 text-right font-mono">
                {line.quantity != null ? String(line.quantity) : ""}
              </div>
            )}
            {!hasItems && (
              <div className="py-1 font-mono">
                {fmtAccountDisplay(line.account, activeSegIds)}
              </div>
            )}
            <div className="py-1 text-right font-mono">
              {fmtMnt(Number(line.amount ?? 0))}
            </div>
          </div>
        ))}
        <div
          className="border-t border-black py-1.5 font-semibold"
          style={{ gridColumn: hasItems ? "1 / span 4" : "1 / span 3" }}
        >
          Нийт дүн
        </div>
        <div className="border-t border-black py-1.5 text-right font-mono font-semibold">
          {fmtMnt(document.totalAmount)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-neutral-500">Төлсөн: </span>
          <span className="font-mono">{fmtMnt(document.paidAmount)}</span>
        </div>
        <div>
          <span className="text-neutral-500">Үлдэгдэл: </span>
          <span className="font-mono font-semibold">{fmtMnt(document.balance)}</span>
        </div>
      </div>

      <div className="mt-12 grid grid-cols-2 gap-8 text-xs">
        <div>
          Захирал: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
        <div>
          Нягтлан бодогч: _______________________
          <div className="mt-1 text-neutral-500">/овог нэр, гарын үсэг/</div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONES[document.status] ?? "muted"}>
          {STATUS_LABELS[document.status] ?? document.status}
        </StatusBadge>
        <span className="text-xs text-[var(--ea-text-3)]">
          {TYPE_LABELS[document.documentType] ?? document.documentType}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReadField label="Дугаар">
          <span className="font-mono">{document.documentNo}</span>
        </ReadField>
        <ReadField label="Харилцагч">{document.counterpartyName}</ReadField>
        <ReadField label="Огноо">
          <span className="font-mono">{document.date}</span>
        </ReadField>
        <ReadField label="Төлөх огноо">
          <span className="font-mono">{document.dueDate}</span>
        </ReadField>
        <ReadField label="Хяналтын данс">
          <span className="font-mono">
            {fmtAccountDisplay(document.controlAccountNumber, activeSegIds)}
          </span>
        </ReadField>
        <ReadField label="Валют">
          {document.currency}
          {foreign ? ` · ханш ${document.exchangeRate}` : ""}
        </ReadField>
        <div className="sm:col-span-2 lg:col-span-3">
          <ReadField label="Утга">{document.description}</ReadField>
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Мөрүүд
        </div>
        <DataGridDynamic<LineView>
          rowData={document.lines}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          pinnedBottomRowData={pinnedTotals}
          height={Math.min(420, 130 + document.lines.length * 38)}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          enableCellTextSelection
        />
        <AccountSegmentPanel
          anchor={segPanel?.anchor ?? null}
          value={segPanel?.code ?? ""}
          onCancel={() => setSegPanel(null)}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          readOnly
        />
      </div>

      {/* Төлөлтүүд — нэхэмжлэхтэй холбогдсон мөнгөн хөрөнгийн баримтууд */}
      {payments.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Төлөлтүүд
          </div>
          <div className="space-y-1.5">
            {payments.map((payment) => (
              <button
                key={payment.id}
                type="button"
                onClick={() => openCashDocPanel(payment.id, payment.documentNo)}
                className="flex w-full items-center gap-2.5 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-left transition-colors hover:border-[var(--ea-primary)]"
              >
                <Icon name="cash" size="sm" className="shrink-0 text-[var(--ea-primary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--ea-text-1)]">
                    {payment.documentNo}
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ea-text-4)]">
                    {payment.date}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold text-[var(--ea-text-1)]">
                  {fmtMnt(payment.baseAmount)}
                </span>
                <StatusBadge
                  tone={
                    payment.status === "posted"
                      ? "success"
                      : payment.status === "reversed"
                        ? "muted"
                        : "warning"
                  }
                >
                  {payment.status === "posted"
                    ? "Батлагдсан"
                    : payment.status === "reversed"
                      ? "Буцаагдсан"
                      : "Ноорог"}
                </StatusBadge>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-[var(--ea-primary)]">
                  Нээх
                  <Icon name="openDetail" size="xs" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <ReadField label={`Нийт дүн (${document.currency})`}>
          <span className="font-mono font-semibold">
            {fmtMnt(document.totalAmount)}
          </span>
        </ReadField>
        <ReadField label={`Төлсөн (${document.currency})`}>
          <span className="font-mono">{fmtMnt(document.paidAmount)}</span>
        </ReadField>
        <ReadField label={`Үлдэгдэл (${document.currency})`}>
          <span className="font-mono font-semibold">
            {fmtMnt(document.balance)}
          </span>
        </ReadField>
        {foreign && (
          <>
            <ReadField label="Нийт дүн (MNT)">
              <span className="font-mono">{fmtMnt(document.baseTotalAmount)}</span>
            </ReadField>
            <ReadField label="Төлсөн (MNT)">
              <span className="font-mono">{fmtMnt(document.basePaidAmount)}</span>
            </ReadField>
            <ReadField label="Үлдэгдэл (MNT)">
              <span className="font-mono font-semibold">
                {fmtMnt(document.baseBalance)}
              </span>
            </ReadField>
          </>
        )}
      </div>

      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={print} disabled={isPending}>
          <Icon name="print" size="sm" />
          Хэвлэх
        </Button>
        {isAr && (
          <Button
            variant="outline"
            render={
              <a
                href={`/api/arap/${document.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <Icon name="download" size="sm" />
            PDF
          </Button>
        )}
        {isAr &&
          (document.status === "posted" ||
            document.status === "partially_paid" ||
            document.status === "paid") && (
            <Button onClick={() => setSendOpen(true)}>
              <Icon name="send" size="sm" />
              Илгээх
            </Button>
          )}
        <Button variant="outline" onClick={requestClose}>
          Хаах
        </Button>
        {document.voucherId && (
          <Button
            variant="outline"
            onClick={() => openVoucherPanel(document.voucherId!)}
          >
            GL журнал
          </Button>
        )}
        {(document.status === "posted" ||
          document.status === "partially_paid") && (
          <Button
            variant="outline"
            onClick={() => openCashNewPanel({ arApDocumentId: document.id })}
          >
            Мөнгөн хөрөнгөөр хаах
          </Button>
        )}
        {document.status === "posted" && (
          <Button variant="outline" onClick={deleteDraft} disabled={isPending}>
            <Icon name="delete" size="sm" />
            Устгах
          </Button>
        )}
        {document.status === "draft" && (
          <>
            <Button variant="outline" onClick={deleteDraft} disabled={isPending}>
              <Icon name="delete" size="sm" />
              Устгах
            </Button>
            <Button onClick={postDraft} disabled={isPending}>
              Батлах
            </Button>
          </>
        )}
      </div>
      {confirmDialog}
      {renderSheet(printSheet)}
      {isAr && (
        <InvoiceSendDialog
          documentId={document.id}
          documentNo={document.documentNo}
          open={sendOpen}
          onOpenChange={setSendOpen}
        />
      )}
    </div>
  );
}

// ── Мөрийн хүснэгт (үүсгэх горим) ───────────────────────────────────────────
// Урьд нь arap-workspace.tsx-ийн DocumentDialog дотор байсан — одоо цорын
// ганц хэрэглэгч нь энэ панель.

function ArApLinesGrid({
  lines,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments,
  inventoryItems,
  warehouses,
  documentType,
  clearingAccountNumber,
}: {
  lines: LineRow[];
  onChange: (updater: (prev: LineRow[]) => LineRow[]) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
  inventoryItems: InventoryItemOption[];
  warehouses: WarehouseOption[];
  documentType: ArApDocumentType;
  /** Клирингийн данс — тохиргооноос ирнэ (JPR-006). */
  clearingAccountNumber: string;
}) {
  const total = lines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const [importOpen, setImportOpen] = useState(false);

  // Excel импорт — олон бараатай нэхэмжлэхийг нэг файлаас (стандарт:
  // зөвхөн зөв мөрүүд орж ирнэ; бараа/агуулах КОДООР танигдана).
  const importSpec = useMemo(
    () =>
      arapLinesSpec({
        accountsByMain: new Map(
          (segmentOptions[3] ?? []).map((option) => [option.code, option.name])
        ),
        activeSegIds,
        defaultSegments,
        itemsByCode: new Map(
          inventoryItems.map((item) => [
            item.code,
            { id: item.id, name: item.name },
          ])
        ),
        warehousesByCode: new Map(
          warehouses.map((warehouse) => [
            warehouse.code,
            { id: warehouse.id, name: warehouse.name },
          ])
        ),
      }),
    [segmentOptions, activeSegIds, defaultSegments, inventoryItems, warehouses]
  );

  function handleImportLines(values: ArapLineImport[]) {
    onChange((prev) => {
      // Хүрээгүй хоосон мөрүүдийг импорт орлоно.
      const kept = prev.filter(
        (line) => Number(line.amount || 0) > 0 || line.description.trim() !== ""
      );
      return [
        ...kept,
        ...values.map((value) => ({
          id: nanoid(),
          account: value.account,
          description: value.description,
          amount: value.amount,
          itemId: value.itemId ?? undefined,
          quantity: value.quantity ?? undefined,
          warehouseId: value.warehouseId ?? undefined,
        })),
      ];
    });
  }

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
          <IconAction
            name="delete"
            label="Мөр устгах"
            size="sm"
            variant="danger"
            onClick={() =>
              onChange((prev) =>
                prev.length <= 1 ? prev : prev.filter((line) => line.id !== data?.id)
              )
            }
          />
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
                  { 3: clearingAccountNumber },
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
        <div className="flex items-center gap-2">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Icon name="spreadsheet" size="sm" />
            Excel импорт
          </Button>
        </div>
        <span className="font-mono font-semibold text-[var(--ea-text-1)]">
          Нийт: {fmtMnt(total)}
        </span>
      </div>
      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spec={importSpec}
        title="Баримтын мөр импортлох"
        onImport={handleImportLines}
      />
    </div>
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

function ReadField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-[var(--ea-text-3)]">{label}</div>
      <div className="text-sm text-[var(--ea-text-1)]">{children}</div>
    </div>
  );
}
