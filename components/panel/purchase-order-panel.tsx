"use client";

// Худалдан авалтын захиалгын (PO) ПАНЕЛЬ — үүсгэх (purchaseOrderId байхгүй)
// эсвэл харах/засах (байвал). Payload: { purchaseOrderId?: string }.
//
// Хэв маяг нь components/panel/arap-doc-panel.tsx-тэй ИЖИЛ: load →
// PanelLoading/PanelError → форм → dirty guard (setDirty) → setTitle →
// хадгалах/батлах товчнууд. Бүх элемент ui-kit-ээс (Button / Input / Label /
// Icon / IconAction / StatusBadge / EmptyState / PageTabs / useConfirm),
// хүснэгт нь DataGridDynamic — ШИНЭ component, icon, хүснэгт бичихийг
// ХОРИГЛОНО (docs/procurement 01-implementation-contract.md §11).
//
// Урсгал (docs/procurement §3.3): ① PO ноорог → Батлах (open) → ② Хүлээн
// авалт → ③④ Нэхэмжлэх → ⑤ Хуваарилалт → ⑥ PO хаах (нөхцөл биелсэн үед).

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import type {
  CellValueChangedEvent,
  ColDef,
  RowDoubleClickedEvent,
} from "ag-grid-community";
import { toast } from "sonner";

import { CounterpartySelect } from "@/components/arap/counterparty-select";
import { AttachmentList } from "@/components/attachments/attachment-list";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";
import { SupplierCard } from "@/components/procurement/supplier-card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconAction } from "@/components/ui/icon-action";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageTabs, type TabOption } from "@/components/ui/tabs";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  fetchOfficialRate,
  getPurchaseOrderPanelData,
  reopenPurchaseOrder,
  updatePurchaseOrder,
} from "@/lib/actions/procurement";
import { roundMoney } from "@/lib/arap/accounting";
import type { CounterpartyView } from "@/lib/arap/types";
import { PO_BUSINESS_OBJECT } from "@/lib/procurement/constants";
import { remainingToInvoice } from "@/lib/procurement/po-math";
import type {
  GoodsReceiptView,
  PurchaseOrderDetail,
  PurchaseOrderLineView,
  PurchaseOrderPanelData,
} from "@/lib/procurement/types";
import {
  GR_STATUS_LABELS,
  GR_STATUS_TONES,
  PO_STATUS_LABELS,
  PO_STATUS_TONES,
} from "@/lib/procurement/labels";
import { parseMntInput } from "@/lib/grid/formatters";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openArapDocPanel,
  openGoodsReceiptPanel,
  openPurchaseOrderPanel,
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Захиалга олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;


const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  partially_paid: "Хэсэгчлэн төлсөн",
  paid: "Төлсөн",
  reversed: "Буцаагдсан",
};

type PoTab = "lines" | "receipts" | "invoices" | "costs" | "attachments";

export function PurchaseOrderPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const purchaseOrderId = panel.payload.purchaseOrderId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: PurchaseOrderPanelData; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг). Хадгалаагүй өөрчлөлттэй үед хэрэглэгчийн бичсэнийг дарж болохгүй
  // тул алгасна (arap-doc-panel.tsx-ийн хэв маяг).
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getPurchaseOrderPanelData(purchaseOrderId)
      .then((result) => {
        if (cancelled) return;
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
        const detail = result.data.detail;
        if (detail)
          setTitle(panel.id, `${detail.documentNo} · ${detail.counterpartyName}`);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseOrderId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading") return <PanelLoading />;
  if (state.status === "error") return <PanelError message={state.message} />;

  return (
    <PurchaseOrderBody
      // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ.
      key={state.loadedToken}
      panel={panel}
      data={state.data}
      requestClose={requestClose}
    />
  );
}

// ── Форм ────────────────────────────────────────────────────────────────────

/** Grid-ийн мөр — серверийн мөрийн id (`lineId`) байвал засварлагдана. */
type PoLineRow = {
  /** Grid-ийн түлхүүр (шинэ мөрд nanoid). */
  id: string;
  /** Серверийн мөрийн id — шинэ мөрд undefined. */
  lineId?: string;
  itemId: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  warehouseId: string;
  description: string;
  receivedQuantity: number;
  invoicedQuantity: number;
};

type PoFormState = {
  counterpartyId: string;
  documentNo: string;
  date: string;
  expectedDate: string;
  currency: string;
  warehouseId: string;
  description: string;
  lines: PoLineRow[];
};

function lineRowsOf(lines: PurchaseOrderLineView[]): PoLineRow[] {
  return lines.map((line) => ({
    id: line.id,
    lineId: line.id,
    itemId: line.itemId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
    warehouseId: line.warehouseId ?? "",
    description: line.description,
    receivedQuantity: line.receivedQuantity,
    invoicedQuantity: line.invoicedQuantity,
  }));
}

function emptyPoLine(warehouseId: string): PoLineRow {
  return {
    id: nanoid(),
    itemId: "",
    quantity: 0,
    unitPrice: 0,
    amount: 0,
    warehouseId,
    description: "",
    receivedQuantity: 0,
    invoicedQuantity: 0,
  };
}

function PurchaseOrderBody({
  panel,
  data,
  requestClose,
}: {
  panel: PanelInstance;
  data: PurchaseOrderPanelData;
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const setDirty = usePanelStore((state) => state.setDirty);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const { detail, counterparties, inventoryItems, warehouses, supplier } = data;
  const status = detail?.status ?? "draft";
  /** Ноорог ба нээлттэй захиалга засагдана (сервер мөн шалгана). */
  const canEdit = status === "draft" || status === "open";
  const isNew = !detail;

  const [tab, setTab] = useState<PoTab>("lines");
  const [closeDate, setCloseDate] = useState(data.today);
  const [rateHint, setRateHint] = useState<{
    rate: number;
    rateDate: string;
  } | null>(null);
  const [rateBusy, setRateBusy] = useState(false);

  const [form, setForm] = useState<PoFormState>(() =>
    detail
      ? {
          counterpartyId: detail.counterpartyId,
          documentNo: detail.documentNo,
          date: detail.date,
          expectedDate: detail.expectedDate ?? "",
          currency: detail.currency,
          warehouseId: detail.warehouseId ?? "",
          description: detail.description,
          lines: lineRowsOf(detail.lines),
        }
      : {
          counterpartyId: "",
          documentNo: "",
          date: data.today,
          expectedDate: "",
          currency: "MNT",
          warehouseId: "",
          description: "",
          lines: [emptyPoLine("")],
        }
  );

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той
  // харьцуулна (arap-doc-panel.tsx-тэй ижил зарчим).
  const currentSnapshot = JSON.stringify(form);
  const [baseline, setBaseline] = useState(currentSnapshot);
  const dirty = currentSnapshot !== baseline;

  useEffect(() => {
    setDirty(panel.id, dirty);
  }, [dirty, panel.id, setDirty]);

  const itemLabelById = useMemo(
    () =>
      new Map(
        inventoryItems.map((item) => [item.id, `${item.code} · ${item.name}`])
      ),
    [inventoryItems]
  );
  const itemUnitById = useMemo(
    () => new Map(inventoryItems.map((item) => [item.id, item.unit])),
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

  const totalAmount = roundMoney(
    form.lines.reduce((sum, line) => sum + Number(line.amount || 0), 0)
  );
  const foreign = form.currency !== "MNT";

  /** Нийлүүлэгчийн карт — хадгалагдсан PO-д баяжуулсан, шинэд сонголтоос. */
  const supplierRow: CounterpartyView | null =
    supplier ?? counterparties.find((row) => row.id === form.counterpartyId) ?? null;

  const showProgress = form.lines.some(
    (line) => line.receivedQuantity > 0 || line.invoicedQuantity > 0
  );

  const columns = useMemo<ColDef<PoLineRow>[]>(
    () => [
      {
        headerName: "#",
        width: 48,
        cellClass: "ag-center-cell text-xs",
        valueGetter: (p) =>
          p.node?.rowPinned || p.node?.rowIndex == null ? "" : p.node.rowIndex + 1,
      },
      {
        headerName: "Бараа",
        field: "itemId",
        minWidth: 180,
        flex: 1,
        // Хүлээн авсан/нэхэмжилсэн мөрийн бараа сольж болохгүй (сервер ч
        // татгалзана) — тоо/үнэ засах нь боломжтой хэвээр.
        editable: (p) =>
          canEdit &&
          !p.node?.rowPinned &&
          !(
            (p.data?.receivedQuantity ?? 0) > 0 ||
            (p.data?.invoicedQuantity ?? 0) > 0
          ),
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["", ...inventoryItems.map((item) => item.id)],
        },
        cellClass: (p) =>
          p.node?.rowPinned ? "font-semibold text-[var(--ea-text-1)]" : "",
        valueFormatter: (params) =>
          params.node?.rowPinned
            ? "Нийт дүн"
            : params.value
              ? itemLabelById.get(String(params.value)) ?? "—"
              : "—",
      },
      {
        headerName: "Тайлбар",
        field: "description",
        minWidth: 150,
        flex: 1,
        editable: canEdit,
        cellClass: "text-xs",
      },
      {
        headerName: "Тоо",
        field: "quantity",
        width: 100,
        editable: canEdit,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          // Paste contract (CLAUDE.md): ₮, зай, таслал, цэгийг НЭГ парсер танина.
          const value = parseMntInput(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : 0;
        },
        valueFormatter: (params) =>
          params.node?.rowPinned || !params.value ? "" : String(params.value),
      },
      {
        headerName: "Нэгж",
        colId: "unit",
        width: 72,
        cellClass: "text-xs text-[var(--ea-text-3)]",
        valueGetter: (p) =>
          !p.data || p.node?.rowPinned
            ? ""
            : itemUnitById.get(p.data.itemId) ?? "",
      },
      {
        headerName: `Нэгж үнэ (${form.currency || "валют"})`,
        field: "unitPrice",
        width: 132,
        editable: canEdit,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          // Paste contract (CLAUDE.md): ₮, зай, таслал, цэгийг НЭГ парсер танина.
          const value = parseMntInput(params.newValue);
          return Number.isFinite(value) && value > 0 ? value : 0;
        },
        valueFormatter: (params) =>
          params.node?.rowPinned || !params.value
            ? ""
            : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 140,
        // Тоо × нэгж үнэ = дүн (схемийн дүрэм) — гараар засагдахгүй.
        editable: false,
        cellClass: (p) =>
          p.node?.rowPinned
            ? "ag-right-aligned-cell font-mono font-semibold"
            : "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value ? fmtMnt(Number(params.value)) : "",
      },
      {
        headerName: "Агуулах",
        field: "warehouseId",
        minWidth: 150,
        editable: canEdit,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: {
          values: ["", ...warehouses.map((warehouse) => warehouse.id)],
        },
        valueFormatter: (params) =>
          params.node?.rowPinned
            ? ""
            : params.value
              ? warehouseLabelById.get(String(params.value)) ?? "—"
              : "—",
      },
      ...(showProgress
        ? ([
            {
              headerName: "Хүлээн авсан",
              field: "receivedQuantity",
              width: 118,
              cellClass: "ag-right-aligned-cell font-mono text-xs",
              headerClass: "ag-right-aligned-header",
              valueFormatter: (params) =>
                params.node?.rowPinned ? "" : String(params.value ?? 0),
            },
            {
              headerName: "Нэхэмжилсэн",
              field: "invoicedQuantity",
              width: 118,
              cellClass: "ag-right-aligned-cell font-mono text-xs",
              headerClass: "ag-right-aligned-header",
              valueFormatter: (params) =>
                params.node?.rowPinned ? "" : String(params.value ?? 0),
            },
          ] as ColDef<PoLineRow>[])
        : []),
      ...(canEdit
        ? ([
            {
              headerName: "",
              colId: "action",
              width: 44,
              sortable: false,
              filter: false,
              cellRenderer: (p: { data?: PoLineRow; node?: { rowPinned?: unknown } }) =>
                p.node?.rowPinned ? null : (
                  <IconAction
                    name="delete"
                    label="Мөр устгах"
                    size="sm"
                    variant="danger"
                    onClick={() => removeLine(p.data)}
                  />
                ),
            },
          ] as ColDef<PoLineRow>[])
        : []),
    ],
    [
      canEdit,
      form.currency,
      inventoryItems,
      itemLabelById,
      itemUnitById,
      showProgress,
      warehouseLabelById,
      warehouses,
    ]
  );

  const pinnedTotals = useMemo<PoLineRow[]>(
    () => [{ ...emptyPoLine(""), id: "__totals__", amount: totalAmount }],
    [totalAmount]
  );

  function removeLine(row?: PoLineRow) {
    if (!row) return;
    if (row.receivedQuantity > 0 || row.invoicedQuantity > 0) {
      toast.error("Хүлээн авсан / нэхэмжилсэн мөрийг хасах боломжгүй");
      return;
    }
    setForm((current) =>
      current.lines.length <= 1
        ? current
        : { ...current, lines: current.lines.filter((line) => line.id !== row.id) }
    );
  }

  /** Мөрийн нүд өөрчлөгдөх — тоо × нэгж үнэ = дүн автоматаар. */
  function handleCellChange(event: CellValueChangedEvent<PoLineRow>) {
    const field = event.colDef.field as keyof PoLineRow | undefined;
    if (!field) return;
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (line.id !== event.data.id) return line;
        const next = { ...line, [field]: event.newValue } as PoLineRow;
        if (field === "itemId" && !event.newValue) next.itemId = "";
        const quantity = Number(next.quantity || 0);
        const unitPrice = Number(next.unitPrice || 0);
        next.amount =
          quantity > 0 && unitPrice > 0 ? roundMoney(quantity * unitPrice) : 0;
        return next;
      }),
    }));
  }

  /** Албан ханш татах — мэдээллийн зорилгоор (PO-д ханш хадгалагддаггүй). */
  function loadRateHint() {
    setRateBusy(true);
    void fetchOfficialRate({ currency: form.currency, date: form.date })
      .then((result) => {
        if (result.error || result.rate == null) {
          toast.error(result.error ?? "Ханш татагдсангүй");
          return;
        }
        setRateHint({ rate: result.rate, rateDate: result.rateDate ?? form.date });
      })
      .catch(() => toast.error("Ханш татагдсангүй"))
      .finally(() => setRateBusy(false));
  }

  function validate(): string {
    if (!form.counterpartyId) return "Нийлүүлэгч сонгоно уу";
    if (!form.date) return "Огноо оруулна уу";
    if (!form.description.trim()) return "Захиалгын утга оруулна уу";
    if (!/^[A-Z]{3}$/.test(form.currency.trim().toUpperCase()))
      return "Валютын код 3 үсэг байна (ж: MNT, USD)";
    const filled = form.lines.filter((line) => line.itemId);
    if (filled.length === 0) return "Дор хаяж нэг мөрөнд бараа сонгоно уу";
    if (filled.some((line) => !(Number(line.quantity) > 0)))
      return "Мөр бүрийн тоо хэмжээ 0-ээс их байна";
    if (filled.some((line) => !(Number(line.unitPrice) > 0)))
      return "Мөр бүрийн нэгж үнэ 0-ээс их байна (үнэ зохиохгүй)";
    return "";
  }

  /** Серверийн мөрийн формат — барааг сонгоогүй хоосон мөрийг хаяна. */
  function payloadLines() {
    return form.lines
      .filter((line) => line.itemId)
      .map((line) => ({
        itemId: line.itemId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        warehouseId: line.warehouseId || undefined,
        description: line.description,
      }));
  }

  /** Засварын мөрүүд — байгаа мөрийн id-тай (id-гүй нь ШИНЭ мөр болно). */
  function updateLines() {
    return form.lines
      .filter((line) => line.itemId)
      .map((line) => ({
        id: line.lineId,
        itemId: line.itemId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        warehouseId: line.warehouseId || undefined,
        description: line.description,
      }));
  }

  /** Хадгалсны дараа: dirty-г цэвэрлээд панелиудыг сэргээнэ. */
  function markSaved(snapshot: string) {
    setBaseline(snapshot);
    setDirty(panel.id, false);
    refreshOpenPanels();
    router.refresh();
  }

  function save(approveNow: boolean) {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError("");
    const snapshot = JSON.stringify(form);
    startTransition(async () => {
      try {
        if (!detail) {
          const result = await createPurchaseOrder({
            counterpartyId: form.counterpartyId,
            date: form.date,
            expectedDate: form.expectedDate || undefined,
            currency: form.currency.trim().toUpperCase(),
            warehouseId: form.warehouseId || undefined,
            description: form.description,
            documentNo: form.documentNo.trim() || undefined,
            lines: payloadLines(),
            approveNow,
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          if (approveNow) feedback.posted("Захиалга батлагдлаа");
          else feedback.saved("Захиалга хадгалагдлаа");
          // Хадгалагдсан захиалгыг ШИНЭ панелиар нээж (dedupe key-тэй) хүлээн
          // авалт / нэхэмжлэх үүсгэх үргэлжлэлийг тэндээс хийнэ.
          setDirty(panel.id, false);
          closePanel(panel.id);
          if (result.id) openPurchaseOrderPanel({ purchaseOrderId: result.id });
          refreshOpenPanels();
          router.refresh();
          return;
        }

        if (dirty) {
          const updated = await updatePurchaseOrder({
            id: detail.id,
            date: form.date,
            expectedDate: form.expectedDate || undefined,
            warehouseId: form.warehouseId || undefined,
            description: form.description,
            lines: updateLines(),
          });
          if (updated.error) {
            setError(updated.error);
            return;
          }
        }
        if (approveNow && detail.status === "draft") {
          const approved = await approvePurchaseOrder({ id: detail.id });
          if (approved.error) {
            setError(approved.error);
            // Засвар хадгалагдсан тул панелийг сэргээнэ.
            markSaved(snapshot);
            return;
          }
          feedback.posted("Захиалга батлагдлаа");
        } else {
          feedback.saved("Захиалга хадгалагдлаа");
        }
        markSaved(snapshot);
      } catch {
        setError("Хадгалж чадсангүй");
      }
    });
  }

  function closeOrder() {
    if (!detail) return;
    void confirm({
      title: "Захиалга хаах",
      description: `${detail.documentNo} захиалгыг ${closeDate} өдрөөр хаах уу? Бараа материалын болон өглөгийн түр дансууд тэгшитгэгдэж, ханшийн зөрүү олз/гарзад бичигдэнэ.`,
      confirmText: "Хаах",
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await closePurchaseOrder({
            id: detail.id,
            closeDate,
          });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          feedback.posted("Захиалга хаагдаж, түр дансууд тэгшитгэгдлээ");
          setDirty(panel.id, false);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Захиалга хаагдсангүй");
        }
      });
    });
  }

  function reopenOrder() {
    if (!detail) return;
    void confirm({
      title: "Хаалтыг буцаах",
      description: `${detail.documentNo} захиалгын хаалтын журналыг урвуу мөрөөр буцааж, захиалгыг нээлттэй болгох уу?`,
      confirmText: "Буцаах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await reopenPurchaseOrder({ id: detail.id });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Захиалгын хаалт буцаагдлаа");
          setDirty(panel.id, false);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Хаалт буцаагдсангүй");
        }
      });
    });
  }

  function cancelOrder() {
    if (!detail) return;
    void confirm({
      title: "Захиалга цуцлах",
      description: `${detail.documentNo} захиалгыг цуцлах уу? Хүлээн авалт эсвэл нэхэмжлэх бүртгэгдсэн бол цуцлагдахгүй.`,
      confirmText: "Цуцлах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await cancelPurchaseOrder({ id: detail.id });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Захиалга цуцлагдлаа");
          setDirty(panel.id, false);
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Захиалга цуцлагдсангүй");
        }
      });
    });
  }

  function deleteOrder() {
    if (!detail) return;
    void confirm({
      title: "Ноорог захиалга устгах",
      description: `${detail.documentNo} ноорог захиалгыг устгах уу? Мөрүүд нь хамт устана.`,
      confirmText: "Устгах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await deletePurchaseOrder({ id: detail.id });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Ноорог захиалга устгагдлаа");
          setDirty(panel.id, false);
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Устгах амжилтгүй");
        }
      });
    });
  }

  /** Нэхэмжлэх үүсгэх — АР/АП панель PO-гийн нэхэмжлээгүй үлдэгдлээр бөглөгдөнө. */
  function createInvoice() {
    if (!detail) return;
    const lines = detail.lines
      .map((line) => {
        const quantity = remainingToInvoice({
          ordered: line.quantity,
          received: line.receivedQuantity,
          invoiced: line.invoicedQuantity,
          invoicedAmount: line.invoicedAmount,
          orderedAmount: line.amount,
        });
        return {
          purchaseOrderLineId: line.id,
          itemId: line.itemId,
          quantity,
          unitPrice: line.unitPrice,
          amount: roundMoney(quantity * line.unitPrice),
          warehouseId: line.warehouseId ?? undefined,
          description: line.description || `${line.itemCode} · ${line.itemName}`,
        };
      })
      .filter((line) => line.quantity > 0);
    if (lines.length === 0) {
      toast.error("Нэхэмжлээгүй үлдэгдэл алга");
      return;
    }
    const open = (exchangeRate?: number) =>
      openArapDocPanel({
        mode: "payable",
        prefill: {
          purchaseOrderId: detail.id,
          purchaseOrderNo: detail.documentNo,
          counterpartyId: detail.counterpartyId,
          currency: detail.currency,
          exchangeRate,
          date: data.today,
          description: `${detail.documentNo} — нийлүүлэгчийн нэхэмжлэх`,
          lines,
        },
      });
    if (detail.currency === "MNT") {
      open();
      return;
    }
    // Нэхэмжлэхийн ӨДРИЙН албан ханш (ханш зохиохгүй — татагдахгүй бол
    // хэрэглэгч панель дотор гараар оруулна).
    startTransition(async () => {
      const result = await fetchOfficialRate({
        currency: detail.currency,
        date: data.today,
      });
      if (result.error) {
        toast.error(`${result.error} — ханшийг гараар оруулна уу`);
        open();
        return;
      }
      open(result.rate);
    });
  }

  const receiptColumns = useMemo<ColDef<PurchaseOrderDetail["receipts"][number]>[]>(
    () => [
      { headerName: "Дугаар", field: "documentNo", minWidth: 150, cellClass: "font-mono text-xs" },
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Агуулах", field: "warehouseName", minWidth: 140 },
      {
        headerName: "Ханш",
        field: "exchangeRate",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => (params.value ? String(params.value) : ""),
      },
      {
        headerName: "Дүн (MNT)",
        field: "totalAmountMnt",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 130,
        cellRenderer: (p: { data?: GoodsReceiptView }) =>
          p.data ? (
            <StatusBadge tone={GR_STATUS_TONES[p.data.status]} size="sm">
              {GR_STATUS_LABELS[p.data.status]}
            </StatusBadge>
          ) : null,
      },
    ],
    []
  );

  const invoiceColumns = useMemo<ColDef<PurchaseOrderDetail["invoices"][number]>[]>(
    () => [
      { headerName: "Дугаар", field: "documentNo", minWidth: 150, cellClass: "font-mono text-xs" },
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      {
        headerName: `Дүн (${detail?.currency ?? "MNT"})`,
        field: "totalAmount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Дүн (MNT)",
        field: "baseTotalAmount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төрөл",
        field: "isCostInvoice",
        width: 130,
        valueFormatter: (params) =>
          params.value ? "Нэмэлт зардал" : "Барааны нэхэмжлэх",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 140,
        valueFormatter: (params) =>
          INVOICE_STATUS_LABELS[String(params.value ?? "")] ??
          String(params.value ?? ""),
      },
    ],
    [detail?.currency]
  );

  const costColumns = useMemo<ColDef<PurchaseOrderDetail["costLines"][number]>[]>(
    () => [
      { headerName: "Баримт", field: "documentNo", minWidth: 150, cellClass: "font-mono text-xs" },
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      { headerName: "Бүрэлдэхүүн", field: "costComponentName", minWidth: 150 },
      {
        headerName: "Дүн (MNT)",
        field: "amountMnt",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуваарилсан",
        field: "allocatedMnt",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "remainingMnt",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  const tabs: TabOption<PoTab>[] = [
    { value: "lines", label: "Мөрүүд" },
    {
      value: "receipts",
      label: `Хүлээн авалт${detail && detail.receipts.length > 0 ? ` (${detail.receipts.length})` : ""}`,
      disabled: isNew,
    },
    {
      value: "invoices",
      label: `Нэхэмжлэх${detail && detail.invoices.length > 0 ? ` (${detail.invoices.length})` : ""}`,
      disabled: isNew,
    },
    {
      value: "costs",
      label: `Зардал${detail && detail.costLines.length > 0 ? ` (${detail.costLines.length})` : ""}`,
      disabled: isNew,
    },
    {
      value: "attachments",
      label: `Хавсралт${detail && detail.attachmentCount > 0 ? ` (${detail.attachmentCount})` : ""}`,
      disabled: isNew,
    },
  ];

  const blockers = detail?.blockers ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={PO_STATUS_TONES[status]}>{PO_STATUS_LABELS[status]}</StatusBadge>
        {detail && (
          <>
            <span className="font-mono text-xs font-semibold text-[var(--ea-text-1)]">
              {detail.documentNo}
            </span>
            <span className="text-xs text-[var(--ea-text-3)]">
              Хүлээн авсан {detail.receivedPct}% · Нэхэмжилсэн{" "}
              {detail.invoicedPct}%
            </span>
          </>
        )}
        {isNew && (
          <span className="text-xs text-[var(--ea-text-3)]">
            Захиалга нь гүйлгээ биш — батлахад GL бичилт үүсэхгүй
          </span>
        )}
      </div>

      {/* Нийлүүлэгчийн карт — нээлттэй өглөг/өмнөх захиалга сервер талд
          тооцогдож ирдэг тул хадгалагдсан захиалгад л харуулна (ШИНЭ PO-д
          тоог зохиохгүй; нийлүүлэгчийн нэр/ТТД сонгогч дээр харагдана). */}
      {detail && <SupplierCard supplier={supplier} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Нийлүүлэгч">
          <CounterpartySelect
            value={form.counterpartyId}
            onChange={(value) =>
              setForm((current) => {
                const row = counterparties.find((entry) => entry.id === value);
                return {
                  ...current,
                  counterpartyId: value,
                  // Валют нь нийлүүлэгчийн default-аар бөглөгдөнө (шинэ PO).
                  currency: row?.defaultCurrency ?? current.currency,
                };
              })
            }
            counterparties={counterparties}
            mode="payable"
            placeholder="Нийлүүлэгч сонгох..."
            // Хадгалагдсан захиалгын нийлүүлэгч солигдохгүй (сервер ч засдаггүй).
            disabled={!isNew}
          />
        </Field>
        <Field label="Захиалгын дугаар">
          <Input
            value={form.documentNo}
            placeholder="Хоосон бол автоматаар үүснэ"
            maxLength={40}
            disabled={!isNew}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                documentNo: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Огноо">
          <Input
            type="date"
            value={form.date}
            disabled={!canEdit}
            onChange={(event) =>
              setForm((current) => ({ ...current, date: event.target.value }))
            }
          />
        </Field>
        <Field label="Хүргэх огноо">
          <Input
            type="date"
            value={form.expectedDate}
            disabled={!canEdit}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                expectedDate: event.target.value,
              }))
            }
          />
        </Field>
        <Field label="Валют">
          <Input
            value={form.currency}
            maxLength={3}
            // Валют нь бичилтийн суурь тул хадгалагдсаны дараа солигдохгүй.
            disabled={!isNew}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                currency: event.target.value.toUpperCase(),
              }))
            }
          />
        </Field>
        <Field label="Агуулах">
          <select
            className="ea-form-select"
            value={form.warehouseId}
            disabled={!canEdit}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                warehouseId: event.target.value,
              }))
            }
          >
            <option value="">— Мөр бүрд сонгоно —</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
        {foreign && (
          <div className="sm:col-span-2">
            <Field label="Албан ханш (мэдээлэл)">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rateBusy}
                  onClick={loadRateHint}
                >
                  <Icon
                    name={rateBusy ? "loading" : "refresh"}
                    size="sm"
                    className={rateBusy ? "animate-spin" : undefined}
                  />
                  Монголбанкны ханш
                </Button>
                <span className="text-xs text-[var(--ea-text-3)]">
                  {rateHint
                    ? `${rateHint.rateDate}: ${rateHint.rate} · ≈ ${fmtMnt(totalAmount * rateHint.rate)} MNT`
                    : "Барааны өртөг нь ХҮЛЭЭН АВСАН өдрийн ханшаар үнэлэгдэнэ"}
                </span>
              </div>
            </Field>
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label="Утга">
            <Input
              value={form.description}
              disabled={!canEdit}
              placeholder={
                supplierRow ? `${supplierRow.name} — худалдан авалт` : "Захиалгын тайлбар"
              }
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
            />
          </Field>
        </div>
      </div>

      <PageTabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        ariaLabel="Захиалгын хэсгүүд"
      />

      {tab === "lines" && (
        <div className="space-y-2">
          <DataGridDynamic<PoLineRow>
            rowData={form.lines}
            columnDefs={columns}
            getRowId={(params) => params.data.id}
            pinnedBottomRowData={pinnedTotals}
            onCellValueChanged={handleCellChange}
            height={Math.min(400, 120 + form.lines.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            singleClickEdit
          />
          <div className="flex items-center justify-between text-xs">
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    lines: [...current.lines, emptyPoLine(current.warehouseId)],
                  }))
                }
              >
                <Icon name="add" size="sm" />
                Мөр нэмэх
              </Button>
            ) : (
              <span className="text-[var(--ea-text-3)]">
                {status === "closed"
                  ? "Хаагдсан захиалга засагдахгүй"
                  : "Цуцлагдсан захиалга засагдахгүй"}
              </span>
            )}
            <span className="font-mono font-semibold text-[var(--ea-text-1)]">
              Нийт: {fmtMnt(totalAmount)} {form.currency}
            </span>
          </div>
        </div>
      )}

      {tab === "receipts" && detail && (
        <div className="space-y-2">
          {detail.receipts.length === 0 ? (
            <EmptyState
              icon="packageReceipt"
              title="Хүлээн авалт алга"
              description="Бараа ирмэгц «Хүлээн авалт үүсгэх» товчоор орлогыг бүртгэнэ — батлахад барааны нөөц хүлээн авсан өдрийн ханшаар үнэлэгдэнэ."
            />
          ) : (
            <DataGridDynamic<PurchaseOrderDetail["receipts"][number]>
              rowData={detail.receipts}
              columnDefs={receiptColumns}
              getRowId={(params) => params.data.id}
              height={Math.min(320, 120 + detail.receipts.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
              enableCellTextSelection
              onRowDoubleClicked={(
                event: RowDoubleClickedEvent<PurchaseOrderDetail["receipts"][number]>
              ) => {
                if (!event.data) return;
                openGoodsReceiptPanel({
                  receiptId: event.data.id,
                  title: event.data.documentNo,
                  navIds: detail.receipts.map((receipt) => receipt.id),
                });
              }}
            />
          )}
          <p className="text-[11px] text-[var(--ea-text-4)]">
            Мөр дээр давхар дарж хүлээн авалтын панелийг нээнэ.
          </p>
        </div>
      )}

      {tab === "invoices" && detail && (
        <div className="space-y-2">
          {detail.invoices.length === 0 ? (
            <EmptyState
              icon="document"
              title="Нэхэмжлэх алга"
              description="Нийлүүлэгчийн нэхэмжлэх ирэхэд «Нэхэмжлэх үүсгэх» товчоор бүртгэнэ — мөрүүд өглөгийн түр дансанд бичигдэнэ."
            />
          ) : (
            <DataGridDynamic<PurchaseOrderDetail["invoices"][number]>
              rowData={detail.invoices}
              columnDefs={invoiceColumns}
              getRowId={(params) => params.data.id}
              height={Math.min(320, 120 + detail.invoices.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
              enableCellTextSelection
              onRowDoubleClicked={(
                event: RowDoubleClickedEvent<PurchaseOrderDetail["invoices"][number]>
              ) => {
                if (!event.data) return;
                openArapDocPanel({
                  documentId: event.data.id,
                  mode: "payable",
                  title: event.data.documentNo,
                  navIds: detail.invoices.map((invoice) => invoice.id),
                });
              }}
            />
          )}
          <p className="text-[11px] text-[var(--ea-text-4)]">
            Мөр дээр давхар дарж нэхэмжлэхийн панелийг нээнэ.
          </p>
        </div>
      )}

      {tab === "costs" && detail && (
        <div className="space-y-2">
          {detail.costLines.length === 0 ? (
            <EmptyState
              icon="costing"
              title="Хуваарилагдаагүй зардал алга"
              description="Гааль, тээвэр, брокерын мөрүүд нэхэмжлэх дээр бүрэлдэхүүнтэйгээр бүртгэгдэхэд энд харагдана."
            />
          ) : (
            <DataGridDynamic<PurchaseOrderDetail["costLines"][number]>
              rowData={detail.costLines}
              columnDefs={costColumns}
              getRowId={(params) => params.data.lineId}
              height={Math.min(320, 120 + detail.costLines.length * 38)}
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
              enableCellTextSelection
            />
          )}
          <p className="text-[11px] text-[var(--ea-text-4)]">
            Хуваарилалтыг Хангамж → Хуваарилагдаагүй зардал дээр хийнэ (суурь:
            үнийн дүнгээр / тоо хэмжээгээр / гараар).
          </p>
        </div>
      )}

      {tab === "attachments" && detail && (
        <AttachmentList
          entityType={PO_BUSINESS_OBJECT}
          entityId={detail.id}
          // Хаагдсан захиалгад файл нэмж болно, устгахгүй (§7).
          canDelete={status !== "closed" && status !== "cancelled"}
          refreshToken={panel.refreshToken}
          onChanged={() => {
            refreshOpenPanels();
            router.refresh();
          }}
        />
      )}

      {/* Хаалтын нөхцөл — түр дансдын үлдэгдэл + blockers улаанаар */}
      {detail && (status === "open" || status === "closed") && (
        <div className="space-y-2 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-[var(--ea-text-1)]">
              Захиалгын хаалт
            </span>
            <span className="text-xs text-[var(--ea-text-3)]">
              Бараа мат. түр данс:{" "}
              <span className="font-mono">{fmtMnt(detail.clearing.inventory)}</span>
            </span>
            <span className="text-xs text-[var(--ea-text-3)]">
              Өглөгийн түр данс:{" "}
              <span className="font-mono">{fmtMnt(detail.clearing.payable)}</span>
            </span>
          </div>
          {status === "open" &&
            (blockers.length > 0 ? (
              <ul className="space-y-1">
                {blockers.map((blocker) => (
                  <li
                    key={blocker}
                    className="flex items-start gap-1.5 text-xs text-[var(--ea-danger-fg)]"
                  >
                    <Icon name="warning" size="xs" className="mt-0.5 shrink-0" />
                    {blocker}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-[var(--ea-success-fg)]">
                <Icon name="success" size="xs" />
                Бүх нөхцөл биелсэн — захиалгыг хааж түр дансуудыг тэгшитгэнэ.
              </p>
            ))}
          {status === "closed" && (
            <p className="text-xs text-[var(--ea-text-3)]">
              {detail.closedAt
                ? `Хаагдсан: ${detail.closedAt.slice(0, 10)} — түр дансууд тэгшитгэгдсэн.`
                : "Түр дансууд тэгшитгэгдсэн."}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>}

      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={requestClose} disabled={isPending}>
          Болих
        </Button>
        {detail?.closeVoucherId && (
          <Button
            variant="outline"
            onClick={() => openVoucherPanel(detail.closeVoucherId!)}
          >
            Хаалтын журнал
          </Button>
        )}
        {detail && status === "draft" && (
          <Button variant="outline" onClick={deleteOrder} disabled={isPending}>
            <Icon name="delete" size="sm" />
            Устгах
          </Button>
        )}
        {detail && (status === "draft" || status === "open") && (
          <Button variant="outline" onClick={cancelOrder} disabled={isPending}>
            <Icon name="cancel" size="sm" />
            Цуцлах
          </Button>
        )}
        {detail && status === "closed" && (
          <Button variant="outline" onClick={reopenOrder} disabled={isPending}>
            <Icon name="reset" size="sm" />
            Хаалт буцаах
          </Button>
        )}
        {detail && status === "open" && (
          <>
            <Input
              type="date"
              value={closeDate}
              aria-label="Хаах огноо"
              className="w-36"
              onChange={(event) => setCloseDate(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={closeOrder}
              disabled={isPending || blockers.length > 0 || dirty}
              title={
                blockers.length > 0
                  ? "Хаалтын нөхцөл биелээгүй"
                  : dirty
                    ? "Эхлээд өөрчлөлтөө хадгална уу"
                    : undefined
              }
            >
              <Icon name="locked" size="sm" />
              PO хаах
            </Button>
          </>
        )}
        {detail && status === "open" && (
          <>
            <Button
              variant="outline"
              onClick={() =>
                openGoodsReceiptPanel({ purchaseOrderId: detail.id })
              }
              disabled={isPending || dirty}
              title={dirty ? "Эхлээд өөрчлөлтөө хадгална уу" : undefined}
            >
              <Icon name="packageReceipt" size="sm" />
              Хүлээн авалт үүсгэх
            </Button>
            <Button
              variant="outline"
              onClick={createInvoice}
              disabled={isPending || dirty}
              title={dirty ? "Эхлээд өөрчлөлтөө хадгална уу" : undefined}
            >
              <Icon name="document" size="sm" />
              Нэхэмжлэх үүсгэх
            </Button>
          </>
        )}
        {canEdit && (
          <Button
            variant="outline"
            onClick={() => save(false)}
            disabled={isPending || (!isNew && !dirty)}
          >
            <Icon name="save" size="sm" />
            Хадгалах
          </Button>
        )}
        {(isNew || status === "draft") && (
          <Button onClick={() => save(true)} disabled={isPending}>
            <Icon name="approve" size="sm" />
            Батлах
          </Button>
        )}
      </div>
      {confirmDialog}
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
