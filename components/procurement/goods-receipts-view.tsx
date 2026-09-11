"use client";

// Хүлээн авалтын (goods receipt) жагсаалт — docs/procurement §3.3 ②, гэрээ §11.
//
// Батлахад орлогын хөдөлгөөн (sourceType `po_receipt`) + АВТОМАТ
// `receipt_capitalize` бичилт үүсч, бараа ХҮЛЭЭН АВСАН ӨДРИЙН Монголбанкны
// албан ханшаар үнэлэгдэнэ. Тиймээс ханшийн багана нь зөвхөн мэдээлэл биш —
// өртгийн суурь.
//
// `po_receipt` хөдөлгөөнийг бараа материалын модулиас засах/устгах ХОРИОТОЙ —
// буцаалт нь ЗӨВХӨН энэ дэлгэц (эсвэл хүлээн авалтын панель) дээрээс.
//
// ДАВХАР даралт → хүлээн авалтын панель.
//
// Шүүлтүүр / тоолуур / URL параметр / үйлдлийн transition нь Захиалгын
// жагсаалттай ХУВААЛЦСАН `components/procurement/list-toolbar.tsx`-д —
// хуудас бүрд давхардуулан бичихийг ХОРИГЛОНО.

import { useCallback, useMemo, useRef } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import {
  ListToolbar,
  useListAction,
  useListFilters,
  type ListStatusChip,
} from "@/components/procurement/list-toolbar";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { LinkButton } from "@/components/ui/link-button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  confirmGoodsReceipt,
  deleteGoodsReceipt,
  reverseGoodsReceipt,
} from "@/lib/actions/procurement";
import type {
  GoodsReceiptStatus,
  GoodsReceiptView,
} from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  GR_STATUS_LABELS,
  GR_STATUS_TONES,
} from "@/lib/procurement/labels";
import { openGoodsReceiptPanel } from "@/lib/store/panel-store";

const STATUS_CHIPS: readonly ListStatusChip<GoodsReceiptStatus>[] = [
  { value: "all", label: "Бүх төлөв" },
  { value: "draft", label: GR_STATUS_LABELS.draft },
  { value: "confirmed", label: GR_STATUS_LABELS.confirmed },
  { value: "reversed", label: GR_STATUS_LABELS.reversed },
];

const statusOf = (receipt: GoodsReceiptView) => receipt.status;

// Захиалгын шүүлтүүр нь хүлээн авалтуудаас гарна — тусдаа query хэрэггүй.
const orderOf = (receipt: GoodsReceiptView) =>
  receipt.purchaseOrderId
    ? {
        value: receipt.purchaseOrderId,
        label: `${receipt.purchaseOrderNo} · ${receipt.counterpartyName}`,
      }
    : null;

interface Props {
  receipts: GoodsReceiptView[];
  /** URL-ийн `?status=` шүүлтүүр. */
  initialStatus?: string;
  /** URL-ийн `?po=` шүүлтүүр (захиалгын id). */
  initialPoId?: string;
}

export function GoodsReceiptsView({
  receipts,
  initialStatus,
  initialPoId,
}: Props) {
  const gridRef = useRef<DataGridHandle>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { isPending, runAction } = useListAction();

  const {
    activeStatus,
    statusCounts,
    secondaryOptions: orderOptions,
    activeSecondary: activePoId,
    visibleRows: visibleReceipts,
    changeStatus,
    changeSecondary,
  } = useListFilters({
    rows: receipts,
    statusChips: STATUS_CHIPS,
    statusOf,
    initialStatus,
    secondaryParam: "po",
    initialSecondary: initialPoId,
    secondaryOf: orderOf,
    secondaryAllLabel: "Бүх захиалга",
  });

  const navIds = useMemo(
    () => visibleReceipts.map((receipt) => receipt.id),
    [visibleReceipts]
  );

  const openPanel = useCallback(
    (receipt: GoodsReceiptView) =>
      openGoodsReceiptPanel({
        receiptId: receipt.id,
        purchaseOrderId: receipt.purchaseOrderId,
        title: `${receipt.documentNo} · ${receipt.purchaseOrderNo}`,
        navIds,
      }),
    [navIds]
  );

  const handleConfirm = useCallback(
    async (receipt: GoodsReceiptView) => {
      const ok = await confirm({
        title: "Хүлээн авалт батлах",
        description: `${receipt.documentNo} — батлахад барааны орлого бүртгэгдэж, ${
          receipt.currency === "MNT"
            ? "захиалгын нэгж үнээр"
            : `хүлээн авсан өдрийн ханш ${receipt.exchangeRate.toLocaleString("en-US")}-аар`
        } өртөг тооцогдож GL журнал бичигдэнэ. Батлах уу?`,
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(
        () => confirmGoodsReceipt({ id: receipt.id }),
        `${receipt.documentNo} батлагдаж орлого бүртгэгдлээ`
      );
    },
    [confirm, runAction]
  );

  const handleReverse = useCallback(
    async (receipt: GoodsReceiptView) => {
      const ok = await confirm({
        title: "Хүлээн авалтыг буцаах",
        description: `${receipt.documentNo} — орлогын хөдөлгөөн, өртгийн бичилт, GL журналыг буцаана. Хуваарилагдсан нэмэлт зардал байвал эхлээд хуваарилалтыг буцаана уу.`,
        confirmText: "Буцаах",
        danger: true,
      });
      if (!ok) return;
      runAction(
        () => reverseGoodsReceipt({ id: receipt.id }),
        `${receipt.documentNo} буцаагдлаа`
      );
    },
    [confirm, runAction]
  );

  const handleDelete = useCallback(
    async (receipt: GoodsReceiptView) => {
      const ok = await confirm({
        title: "Ноорог хүлээн авалт устгах",
        description: `${receipt.documentNo} ноорог хүлээн авалтыг мөрүүдтэй нь бүрмөсөн устгах уу?`,
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(
        () => deleteGoodsReceipt({ id: receipt.id }),
        `${receipt.documentNo} устгагдлаа`
      );
    },
    [confirm, runAction]
  );

  const columnDefs = useMemo<ColDef<GoodsReceiptView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Хүлээн авалтын №",
        field: "documentNo",
        minWidth: 170,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Захиалга",
        field: "purchaseOrderNo",
        width: 165,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Нийлүүлэгч",
        field: "counterpartyName",
        minWidth: 170,
        flex: 1,
      },
      {
        headerName: "Агуулах",
        field: "warehouseName",
        minWidth: 140,
        flex: 1,
      },
      {
        headerName: "Мөр",
        field: "lineCount",
        width: 80,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "МБ ханш",
        field: "exchangeRate",
        width: 126,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => {
          const receipt = params.data;
          if (!receipt) return "";
          if (receipt.currency === "MNT") return "—";
          return receipt.exchangeRate.toLocaleString("en-US", {
            maximumFractionDigits: 4,
          });
        },
        tooltipValueGetter: (params) => {
          const receipt = params.data;
          if (!receipt || receipt.currency === "MNT") return null;
          return `${receipt.currency}/MNT · ханшийн огноо ${
            receipt.rateDate ?? receipt.date
          } (барааны өртөг ҮҮГЭЭР үнэлэгдэнэ)`;
        },
      },
      {
        headerName: "Дүн (MNT)",
        field: "totalAmountMnt",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 124,
        valueGetter: (params) =>
          params.data ? GR_STATUS_LABELS[params.data.status] : "",
        cellRenderer: (params: ICellRendererParams<GoodsReceiptView>) => {
          const receipt = params.data;
          if (!receipt) return null;
          return (
            <span className="flex h-full items-center">
              <StatusBadge tone={GR_STATUS_TONES[receipt.status]} size="sm">
                {GR_STATUS_LABELS[receipt.status]}
              </StatusBadge>
            </span>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 118,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<GoodsReceiptView>) => {
          const receipt = params.data;
          if (!receipt) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="ea-btn ea-btn--icon"
                title="Дэлгэрэнгүй нээх"
                aria-label="Дэлгэрэнгүй нээх"
                onClick={() => openPanel(receipt)}
              >
                <Icon name="openDetail" />
              </button>
              {receipt.status === "draft" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--success"
                  title="Баталж орлого бүртгэх"
                  aria-label="Баталж орлого бүртгэх"
                  onClick={() => handleConfirm(receipt)}
                >
                  <Icon name="approve" />
                </button>
              )}
              {receipt.status === "confirmed" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Хүлээн авалтыг буцаах"
                  aria-label="Хүлээн авалтыг буцаах"
                  onClick={() => handleReverse(receipt)}
                >
                  <Icon name="reset" />
                </button>
              )}
              {receipt.status === "draft" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--danger"
                  title="Ноорог устгах"
                  aria-label="Ноорог устгах"
                  onClick={() => handleDelete(receipt)}
                >
                  <Icon name="delete" />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [handleConfirm, handleDelete, handleReverse, openPanel]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хүлээн авалт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Бараа хүлээн авсан өдрийн Монголбанкны албан ханшаар үнэлэгдэнэ —
            нэхэмжлэх өөр ханштай байсан ч зөрүү нь захиалгын хаалтад ханшийн
            олз/гарз болж гарна.
          </p>
        </div>
        {/* Хүлээн авалт нь ЗАХИАЛГААС үүснэ (мөр = хүлээн аваагүй үлдэгдэл)
            тул энд "шинэ" товч биш, захиалгын жагсаалт руу холбоос. */}
        <LinkButton href="/procurement/orders" icon="purchaseOrder">
          Захиалга сонгож хүлээн авах
        </LinkButton>
      </div>

      {receipts.length > 0 && (
        <ListToolbar
          statusChips={STATUS_CHIPS}
          statusCounts={statusCounts}
          activeStatus={activeStatus}
          onStatusChange={changeStatus}
          secondaryOptions={orderOptions}
          activeSecondary={activePoId}
          onSecondaryChange={changeSecondary}
          secondaryPlaceholder="Бүх захиалга"
          secondaryWidthClass="w-64"
          surfaceId="procurement-receipts"
          gridRef={gridRef}
        />
      )}

      {visibleReceipts.length === 0 ? (
        receipts.length === 0 ? (
          <EmptyState
            icon="packageReceipt"
            title="Хүлээн авалт бүртгэгдээгүй байна"
            description="Хүлээн авалт нь худалдан авалтын захиалгын панелиас үүсгэгдэнэ — нэхэмжлэхээс өмнө ч, дараа ч, хэсэгчилсэн ч болно."
            actions={[
              {
                label: "Захиалга руу",
                href: "/procurement/orders",
                icon: "purchaseOrder",
                primary: true,
              },
              {
                label: "Бараа, агуулах",
                href: "/inventory/items",
                icon: "warehouse",
              },
            ]}
          />
        ) : (
          <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
            Шүүлтүүрт таарах хүлээн авалт байхгүй
          </div>
        )
      ) : (
        <DataGridDynamic<GoodsReceiptView>
          ref={gridRef}
          rowData={visibleReceipts}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visibleReceipts.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={(event) => {
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
