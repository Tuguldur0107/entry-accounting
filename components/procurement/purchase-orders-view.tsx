"use client";

// Худалдан авалтын захиалгын (PO) жагсаалт — docs/procurement §3.7, гэрээ §11.
//
// Хүснэгт нь DataGridDynamic, статус StatusBadge, шүүлтүүр FilterChips
// (тоолуурын count-той), хоосон төлөв EmptyState, батлах диалог useConfirm —
// шинэ component бичихийг ХОРИГЛОНО.
//
// ДАВХАР даралт → PO панель (нэг даралт нь Excel-маягийн мужийн зангуу тул
// панель нээхгүй). Захиалга хаах / дахин нээх зэрэг ханшийн огноо шаардсан
// үйлдлүүд панель дотор — жагсаалтаас зөвхөн огноогүй шилжилтүүд.

import { useCallback, useMemo, useRef, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { SavedViewsMenu } from "@/components/datagrid/SavedViewsMenu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { FilterChips } from "@/components/ui/tabs";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  reopenPurchaseOrder,
} from "@/lib/actions/procurement";
import type {
  PurchaseOrderStatus,
  PurchaseOrderView,
} from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openPurchaseOrderPanel,
  refreshOpenPanels,
} from "@/lib/store/panel-store";

/** Панель, самбар мөн эдгээр шошгыг хэрэглэнэ — нэг л газар. */
export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Ноорог",
  open: "Нээлттэй",
  closed: "Хаагдсан",
  cancelled: "Цуцлагдсан",
};

// "Нээлттэй" нь анхаарал шаардсан төлөв: хүлээн авалттай нээлттэй захиалга
// сарын хаалтыг ХОРИГЛОДОГ (docs/procurement ⑧) тул warning өнгөтэй.
export const PO_STATUS_TONES: Record<PurchaseOrderStatus, StatusTone> = {
  draft: "muted",
  open: "warning",
  closed: "success",
  cancelled: "danger",
};

type StatusChip = "all" | PurchaseOrderStatus;

const STATUS_CHIPS: { value: StatusChip; label: string }[] = [
  { value: "all", label: "Бүх төлөв" },
  { value: "draft", label: PO_STATUS_LABELS.draft },
  { value: "open", label: PO_STATUS_LABELS.open },
  { value: "closed", label: PO_STATUS_LABELS.closed },
  { value: "cancelled", label: PO_STATUS_LABELS.cancelled },
];

/** Захиалгын дүн — PO валютаар (MNT бол мөнгөн формат). */
function fmtOrderAmount(order: PurchaseOrderView) {
  if (order.currency === "MNT") return fmtMnt(order.totalAmount);
  return `${order.totalAmount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })} ${order.currency}`;
}

interface Props {
  orders: PurchaseOrderView[];
  /** URL-ийн `?status=` шүүлтүүр. */
  initialStatus?: string;
  /** URL-ийн `?supplier=` шүүлтүүр (харилцагчийн id). */
  initialSupplier?: string;
}

export function PurchaseOrdersView({
  orders,
  initialStatus,
  initialSupplier,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const gridRef = useRef<DataGridHandle>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeStatus: StatusChip = STATUS_CHIPS.some(
    (chip) => chip.value === initialStatus
  )
    ? (initialStatus as StatusChip)
    : "all";

  // Нийлүүлэгчийн шүүлтүүр нь ЗАХИАЛГУУДААС гарна — тусдаа query хэрэггүй,
  // сонголт нь үргэлж бодит өгөгдөлтэй таарна.
  const supplierOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const order of orders)
      if (order.counterpartyId) byId.set(order.counterpartyId, order.counterpartyName);
    return [
      { value: "", label: "Бүх нийлүүлэгч" },
      ...[...byId.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [orders]);

  const activeSupplier =
    initialSupplier && supplierOptions.some((o) => o.value === initialSupplier)
      ? initialSupplier
      : "";

  const changeParam = useCallback(
    (key: "status" | "supplier", next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!next || next === "all") params.delete(key);
      else params.set(key, next);
      router.replace(
        `${pathname}${params.toString() ? `?${params.toString()}` : ""}`
      );
    },
    [pathname, router, searchParams]
  );

  // Нийлүүлэгчийн шүүлтүүр эхэлж хэрэглэгдэнэ — статусын тоолуур нь тухайн
  // нийлүүлэгчийн захиалгуудаас бодогдох ёстой.
  const supplierFiltered = useMemo(
    () =>
      activeSupplier
        ? orders.filter((order) => order.counterpartyId === activeSupplier)
        : orders,
    [orders, activeSupplier]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusChip, number> = {
      all: supplierFiltered.length,
      draft: 0,
      open: 0,
      closed: 0,
      cancelled: 0,
    };
    for (const order of supplierFiltered) counts[order.status] += 1;
    return counts;
  }, [supplierFiltered]);

  const visibleOrders = useMemo(
    () =>
      activeStatus === "all"
        ? supplierFiltered
        : supplierFiltered.filter((order) => order.status === activeStatus),
    [supplierFiltered, activeStatus]
  );

  const navIds = useMemo(
    () => visibleOrders.map((order) => order.id),
    [visibleOrders]
  );

  const openPanel = useCallback(
    (order: PurchaseOrderView) =>
      openPurchaseOrderPanel({
        purchaseOrderId: order.id,
        title: `${order.documentNo} · ${order.counterpartyName}`,
        navIds,
      }),
    [navIds]
  );

  const runAction = useCallback(
    (action: () => Promise<{ error?: string }>, successMessage: string) => {
      startTransition(async () => {
        try {
          const result = await action();
          if (result.error) {
            toast.error(result.error);
            return;
          }
          refreshOpenPanels();
          router.refresh();
          toast.success(successMessage);
        } catch {
          toast.error("Үйлдэл амжилтгүй");
        }
      });
    },
    [router]
  );

  const handleApprove = useCallback(
    async (order: PurchaseOrderView) => {
      const ok = await confirm({
        title: "Захиалга батлах",
        description: `${order.documentNo} захиалгыг батлаж нээлттэй болгох уу? Захиалга нь гүйлгээ биш тул GL бичилт үүсэхгүй — хүлээн авалт, нэхэмжлэх хийх боломжтой болно.`,
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(
        () => approvePurchaseOrder({ id: order.id }),
        `${order.documentNo} батлагдаж нээлттэй болов`
      );
    },
    [confirm, runAction]
  );

  const handleCancel = useCallback(
    async (order: PurchaseOrderView) => {
      const ok = await confirm({
        title: "Захиалга цуцлах",
        description: `${order.documentNo} захиалгыг цуцлах уу? Хүлээн авалт эсвэл нэхэмжлэх бүртгэгдсэн захиалгыг цуцлах боломжгүй.`,
        confirmText: "Цуцлах",
        danger: true,
      });
      if (!ok) return;
      runAction(
        () => cancelPurchaseOrder({ id: order.id }),
        `${order.documentNo} цуцлагдлаа`
      );
    },
    [confirm, runAction]
  );

  const handleDelete = useCallback(
    async (order: PurchaseOrderView) => {
      const ok = await confirm({
        title: "Ноорог захиалга устгах",
        description: `${order.documentNo} ноорог захиалгыг мөрүүдтэй нь бүрмөсөн устгах уу?`,
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(
        () => deletePurchaseOrder({ id: order.id }),
        `${order.documentNo} устгагдлаа`
      );
    },
    [confirm, runAction]
  );

  const handleReopen = useCallback(
    async (order: PurchaseOrderView) => {
      const ok = await confirm({
        title: "Захиалгын хаалтыг буцаах",
        description: `${order.documentNo} захиалгын хаалтын журналыг эсрэг мөрөөр буцааж дахин нээх уу? Түр дансдын үлдэгдэл сэргэнэ.`,
        confirmText: "Хаалт буцаах",
        danger: true,
      });
      if (!ok) return;
      runAction(
        () => reopenPurchaseOrder({ id: order.id }),
        `${order.documentNo} дахин нээгдлээ`
      );
    },
    [confirm, runAction]
  );

  const columnDefs = useMemo<ColDef<PurchaseOrderView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Захиалгын №",
        field: "documentNo",
        minWidth: 170,
        cellClass: "font-mono text-xs",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) => {
          const order = params.data;
          if (!order) return null;
          return (
            <span className="flex h-full items-center gap-1.5">
              <span className="truncate">{order.documentNo}</span>
              {order.attachmentCount > 0 && (
                <span
                  className="flex shrink-0 items-center gap-0.5 text-[10px] text-[var(--ea-text-3)]"
                  title={`${order.attachmentCount} хавсралт`}
                >
                  <Icon name="attach" size="xs" />
                  {order.attachmentCount}
                </span>
              )}
            </span>
          );
        },
      },
      {
        headerName: "Нийлүүлэгч",
        field: "counterpartyName",
        minWidth: 180,
        flex: 1,
      },
      {
        headerName: "Хүлээгдэх",
        field: "expectedDate",
        width: 112,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => String(params.value ?? "—"),
      },
      {
        headerName: "Агуулах",
        field: "warehouseName",
        width: 140,
        valueFormatter: (params) => String(params.value ?? "—"),
      },
      {
        headerName: "Утга",
        field: "description",
        minWidth: 160,
        flex: 1,
      },
      {
        headerName: "Дүн",
        field: "totalAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.data ? fmtOrderAmount(params.data) : "",
      },
      {
        headerName: "Хүлээн авсан",
        field: "receivedPct",
        width: 124,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) =>
          params.data ? (
            <ProgressCell pct={params.data.receivedPct} status={params.data.status} />
          ) : null,
      },
      {
        headerName: "Нэхэмжилсэн",
        field: "invoicedPct",
        width: 124,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) =>
          params.data ? (
            <ProgressCell pct={params.data.invoicedPct} status={params.data.status} />
          ) : null,
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 124,
        valueGetter: (params) =>
          params.data ? PO_STATUS_LABELS[params.data.status] : "",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) => {
          const order = params.data;
          if (!order) return null;
          return (
            <span className="flex h-full items-center">
              <StatusBadge tone={PO_STATUS_TONES[order.status]} size="sm">
                {PO_STATUS_LABELS[order.status]}
              </StatusBadge>
            </span>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 148,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<PurchaseOrderView>) => {
          const order = params.data;
          if (!order) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="ea-btn ea-btn--icon"
                title="Дэлгэрэнгүй нээх"
                aria-label="Дэлгэрэнгүй нээх"
                onClick={() => openPanel(order)}
              >
                <Icon name="openDetail" />
              </button>
              {order.status === "draft" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--success"
                  title="Захиалгыг батлах"
                  aria-label="Захиалгыг батлах"
                  onClick={() => handleApprove(order)}
                >
                  <Icon name="approve" />
                </button>
              )}
              {order.status === "closed" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Хаалтыг буцаах"
                  aria-label="Хаалтыг буцаах"
                  onClick={() => handleReopen(order)}
                >
                  <Icon name="reset" />
                </button>
              )}
              {(order.status === "draft" || order.status === "open") && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--danger"
                  title="Захиалгыг цуцлах"
                  aria-label="Захиалгыг цуцлах"
                  onClick={() => handleCancel(order)}
                >
                  <Icon name="cancel" />
                </button>
              )}
              {order.status === "draft" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--danger"
                  title="Ноорог устгах"
                  aria-label="Ноорог устгах"
                  onClick={() => handleDelete(order)}
                >
                  <Icon name="delete" />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [handleApprove, handleCancel, handleDelete, handleReopen, openPanel]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Худалдан авалтын захиалга
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Захиалга нь гүйлгээ биш — GL бичилт хүлээн авалт, нэхэмжлэхээс
            үүснэ. Мөр дээр давхар дарж дэлгэрэнгүйг нээнэ.
          </p>
        </div>
        <Button onClick={() => openPurchaseOrderPanel()}>
          <Icon name="add" />
          Захиалга үүсгэх
        </Button>
      </div>

      {orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChips
            options={STATUS_CHIPS.map((chip) => ({
              value: chip.value,
              label: chip.label,
              count: chip.value !== "all" ? statusCounts[chip.value] : undefined,
              tone:
                chip.value === "draft" && statusCounts.draft > 0
                  ? ("warning" as const)
                  : undefined,
            }))}
            value={activeStatus}
            onChange={(next) => changeParam("status", next)}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <div className="w-56">
              <SearchableSelect
                value={activeSupplier}
                onChange={(next) => changeParam("supplier", next)}
                options={supplierOptions}
                placeholder="Бүх нийлүүлэгч"
                hideValue
              />
            </div>
            <SavedViewsMenu surfaceId="procurement-orders" gridRef={gridRef} />
          </div>
        </div>
      )}

      {visibleOrders.length === 0 ? (
        orders.length === 0 ? (
          <EmptyState
            icon="purchaseOrder"
            title="Худалдан авалтын захиалгаа бүртгэж эхлээрэй"
            description="Захиалга үүсгээд батласны дараа хүлээн авалт, нийлүүлэгчийн нэхэмжлэх, нэмэлт зардлын хуваарилалт нэг объектоор хянагдана."
            actions={[
              {
                label: "Захиалга үүсгэх",
                onClick: () => openPurchaseOrderPanel(),
                icon: "add",
                primary: true,
              },
              {
                label: "Нийлүүлэгч нэмэх",
                href: "/payables/counterparties",
                icon: "company",
              },
              {
                label: "Түр дансны тохиргоо",
                href: "/costing/settings",
                icon: "settings",
              },
            ]}
          />
        ) : (
          <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Шүүлтүүрт таарах захиалга байхгүй
          </div>
        )
      ) : (
        <DataGridDynamic<PurchaseOrderView>
          ref={gridRef}
          rowData={visibleOrders}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visibleOrders.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={(event) => {
            // Үйлдлийн багана болон AG Grid-ийн өөрийн багануудад панель
            // нээхгүй — тэдгээр нь өөрийн зан төлөвтэй.
            const colId = event.column.getColId();
            if (colId === "actions" || colId.startsWith("ag-Grid")) return;
            if (event.data) openPanel(event.data);
          }}
        />
      )}

      {isPending && (
        <p className="text-[11px] text-[var(--ea-text-4)]">
          Үйлдэл гүйцэтгэж байна...
        </p>
      )}

      {confirmDialog}
    </section>
  );
}

/**
 * Хүлээн авсан / нэхэмжилсэн хувь. Нээлттэй захиалгад 100%-аас доогуур нь
 * хаалтын хориг тул анхааруулгын өнгөтэй (АВТОМАТААР нөхөхийг хориглоно —
 * зөрүү ИЛ харагдана, docs/cost README 0.6).
 */
function ProgressCell({
  pct,
  status,
}: {
  pct: number;
  status: PurchaseOrderStatus;
}) {
  const complete = pct >= 99.995;
  const attention = status === "open" && !complete;
  return (
    <span
      className="flex h-full items-center justify-end"
      style={{
        color: attention
          ? "var(--ea-warning-fg)"
          : complete
            ? "var(--ea-success-fg)"
            : "var(--ea-text-3)",
      }}
    >
      {pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%
    </span>
  );
}
