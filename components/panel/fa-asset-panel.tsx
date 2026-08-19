"use client";

// Үндсэн хөрөнгийн карт — дэлгэрэнгүй панель.
// Payload: { assetId: string } — өгөгдлөө getFaAssetPanelData server
// action-аар татна, refreshToken өсөх бүрд (сэргээх / дахин нээх) дахин
// ачаална. Ноорог картад "Бөглөж идэвхжүүлэх" → openFaAssetFormPanel.

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { deactivateFixedAsset, getFaAssetPanelData } from "@/lib/actions/fa";
import type {
  FaDepreciationEntryRow,
  FixedAssetView,
} from "@/lib/fa/asset-views";
import {
  depreciationMethodLabel,
  monthlyDepreciation,
} from "@/lib/fa/depreciation";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openFaAssetFormPanel,
  refreshOpenPanels,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  active: "Идэвхтэй",
  disposed: "Хасагдсан",
};

const STATUS_TONES: Record<string, StatusTone> = {
  draft: "warning",
  active: "success",
  disposed: "muted",
};

const ENTRY_STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Буцаагдсан",
};

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Хөрөнгийн карт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

const ENTRY_COLUMNS: ColDef<FaDepreciationEntryRow>[] = [
  {
    headerName: "Сар",
    field: "periodMonth",
    width: 110,
    cellClass: "font-mono text-xs",
  },
  {
    headerName: "Дүн",
    field: "amount",
    flex: 1,
    minWidth: 140,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
  },
  {
    headerName: "Төлөв",
    field: "status",
    width: 120,
    valueGetter: (params) =>
      ENTRY_STATUS_LABELS[params.data?.status ?? ""] ?? "",
    cellClass: "text-xs",
  },
];

export function FaAssetPanel({
  panel,
  requestClose,
}: {
  panel: PanelInstance;
  /** Панелийн хаалт — dirty бол баталгаажуулалттай (PanelHost эзэмшинэ). */
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);
  const closePanel = usePanelStore((state) => state.closePanel);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const assetId = panel.payload.assetId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; asset: FixedAssetView }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — хураастай байх зуур элэгдлийн run зэрэг өөр газраас карт
  // өөрчлөгдсөн байж болно.
  useEffect(() => {
    if (!assetId) return;
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getFaAssetPanelData(assetId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        const asset = result.data.asset;
        if (!asset) {
          setState({
            status: "error",
            message: ERROR_MESSAGES["not-found"],
          });
          return;
        }
        setState({ status: "ready", asset });
        setTitle(
          panel.id,
          `${asset.name} · ${STATUS_LABELS[asset.status] ?? asset.status}`
        );
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, refreshToken, panel.id, setTitle]);

  if (!assetId)
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {ERROR_MESSAGES["not-found"]}
      </div>
    );

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

  const { asset } = state;
  const depreciableBase =
    Math.round((asset.cost - asset.salvageValue) * 100) / 100;
  const progressPercent =
    depreciableBase > 0
      ? Math.min(100, Math.round((asset.accumulated / depreciableBase) * 100))
      : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto grid w-full max-w-3xl gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-[var(--ea-text-3)]">
              {asset.code}
            </span>
            <span className="text-base font-semibold text-[var(--ea-text-1)]">
              {asset.name}
            </span>
            <StatusBadge tone={STATUS_TONES[asset.status] ?? "muted"}>
              {STATUS_LABELS[asset.status] ?? asset.status}
            </StatusBadge>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <DetailItem label="Авсан огноо" value={asset.acquisitionDate} mono />
            <DetailItem label="Эзэмшигч" value={asset.custodian || "—"} />
            <DetailItem
              label="Элэгдлийн арга"
              value={depreciationMethodLabel(asset.depreciationMethod)}
            />
            <DetailItem
              label="Эхлэх сар"
              value={asset.depreciationStartMonth ?? "—"}
              mono
            />
            <DetailItem
              label="Ашиглалтын хугацаа"
              value={
                asset.usefulLifeMonths > 0
                  ? `${asset.usefulLifeMonths} сар`
                  : "—"
              }
            />
            <DetailItem
              label="Сарын элэгдэл (шулуун)"
              value={
                asset.usefulLifeMonths > 0
                  ? fmtMnt(monthlyDepreciation(asset))
                  : "—"
              }
              mono
            />
            <DetailItem
              label="Үлдэх өртөг"
              value={fmtMnt(asset.salvageValue)}
              mono
            />
          </div>

          {/* Санхүүгийн дүнгүүд */}
          <div className="grid grid-cols-3 gap-2">
            <SummaryCard label="Өртөг" value={fmtMnt(asset.cost)} />
            <SummaryCard
              label="Хуримт. элэгдэл"
              value={fmtMnt(asset.accumulated)}
            />
            <SummaryCard
              label="Үлдэгдэл өртөг"
              value={fmtMnt(asset.netBookValue)}
              highlight
            />
          </div>

          {depreciableBase > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--ea-text-3)]">
                <span>Элэгдлийн явц</span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--ea-border)]">
                <div
                  className="h-full rounded-full bg-[var(--ea-primary)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-3 sm:gap-x-6">
            <DetailItem
              label="Өртгийн данс"
              value={asset.assetAccountNumber}
              mono
            />
            <DetailItem
              label="Хуримт. элэгдлийн данс"
              value={asset.accumDepAccountNumber}
              mono
            />
            <DetailItem
              label="Элэгдлийн зардлын данс"
              value={asset.depExpenseAccountNumber}
              mono
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-[var(--ea-text-2)]">
              Элэгдлийн бичилтүүд ({asset.entries.length})
            </p>
            {asset.entries.length === 0 ? (
              <p className="rounded-md border border-[var(--ea-border)] px-3 py-4 text-center text-xs text-[var(--ea-text-4)]">
                Элэгдлийн бичилт үүсээгүй — Элэгдэл хуудаснаас тооцоолуулна
              </p>
            ) : (
              <DataGridDynamic<FaDepreciationEntryRow>
                rowData={asset.entries}
                columnDefs={ENTRY_COLUMNS}
                getRowId={(params) => params.data.id}
                height={Math.min(320, 86 + asset.entries.length * 34)}
                wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                suppressCellFocus
              />
            )}
          </div>
        </div>
      </div>

      <footer
        className="flex shrink-0 items-center justify-end gap-2 px-4 py-3"
        style={{ borderTop: "1px solid var(--ea-border)" }}
      >
        {asset.status === "draft" && (
          <Button
            variant="secondary"
            onClick={() => openFaAssetFormPanel({ assetId: asset.id })}
          >
            <Icon name="edit" size="sm" />
            Бөглөж идэвхжүүлэх
          </Button>
        )}
        {asset.status === "active" && (
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => {
              void confirm({
                title: "Идэвхжүүлэлт буцаах",
                description: `${asset.code} · ${asset.name} картыг ноорог руу буцаах уу? (Элэгдлийн идэвхтэй бичилттэй бол татгалзана — эхлээд бичилтүүдийг буцаана.)`,
                confirmText: "Буцаах",
                danger: true,
              }).then((ok) => {
                if (!ok) return;
                startTransition(async () => {
                  try {
                    await deactivateFixedAsset(asset.id);
                    toast.success("Идэвхжүүлэлт буцаагдаж, карт ноорог боллоо");
                    closePanel(panel.id);
                    refreshOpenPanels();
                    router.refresh();
                  } catch (caught) {
                    toast.error(
                      caught instanceof Error ? caught.message : "Буцаах амжилтгүй"
                    );
                  }
                });
              });
            }}
          >
            <Icon name="reset" size="sm" />
            Идэвхжүүлэлт буцаах
          </Button>
        )}
        <Button variant="outline" onClick={requestClose}>
          Хаах
        </Button>
      </footer>
      {confirmDialog}
    </div>
  );
}

function DetailItem({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-[var(--ea-text-4)]">{label}</p>
      <p
        className={cn(
          "text-sm text-[var(--ea-text-1)]",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--ea-border)] px-3 py-2",
        highlight && "border-[var(--ea-primary)]/40 bg-[var(--ea-primary)]/5"
      )}
    >
      <p className="text-[11px] text-[var(--ea-text-4)]">{label}</p>
      <p
        className={cn(
          "font-mono text-sm font-medium",
          highlight ? "text-[var(--ea-primary)]" : "text-[var(--ea-text-1)]"
        )}
      >
        {value}
      </p>
    </div>
  );
}
