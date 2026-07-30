"use client";

// Өртгийн бичилтийн дэлгэрэнгүй панель — read-only.
// Payload: { entryId } — бүх өгөгдлөө (мета + GL мөрүүд + дансны нэрс +
// идэвхтэй сегментүүд) server action-аар өөрөө татна, panel.refreshToken
// өөрчлөгдөх бүрд дахин татна (voucher-panel-тай ижил загвар).

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

import {
  ENTRY_TYPE_LABELS,
  STATUS_LABELS,
  fmtQty,
} from "@/components/costing/cost-entries-view";
import { VoucherLinesTable } from "@/components/gl/voucher-lines-table";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import {
  getCostEntryPanelData,
  type CostEntryPanelData,
} from "@/lib/actions/costing";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openVoucherPanel,
  usePanelStore,
  type PanelInstance,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

const ERROR_MESSAGES = {
  unauthenticated: "Нэвтрэх шаардлагатай — дахин нэвтэрнэ үү.",
  "not-found": "Өртгийн бичилт олдсонгүй. Устгагдсан байж болзошгүй.",
  failed: "Ачаалж чадсангүй. Дахин оролдоно уу.",
} as const;

const STATUS_TONES: Record<string, StatusTone> = {
  draft: "warning",
  posted: "success",
  reversed: "muted",
};

export function CostEntryPanel({
  panel,
}: {
  panel: PanelInstance;
  requestClose: () => void;
}) {
  const setTitle = usePanelStore((state) => state.setTitle);

  const entryId = panel.payload.entryId as string | undefined;
  const refreshToken = panel.refreshToken;
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; data: CostEntryPanelData }
  >({ status: "loading" });

  // Эхний ачаалалт + сэргээх/дахин нээх бүрд дахин татна (store refreshToken-ийг
  // өсгөдөг) — панель хураастай байх зуур бичилт батлагдсан/буцаагдсан байж
  // болно. Read-only тул dirty болдоггүй ч voucher-panel-ийн хамгаалалтыг
  // хэвээр дагана.
  useEffect(() => {
    if (!entryId) return;
    const current = usePanelStore
      .getState()
      .panels.find((entry) => entry.id === panel.id);
    if (current?.dirty) return;

    let cancelled = false;
    getCostEntryPanelData(entryId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setState({ status: "error", message: ERROR_MESSAGES[result.code] });
          return;
        }
        setState({ status: "ready", data: result.data });
        const typeLabel =
          ENTRY_TYPE_LABELS[result.data.entry.entryType] ?? "Өртгийн бичилт";
        setTitle(panel.id, `${result.data.entry.documentNo} · ${typeLabel}`);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", message: ERROR_MESSAGES.failed });
      });
    return () => {
      cancelled = true;
    };
  }, [entryId, refreshToken, panel.id, setTitle]);

  if (!entryId || state.status === "error")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center px-6 text-center text-sm text-[var(--ea-danger)]">
        {state.status === "error" ? state.message : ERROR_MESSAGES["not-found"]}
      </div>
    );

  if (state.status === "loading")
    return (
      <div className="flex min-h-40 flex-1 items-center justify-center gap-2 text-sm text-[var(--ea-text-3)]">
        <Icon name="loading" className="animate-spin" />
        Ачаалж байна…
      </div>
    );

  const { entry, voucher, reversalVoucherId, lines, glNames, activeSegIds } =
    state.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-3">
          <DetailRow label="Огноо" value={entry.date} mono />
          <DetailRow
            label="Төрөл"
            value={ENTRY_TYPE_LABELS[entry.entryType] ?? entry.entryType}
          />
          <DetailRow label="Бараа" value={entry.itemLabel} />
          <DetailRow
            label="Тоо × нэгж өртөг"
            value={`${fmtQty(entry.quantity)} ${entry.unit} × ${fmtMnt(entry.unitCost)}`}
            mono
          />
          <DetailRow label="Дүн" value={fmtMnt(entry.amount)} mono strong />
        </dl>
        <StatusBadge
          tone={STATUS_TONES[entry.status] ?? "muted"}
          className="shrink-0"
        >
          {STATUS_LABELS[entry.status] ?? entry.status}
        </StatusBadge>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-[var(--ea-text-2)]">
            GL журнал
            {voucher && (
              <span className="ml-2 font-mono font-normal text-[var(--ea-text-4)]">
                {voucher.date}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {voucher && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  openVoucherPanel(voucher.id, voucher.description)
                }
              >
                Журнал нээх
                <Icon name="openDetail" />
              </Button>
            )}
            {reversalVoucherId && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  openVoucherPanel(reversalVoucherId, "Буцаалтын журнал")
                }
              >
                Буцаалтын журнал
                <Icon name="openDetail" />
              </Button>
            )}
          </div>
        </div>
        {lines.length > 0 ? (
          <VoucherLinesTable
            lines={lines}
            activeSegIds={activeSegIds}
            glName={(main) => glNames[main] ?? ""}
          />
        ) : (
          <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
            {entry.status === "draft"
              ? "Ноорог — батлагдаагүй тул GL журнал үүсээгүй"
              : "GL журнал олдсонгүй"}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-[var(--ea-text-4)]">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[var(--ea-text-1)]",
          mono && "font-mono",
          strong && "font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
