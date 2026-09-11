"use client";

// Хүлээн авалтын (goods receipt) ПАНЕЛЬ — захиалгаас шинээр үүсгэх
// (purchaseOrderId) эсвэл байгаа баримтыг харах/засах (receiptId).
// Payload: { receiptId?: string; purchaseOrderId?: string }.
//
// Хэв маяг нь components/panel/arap-doc-panel.tsx-тэй ИЖИЛ: load →
// PanelLoading/PanelError → форм → dirty guard (setDirty) → setTitle →
// хадгалах/батлах товчнууд. Бүх элемент ui-kit-ээс, хүснэгт нь
// DataGridDynamic — ШИНЭ component/icon/хүснэгт бичихийг ХОРИГЛОНО.
//
// Бичилт (docs/procurement §3.3 ②): батлахад тоо × PO нэгж үнэ × ХҮЛЭЭН АВСАН
// ӨДРИЙН Монголбанкны албан ханшаар барааны нөөц капиталжиж, бараа
// материалын түр данс кредитлэгдэнэ. Ханш ХЭЗЭЭ Ч зохиогдохгүй — татагдахгүй
// бол хэрэглэгч гараар оруулна.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { AttachmentList } from "@/components/attachments/attachment-list";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { PanelError, PanelLoading } from "@/components/panel/panel-states";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  confirmGoodsReceipt,
  createGoodsReceipt,
  deleteGoodsReceipt,
  fetchOfficialRate,
  getGoodsReceiptPanelData,
  reverseGoodsReceipt,
  updateGoodsReceipt,
} from "@/lib/actions/procurement";
import { roundMoney } from "@/lib/arap/accounting";
import type {
  GoodsReceiptPanelData,
  GoodsReceiptStatus,
} from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openPurchaseOrderPanel,
  openVoucherPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { feedback } from "@/lib/ui/feedback";

/** Хавсралтын entityType — аудитын entityType-тай ижил (lib/audit). */
const GR_ENTITY_TYPE = "goods_receipt";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Хүлээн авалт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

const STATUS_LABELS: Record<GoodsReceiptStatus, string> = {
  draft: "Ноорог",
  confirmed: "Батлагдсан",
  reversed: "Буцаагдсан",
};

const STATUS_TONES: Record<GoodsReceiptStatus, StatusTone> = {
  draft: "muted",
  confirmed: "success",
  reversed: "danger",
};

export function GoodsReceiptPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const receiptId = panel.payload.receiptId as string | undefined;
  const purchaseOrderId = panel.payload.purchaseOrderId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: GoodsReceiptPanelData; loadedToken: number }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна; хадгалаагүй
  // өөрчлөлттэй үед алгасна (arap-doc-panel.tsx-ийн хэв маяг).
  useEffect(() => {
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getGoodsReceiptPanelData({ receiptId, purchaseOrderId })
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
        const { receipt, purchaseOrder } = result.data;
        if (receipt)
          setTitle(panel.id, `${receipt.documentNo} · ${receipt.purchaseOrderNo}`);
        else if (purchaseOrder)
          setTitle(panel.id, `Хүлээн авалт — ${purchaseOrder.documentNo}`);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [receiptId, purchaseOrderId, refreshToken, panel.id, setTitle]);

  if (state.status === "loading") return <PanelLoading />;
  if (state.status === "error") return <PanelError message={state.message} />;

  // Захиалгагүй бол хүлээн авалт бүртгэх боломжгүй (баримт нь PO-д харьяалагдана).
  if (!state.data.purchaseOrder)
    return (
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <EmptyState
          icon="packageReceipt"
          title="Захиалга сонгогдоогүй"
          description="Хүлээн авалт нь худалдан авалтын захиалгад (PO) харьяалагдана — захиалгын панелиас «Хүлээн авалт үүсгэх» товчоор нээнэ үү."
        />
      </div>
    );

  return (
    <GoodsReceiptBody
      // Шинэ өгөгдөл татагдмагц формыг цэвэрхэн remount хийнэ.
      key={state.loadedToken}
      panel={panel}
      data={state.data}
      requestClose={requestClose}
    />
  );
}

// ── Форм ────────────────────────────────────────────────────────────────────

/** Grid-ийн мөр — PO мөрийн үлдэгдэл + хүлээн авах тоо. */
type GrLineRow = {
  /** Grid-ийн түлхүүр — PO мөрийн id (баримт бүрд давхардахгүй). */
  id: string;
  purchaseOrderLineId: string;
  label: string;
  unit: string;
  /** PO нэгж үнэ (PO валют) — өртгийн суурь. */
  unitPrice: number;
  orderedQuantity: number;
  receivedQuantity: number;
  /** Хүлээн авах боломжит үлдэгдэл (батлагдсан орлогуудыг хассан). */
  remainingQuantity: number;
  quantity: number;
  /** Батлагдсан баримтын хадгалагдсан дүн (MNT) — байвал үүнийг үзүүлнэ. */
  storedAmountMnt?: number;
};

type GrFormState = {
  documentNo: string;
  date: string;
  warehouseId: string;
  /** Хоосон бол сервер тухайн өдрийн албан ханшийг өөрөө татна. */
  exchangeRate: string;
  description: string;
  lines: GrLineRow[];
};

function GoodsReceiptBody({
  panel,
  data,
  requestClose,
}: {
  panel: PanelInstance;
  data: GoodsReceiptPanelData;
  requestClose: () => void;
}) {
  const router = useRouter();
  const closePanel = usePanelStore((state) => state.closePanel);
  const setDirty = usePanelStore((state) => state.setDirty);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [rateBusy, setRateBusy] = useState(false);

  const { receipt, purchaseOrder, warehouses, remaining } = data;
  // purchaseOrder нь эцэг component-д шалгагдсан (null бол энд хүрэхгүй).
  const order = purchaseOrder!;
  const status: GoodsReceiptStatus = receipt?.status ?? "draft";
  const isNew = !receipt;
  /** Зөвхөн ноорог засагдана (сервер мөн шалгана). */
  const canEdit = isNew || status === "draft";
  const currency = order.currency;

  const remainingByLine = useMemo(
    () => new Map(remaining.map((line) => [line.purchaseOrderLineId, line])),
    [remaining]
  );

  const [form, setForm] = useState<GrFormState>(() => {
    const receiptQty = new Map(
      (receipt?.lines ?? []).map((line) => [line.purchaseOrderLineId, line])
    );
    const lines: GrLineRow[] = canEdit
      ? remaining.map((line) => ({
          id: line.purchaseOrderLineId,
          purchaseOrderLineId: line.purchaseOrderLineId,
          label: `${line.itemCode} · ${line.itemName}`,
          unit: line.unit,
          unitPrice: line.unitPrice,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          remainingQuantity: line.remainingQuantity,
          // Шинэ баримт — хүлээн аваагүй үлдэгдэл бүхэлдээ; ноорог — өөрийн тоо.
          quantity: receipt
            ? Number(receiptQty.get(line.purchaseOrderLineId)?.quantity ?? 0)
            : line.remainingQuantity,
        }))
      : (receipt?.lines ?? []).map((line) => {
          const base = remainingByLine.get(line.purchaseOrderLineId);
          return {
            id: line.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            label: `${line.itemCode} · ${line.itemName}`,
            unit: base?.unit ?? "",
            unitPrice: line.unitPrice,
            orderedQuantity: base?.orderedQuantity ?? 0,
            receivedQuantity: base?.receivedQuantity ?? 0,
            remainingQuantity: base?.remainingQuantity ?? 0,
            quantity: line.quantity,
            storedAmountMnt: line.amountMnt,
          };
        });
    return {
      documentNo: receipt?.documentNo ?? "",
      date: receipt?.date ?? data.today,
      warehouseId: receipt?.warehouseId ?? order.warehouseId ?? "",
      exchangeRate: receipt
        ? String(receipt.exchangeRate)
        : currency === "MNT"
          ? "1"
          : "",
      description: receipt?.description ?? `${order.documentNo} — хүлээн авалт`,
      lines,
    };
  });

  // Хадгалаагүй өөрчлөлтийн хамгаалалт — эхний render-ийн snapshot-той харьцуулна.
  const currentSnapshot = JSON.stringify(form);
  const [baseline, setBaseline] = useState(currentSnapshot);
  const dirty = currentSnapshot !== baseline;

  useEffect(() => {
    setDirty(panel.id, dirty);
  }, [dirty, panel.id, setDirty]);

  const rate = Number(form.exchangeRate) > 0 ? Number(form.exchangeRate) : 0;
  const activeLines = form.lines.filter((line) => Number(line.quantity) > 0);
  const totalAmountMnt = roundMoney(
    form.lines.reduce(
      (sum, line) =>
        sum +
        (line.storedAmountMnt != null
          ? Number(line.storedAmountMnt)
          : roundMoney(Number(line.quantity || 0) * line.unitPrice * rate)),
      0
    )
  );
  const totalQuantity = form.lines.reduce(
    (sum, line) => sum + Number(line.quantity || 0),
    0
  );

  const columns = useMemo<ColDef<GrLineRow>[]>(
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
        field: "label",
        minWidth: 200,
        flex: 1,
        cellClass: (p) =>
          p.node?.rowPinned ? "font-semibold text-[var(--ea-text-1)]" : "",
        valueFormatter: (params) =>
          params.node?.rowPinned ? "Нийт" : String(params.value ?? ""),
      },
      {
        headerName: "Нэгж",
        field: "unit",
        width: 72,
        cellClass: "text-xs text-[var(--ea-text-3)]",
        valueFormatter: (params) =>
          params.node?.rowPinned ? "" : String(params.value ?? ""),
      },
      {
        headerName: "Захиалсан",
        field: "orderedQuantity",
        width: 104,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.node?.rowPinned ? "" : String(params.value ?? 0),
      },
      {
        headerName: "Хүлээн авсан",
        field: "receivedQuantity",
        width: 116,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.node?.rowPinned ? "" : String(params.value ?? 0),
      },
      {
        headerName: "Үлдэгдэл",
        field: "remainingQuantity",
        width: 104,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.node?.rowPinned ? "" : String(params.value ?? 0),
      },
      {
        headerName: "Хүлээн авах",
        field: "quantity",
        width: 118,
        editable: canEdit,
        cellClass: (p) =>
          p.node?.rowPinned
            ? "ag-right-aligned-cell font-mono font-semibold"
            : "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueParser: (params) => {
          const value = Number(String(params.newValue).replaceAll(",", ""));
          return Number.isFinite(value) && value > 0 ? value : 0;
        },
        valueFormatter: (params) =>
          params.value ? String(params.value) : params.node?.rowPinned ? "" : "0",
      },
      {
        headerName: `Нэгж үнэ (${currency})`,
        field: "unitPrice",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.node?.rowPinned || !params.value
            ? ""
            : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Өртөг (MNT)",
        colId: "amountMnt",
        width: 150,
        cellClass: (p) =>
          p.node?.rowPinned
            ? "ag-right-aligned-cell font-mono font-semibold"
            : "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueGetter: (p) => {
          if (!p.data) return 0;
          if (p.node?.rowPinned) return p.data.storedAmountMnt ?? 0;
          if (p.data.storedAmountMnt != null) return p.data.storedAmountMnt;
          return roundMoney(Number(p.data.quantity || 0) * p.data.unitPrice * rate);
        },
        valueFormatter: (params) =>
          params.value ? fmtMnt(Number(params.value)) : "",
      },
    ],
    [canEdit, currency, rate]
  );

  const pinnedTotals = useMemo<GrLineRow[]>(
    () => [
      {
        id: "__totals__",
        purchaseOrderLineId: "",
        label: "",
        unit: "",
        unitPrice: 0,
        orderedQuantity: 0,
        receivedQuantity: 0,
        remainingQuantity: 0,
        quantity: roundMoney(totalQuantity),
        storedAmountMnt: totalAmountMnt,
      },
    ],
    [totalAmountMnt, totalQuantity]
  );

  function handleCellChange(event: CellValueChangedEvent<GrLineRow>) {
    const field = event.colDef.field as keyof GrLineRow | undefined;
    if (field !== "quantity") return;
    const value = Number(event.newValue ?? 0);
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.id === event.data.id
          ? { ...line, quantity: Number.isFinite(value) && value > 0 ? value : 0 }
          : line
      ),
    }));
  }

  /** Монголбанкны албан ханш татах — client шууд fetch хийхгүй (§5). */
  function loadRate() {
    setRateBusy(true);
    void fetchOfficialRate({ currency, date: form.date })
      .then((result) => {
        if (result.error || result.rate == null) {
          toast.error(result.error ?? "Ханш татагдсангүй");
          return;
        }
        setForm((current) => ({
          ...current,
          exchangeRate: String(result.rate),
        }));
        toast.success(`${result.rateDate} — албан ханш ${result.rate}`);
      })
      .catch(() => toast.error("Ханш татагдсангүй"))
      .finally(() => setRateBusy(false));
  }

  function validate(): string {
    if (!form.date) return "Огноо оруулна уу";
    if (!form.warehouseId) return "Агуулах сонгоно уу";
    if (form.exchangeRate.trim() && !(Number(form.exchangeRate) > 0))
      return "Ханш 0-ээс их байна";
    if (activeLines.length === 0)
      return "Дор хаяж нэг мөрөнд хүлээн авах тоо оруулна уу";
    const over = activeLines.find(
      (line) => Number(line.quantity) > line.remainingQuantity + 0.00005
    );
    if (over)
      return `${over.label}: хүлээн авах үлдэгдэл ${over.remainingQuantity}`;
    return "";
  }

  function payload() {
    return {
      date: form.date,
      warehouseId: form.warehouseId || undefined,
      exchangeRate: form.exchangeRate.trim()
        ? Number(form.exchangeRate)
        : undefined,
      description: form.description,
      lines: activeLines.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantity: Number(line.quantity),
      })),
    };
  }

  /** Хадгалсны дараа: dirty-г цэвэрлээд панелиудыг сэргээнэ. */
  function markSaved(snapshot: string) {
    setBaseline(snapshot);
    setDirty(panel.id, false);
    refreshOpenPanels();
    router.refresh();
  }

  function save(confirmNow: boolean) {
    const message = validate();
    if (message) {
      setError(message);
      return;
    }
    setError("");
    const snapshot = JSON.stringify(form);
    startTransition(async () => {
      try {
        if (isNew) {
          const result = await createGoodsReceipt({
            purchaseOrderId: order.id,
            documentNo: form.documentNo.trim() || undefined,
            confirmNow,
            ...payload(),
          });
          if (result.error) {
            setError(result.error);
            return;
          }
          if (confirmNow)
            feedback.posted("Хүлээн авалт батлагдаж, бараа капиталжлаа");
          else feedback.saved("Ноорог хүлээн авалт хадгалагдлаа");
          setDirty(panel.id, false);
          closePanel(panel.id);
          refreshOpenPanels();
          router.refresh();
          return;
        }

        if (dirty) {
          const updated = await updateGoodsReceipt({
            id: receipt!.id,
            ...payload(),
          });
          if (updated.error) {
            setError(updated.error);
            return;
          }
        }
        if (confirmNow) {
          const confirmed = await confirmGoodsReceipt({ id: receipt!.id });
          if (confirmed.error) {
            setError(confirmed.error);
            markSaved(snapshot);
            return;
          }
          feedback.posted("Хүлээн авалт батлагдаж, бараа капиталжлаа");
        } else {
          feedback.saved("Хүлээн авалт хадгалагдлаа");
        }
        markSaved(snapshot);
      } catch {
        setError("Хадгалж чадсангүй");
      }
    });
  }

  function confirmDraft() {
    void confirm({
      title: "Хүлээн авалт батлах",
      description: `${
        receipt?.documentNo ?? order.documentNo
      } хүлээн авалтыг батлах уу? Бараа материалын орлого үүсэж, тоо × PO нэгж үнэ × ханшаар (${
        rate || "албан ханш"
      }) капиталжиж, бараа материалын түр данс кредитлэгдэнэ.`,
      confirmText: "Батлах",
    }).then((ok) => {
      if (!ok) return;
      save(true);
    });
  }

  function reverseConfirmed() {
    if (!receipt) return;
    void confirm({
      title: "Хүлээн авалт буцаах",
      description: `${receipt.documentNo} батлагдсан хүлээн авалтыг буцаах уу? Орлого цуцлагдаж, GL-д урвуу журнал бичигдэнэ. (Буцаавал үлдэгдэл хасах болох тохиолдолд татгалзана.)`,
      confirmText: "Буцаах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await reverseGoodsReceipt({ id: receipt.id });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Хүлээн авалт буцаагдаж, урвуу журнал бичигдлээ");
          setDirty(panel.id, false);
          refreshOpenPanels();
          router.refresh();
        } catch {
          toast.error("Буцаах амжилтгүй");
        }
      });
    });
  }

  function deleteDraft() {
    if (!receipt) return;
    void confirm({
      title: "Ноорог устгах",
      description: `${receipt.documentNo} ноорог хүлээн авалтыг устгах уу? Мөрүүд нь хамт устана.`,
      confirmText: "Устгах",
      danger: true,
    }).then((ok) => {
      if (!ok) return;
      startTransition(async () => {
        try {
          const result = await deleteGoodsReceipt({ id: receipt.id });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Ноорог хүлээн авалт устгагдлаа");
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONES[status]}>
          {STATUS_LABELS[status]}
        </StatusBadge>
        {receipt && (
          <span className="font-mono text-xs font-semibold text-[var(--ea-text-1)]">
            {receipt.documentNo}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => openPurchaseOrderPanel({ purchaseOrderId: order.id })}
          title="Захиалгын панелийг нээх"
        >
          <Icon name="openDetail" size="sm" />
          {order.documentNo} · {order.counterpartyName}
        </Button>
        <span className="text-xs text-[var(--ea-text-3)]">
          Валют {currency}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Баримтын дугаар">
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
        <Field label="Хүлээн авсан огноо">
          <Input
            type="date"
            value={form.date}
            disabled={!canEdit}
            onChange={(event) =>
              setForm((current) => ({ ...current, date: event.target.value }))
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
            <option value="">— Сонгох —</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.code} · {warehouse.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`${currency}/MNT албан ханш`}>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0.00000001"
              step="0.00000001"
              value={form.exchangeRate}
              placeholder="Татах эсвэл гараар"
              disabled={!canEdit || currency === "MNT"}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  exchangeRate: event.target.value,
                }))
              }
            />
            {canEdit && currency !== "MNT" && (
              <Button
                variant="outline"
                size="icon"
                disabled={rateBusy}
                onClick={loadRate}
                title="Монголбанкны албан ханш татах"
                aria-label="Монголбанкны албан ханш татах"
              >
                <Icon
                  name={rateBusy ? "loading" : "refresh"}
                  size="sm"
                  className={rateBusy ? "animate-spin" : undefined}
                />
              </Button>
            )}
          </div>
        </Field>
        <div className="sm:col-span-2 lg:col-span-4">
          <Field label="Утга">
            <Input
              value={form.description}
              disabled={!canEdit}
              placeholder={`${order.documentNo} — хүлээн авалт`}
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

      {receipt?.rateDate && (
        <p className="text-[11px] text-[var(--ea-text-4)]">
          Ханшийн огноо: <span className="font-mono">{receipt.rateDate}</span> —
          барааны өртөг хүлээн авсан өдрийн албан ханшаар үнэлэгдсэн.
        </p>
      )}

      <div>
        <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
          Мөрүүд — захиалгын хүлээн аваагүй үлдэгдэл
        </div>
        {form.lines.length === 0 ? (
          <EmptyState
            icon="packageReceipt"
            title="Хүлээн авах үлдэгдэл алга"
            description="Захиалга бүхэлдээ хүлээн авагдсан байна."
          />
        ) : (
          <DataGridDynamic<GrLineRow>
            rowData={form.lines}
            columnDefs={columns}
            getRowId={(params) => params.data.id}
            pinnedBottomRowData={pinnedTotals}
            onCellValueChanged={handleCellChange}
            height={Math.min(380, 120 + form.lines.length * 38)}
            wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
            singleClickEdit
          />
        )}
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-[var(--ea-text-3)]">
            Өртөг = тоо × захиалгын нэгж үнэ × ханш (Dr барааны нөөц / Cr бараа
            материалын түр данс)
          </span>
          <span className="font-mono font-semibold text-[var(--ea-text-1)]">
            Нийт өртөг: {fmtMnt(totalAmountMnt)} MNT
          </span>
        </div>
      </div>

      {receipt && (
        <div>
          <div className="mb-2 text-sm font-semibold text-[var(--ea-text-1)]">
            Хавсралт
          </div>
          <AttachmentList
            entityType={GR_ENTITY_TYPE}
            entityId={receipt.id}
            canDelete={status !== "reversed"}
            refreshToken={panel.refreshToken}
            onChanged={() => {
              refreshOpenPanels();
              router.refresh();
            }}
          />
        </div>
      )}

      {error && <p className="text-xs text-[var(--ea-danger-fg)]">{error}</p>}

      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--ea-border)] pt-3">
        <Button variant="outline" onClick={requestClose} disabled={isPending}>
          Болих
        </Button>
        {receipt?.voucherId && (
          <Button
            variant="outline"
            onClick={() => openVoucherPanel(receipt.voucherId!)}
          >
            GL журнал
          </Button>
        )}
        {receipt && status === "draft" && (
          <Button variant="outline" onClick={deleteDraft} disabled={isPending}>
            <Icon name="delete" size="sm" />
            Устгах
          </Button>
        )}
        {receipt && status === "confirmed" && (
          <Button
            variant="outline"
            onClick={reverseConfirmed}
            disabled={isPending}
          >
            <Icon name="reset" size="sm" />
            Буцаах
          </Button>
        )}
        {canEdit && (
          <>
            <Button
              variant="outline"
              onClick={() => save(false)}
              disabled={isPending || (!isNew && !dirty)}
            >
              <Icon name="save" size="sm" />
              Хадгалах
            </Button>
            <Button onClick={confirmDraft} disabled={isPending}>
              <Icon name="approve" size="sm" />
              Батлах
            </Button>
          </>
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
