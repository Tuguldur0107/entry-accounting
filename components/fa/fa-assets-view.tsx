"use client";

import { useMemo, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type {
  CellDoubleClickedEvent,
  ColDef,
  ICellRendererParams,
} from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { deleteFixedAsset } from "@/lib/actions/fa";
import type { FixedAssetView } from "@/lib/fa/asset-views";
import { depreciationMethodLabel } from "@/lib/fa/depreciation";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openFaAssetFormPanel,
  openFaAssetPanel,
} from "@/lib/store/panel-store";

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  active: "Идэвхтэй",
  disposed: "Хасагдсан",
};

interface Props {
  assets: FixedAssetView[];
}

// Хөрөнгийн карт: гараар үүсгэх эсвэл АП/касс/GL-ээс автоматаар ирсэн
// НООРОГ картыг бөглөж идэвхжүүлнэ. Идэвхжүүлэлт GL бичихгүй — өртөг эх
// сувагтаа данслагдсан; элэгдэл нь Элэгдэл хуудаснаас run-аар бичигдэнэ.
// Дэлгэрэнгүй болон үүсгэх/идэвхжүүлэх форм нь ажлын панелиудад нээгдэнэ
// (fa-asset / fa-asset-form) — өгөгдлөө server action-аар өөрсдөө татна.
export function FaAssetsView({ assets }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const columns = useMemo<ColDef<FixedAssetView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 170, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      {
        headerName: "Эзэмшигч",
        field: "custodian",
        width: 130,
        cellClass: "text-xs",
        valueFormatter: (params) => String(params.value ?? "—"),
      },
      {
        headerName: "Арга",
        field: "depreciationMethod",
        width: 150,
        valueGetter: (params) =>
          depreciationMethodLabel(params.data?.depreciationMethod ?? ""),
        cellClass: "text-xs",
      },
      {
        headerName: "Өртөг",
        field: "cost",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуримт. элэгдэл",
        field: "accumulated",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл өртөг",
        field: "netBookValue",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хугацаа",
        field: "usefulLifeMonths",
        width: 96,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          Number(params.value) > 0 ? `${params.value} сар` : "—",
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 108,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<FixedAssetView>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "active"
                      ? "var(--ea-success)"
                      : status === "draft"
                        ? "var(--ea-warning)"
                        : "var(--ea-text-4)",
                }}
              />
              <span className="text-xs">{STATUS_LABELS[status] ?? status}</span>
            </div>
          );
        },
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 100,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<FixedAssetView>) => {
          const asset = params.data;
          if (!asset) return null;
          const isDraft = asset.status === "draft";
          return (
            <div className="flex items-center justify-end gap-1">
              {isDraft && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--success"
                  title="Бөглөж идэвхжүүлэх"
                  aria-label="Бөглөж идэвхжүүлэх"
                  onClick={() => openFaAssetFormPanel({ assetId: asset.id })}
                >
                  <Icon name="edit" />
                </button>
              )}
              <button
                type="button"
                className="ea-btn ea-btn--icon ea-btn--danger"
                title={isDraft ? "Ноорог устгах" : "Карт устгах"}
                aria-label="Устгах"
                onClick={async () => {
                  const ok = await confirm({
                    title: isDraft ? "Ноорог карт устгах" : "Карт устгах",
                    description: isDraft
                      ? `${asset.code} — ${asset.name} картыг устгах уу?`
                      : `${asset.code} — ${asset.name} идэвхтэй картыг устгах уу? (Элэгдлийн бичилттэй бол татгалзана — эхлээд элэгдлийг нь устгаж/буцаана.)`,
                    confirmText: "Устгах",
                    danger: true,
                  });
                  if (!ok) return;
                  startTransition(async () => {
                    try {
                      await deleteFixedAsset(asset.id);
                      router.refresh();
                      toast.success("Карт устгагдлаа");
                    } catch (caught) {
                      toast.error(
                        caught instanceof Error ? caught.message : "Устгаж чадсангүй"
                      );
                    }
                  });
                }}
              >
                <Icon name="delete" />
              </button>
            </div>
          );
        },
      },
    ],
    [confirm, router, startTransition]
  );

  // Мөр дээр ДАВХАР дарахад дэлгэрэнгүй панель нээнэ — үйлдлийн баганад
  // дарсныг алгасна. Нэг даралт нь нүдний мужийн сонголтод үлдээгдсэн.
  function handleCellClicked(event: CellDoubleClickedEvent<FixedAssetView>) {
    if (event.colDef.colId === "actions") return;
    if (event.data) openFaAssetPanel(event.data.id, event.data.name);
  }

  const draftCount = assets.filter((asset) => asset.status === "draft").length;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хөрөнгийн карт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Мөр дээр давхар дарж дэлгэрэнгүй харна · АП/касс/GL-ээс 2Х-дансанд
            бичигдмэгц ноорог карт автоматаар үүснэ
            {draftCount > 0 && (
              <span className="ml-1 font-medium text-[var(--ea-warning-fg)]">
                · {draftCount} ноорог идэвхжүүлэхийг хүлээж байна
              </span>
            )}
          </p>
        </div>
        <Button onClick={() => openFaAssetFormPanel()}>
          <Icon name="add" />
          Шинэ хөрөнгө
        </Button>
      </div>

      {assets.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Хөрөнгө бүртгэгдээгүй байна
        </div>
      ) : (
        <DataGridDynamic<FixedAssetView>
          rowData={assets}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={assets.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onCellDoubleClicked={handleCellClicked}
        />
      )}

      {confirmDialog}
    </section>
  );
}
