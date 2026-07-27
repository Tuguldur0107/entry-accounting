"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { Check, CheckCheck, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  deleteCostEntry,
  getCostEntryDetail,
  postCostEntries,
  postCostEntry,
  reverseCostEntry,
  type CostEntryDetail,
} from "@/lib/actions/costing";
import type { CostEntryView } from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";
import { VoucherLinesTable } from "@/components/gl/voucher-lines-table";
import { cn } from "@/lib/utils";

const ENTRY_TYPE_LABELS: Record<string, string> = {
  receipt_capitalize: "Капитализаци",
  issue_cogs: "COGS",
  adjustment_gain: "Илүүдэл",
  adjustment_loss: "Дутагдал",
  return_in: "Буцаалт (ирсэн)",
  return_out: "Буцаалт (гарсан)",
  landed_cost: "Landed cost",
  nrv_writedown: "NRV бууруулалт",
  nrv_reversal: "NRV сэргээлт",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Сторно",
};

type StatusTab = "all" | "draft" | "posted" | "reversed";

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Бүх төлөв" },
  { value: "draft", label: "Ноорог" },
  { value: "posted", label: "Батлагдсан" },
  { value: "reversed", label: "Сторно" },
];

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

interface Props {
  entries: CostEntryView[];
  glNames: Record<string, string>;
  activeSegIds: number[];
  initialStatus?: string;
}

export function CostEntriesView({
  entries,
  glNames,
  activeSegIds,
  initialStatus,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [detailEntry, setDetailEntry] = useState<CostEntryView | null>(null);
  const gridApiRef = useRef<GridApi<CostEntryView> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeStatus: StatusTab = STATUS_TABS.some((t) => t.value === initialStatus)
    ? (initialStatus as StatusTab)
    : "all";

  function changeStatus(next: StatusTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("status");
    else params.set("status", next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: entries.length,
      draft: 0,
      posted: 0,
      reversed: 0,
    };
    for (const entry of entries) {
      if (entry.status === "draft" || entry.status === "posted" || entry.status === "reversed")
        counts[entry.status] += 1;
    }
    return counts;
  }, [entries]);

  const visibleEntries = useMemo(
    () =>
      activeStatus === "all"
        ? entries
        : entries.filter((entry) => entry.status === activeStatus),
    [entries, activeStatus]
  );

  const selectedDrafts = useMemo(
    () =>
      visibleEntries.filter(
        (entry) => entry.status === "draft" && selectedDraftIds.includes(entry.id)
      ),
    [visibleEntries, selectedDraftIds]
  );

  const runAction = useCallback(
    (action: () => Promise<unknown>, successMessage: string) => {
      startTransition(async () => {
        try {
          await action();
          router.refresh();
          toast.success(successMessage);
        } catch (caught) {
          toast.error(
            caught instanceof Error ? caught.message : "Үйлдэл амжилтгүй"
          );
        }
      });
    },
    [router]
  );

  const handlePost = useCallback(
    async (entry: CostEntryView) => {
      const ok = await confirm({
        title: "Өртгийн бичилт батлах",
        description: `${entry.documentNo} — ${fmtMnt(entry.amount)} дүнтэй GL журнал үүсгэх үү?`,
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(() => postCostEntry(entry.id), "Бичилт батлагдаж GL-д бичигдлээ");
    },
    [runAction, confirm]
  );

  const handleReverse = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Сторно бичих",
        description: "Энэ батлагдсан бичилтийг сторно журналаар буцаах уу?",
        confirmText: "Сторно",
        danger: true,
      });
      if (!ok) return;
      runAction(() => reverseCostEntry(id), "Бичилт сторно хийгдлээ");
    },
    [runAction, confirm]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Ноорог устгах",
        description: "Энэ ноорог бичилтийг устгах уу? Дараагийн run дахин үнэлнэ.",
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(() => deleteCostEntry(id), "Ноорог устгагдлаа");
    },
    [runAction, confirm]
  );

  const handleBatchPost = useCallback(async () => {
    const drafts = selectedDrafts;
    if (drafts.length === 0) return;
    const total = drafts.reduce((sum, entry) => sum + entry.amount, 0);
    const ok = await confirm({
      title: "Ноорог олноор батлах",
      description: `${drafts.length} бичилт (нийт ${fmtMnt(total)}) GL-д бичих үү?`,
      confirmText: `Батлах (${drafts.length})`,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await postCostEntries(drafts.map((entry) => entry.id));
        gridApiRef.current?.deselectAll();
        setSelectedDraftIds([]);
        router.refresh();
        if (result.failures.length === 0)
          toast.success(`${result.posted} бичилт батлагдлаа`);
        else
          toast.warning(
            `${result.posted} батлагдаж, ${result.failures.length} алдаатай`,
            {
              description: result.failures.map((f) => f.error).join("\n"),
              duration: 10000,
            }
          );
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Олноор батлах амжилтгүй"
        );
      }
    });
  }, [selectedDrafts, confirm, router]);

  const columnDefs = useMemo<ColDef<CostEntryView>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 112, cellClass: "font-mono text-xs" },
      {
        headerName: "Хөдөлгөөн",
        field: "documentNo",
        width: 180,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Бараа", field: "itemLabel", minWidth: 180, flex: 1 },
      {
        headerName: "Төрөл",
        field: "entryType",
        width: 130,
        valueGetter: (params) =>
          ENTRY_TYPE_LABELS[params.data?.entryType ?? ""] ?? "",
      },
      {
        headerName: "Тоо",
        field: "quantity",
        width: 110,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.data ? `${fmtQty(params.data.quantity)} ${params.data.unit}` : "",
      },
      {
        headerName: "Нэгж өртөг",
        field: "unitCost",
        width: 130,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Дүн",
        field: "amount",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 118,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<CostEntryView>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "posted"
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
        cellRenderer: (params: ICellRendererParams<CostEntryView>) => {
          const entry = params.data;
          if (!entry) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              {entry.status === "draft" && (
                <>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Баталж GL-д бичих"
                    aria-label="Баталж GL-д бичих"
                    onClick={() => handlePost(entry)}
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Ноорог устгах"
                    aria-label="Ноорог устгах"
                    onClick={() => handleDelete(entry.id)}
                  >
                    <Trash2 />
                  </button>
                </>
              )}
              {entry.status === "posted" && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Сторно хийх"
                  aria-label="Сторно хийх"
                  onClick={() => handleReverse(entry.id)}
                >
                  <RotateCcw />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [handleDelete, handlePost, handleReverse]
  );

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<CostEntryView>) => {
      gridApiRef.current = event.api;
      setSelectedDraftIds(
        event.api
          .getSelectedRows()
          .filter((row) => row.status === "draft")
          .map((row) => row.id)
      );
    },
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Өртгийн бичилт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Costing run-аар үүссэн ноорог бичилтийг батлахад GL журнал бичигдэнэ.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {STATUS_TABS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => changeStatus(chip.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                activeStatus === chip.value
                  ? "border-[var(--ea-primary)] bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
                  : "border-[var(--ea-border)] text-[var(--ea-text-3)] hover:border-[var(--ea-border-strong)] hover:text-[var(--ea-text-1)]",
                chip.value === "draft" &&
                  statusCounts.draft > 0 &&
                  activeStatus !== "draft" &&
                  "border-[var(--ea-warning)] text-[var(--ea-warning-fg)]"
              )}
            >
              {chip.label}
              {chip.value !== "all" && statusCounts[chip.value] > 0 && (
                <span className="ml-1 font-mono">{statusCounts[chip.value]}</span>
              )}
            </button>
          ))}
          {selectedDrafts.length > 0 && (
            <Button
              size="sm"
              className="ml-1.5 h-7"
              onClick={handleBatchPost}
              disabled={isPending}
            >
              <CheckCheck />
              Сонгосныг батлах ({selectedDrafts.length})
            </Button>
          )}
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Өртгийн бичилт байхгүй — costing run ажиллуулж үнэлгээ хийнэ
        </div>
      ) : (
        <DataGridDynamic<CostEntryView>
          rowData={visibleEntries}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visibleEntries.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          rowSelection={{
            mode: "multiRow",
            checkboxes: (params) => params.data?.status === "draft",
            headerCheckbox: true,
            hideDisabledCheckboxes: true,
            isRowSelectable: (node) => node.data?.status === "draft",
            enableClickSelection: false,
          }}
          onGridReady={(event) => {
            gridApiRef.current = event.api;
          }}
          onSelectionChanged={handleSelectionChanged}
          onCellClicked={(event) => {
            const colId = event.column.getColId();
            if (colId === "actions" || colId.startsWith("ag-Grid")) return;
            if (event.data) setDetailEntry(event.data);
          }}
        />
      )}

      <CostEntryDetailDialog
        entry={detailEntry}
        glNames={glNames}
        activeSegIds={activeSegIds}
        onClose={() => setDetailEntry(null)}
      />

      {confirmDialog}
    </section>
  );
}

function CostEntryDetailDialog({
  entry,
  glNames,
  activeSegIds,
  onClose,
}: {
  entry: CostEntryView | null;
  glNames: Record<string, string>;
  activeSegIds: number[];
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ id: string; detail: CostEntryDetail } | null>(
    null
  );

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    getCostEntryDetail(entry.id).then((detail) => {
      if (!cancelled) setLoaded({ id: entry.id, detail });
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const detail = entry && loaded && loaded.id === entry.id ? loaded.detail : null;

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="mr-2 font-mono text-xs font-normal text-[var(--ea-text-3)]">
              {entry?.documentNo}
            </span>
            {ENTRY_TYPE_LABELS[entry?.entryType ?? ""] ?? ""}
          </DialogTitle>
        </DialogHeader>
        {entry && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs">
              <DetailRow label="Огноо" value={entry.date} mono />
              <DetailRow label="Бараа" value={entry.itemLabel} />
              <DetailRow
                label="Тоо × нэгж өртөг"
                value={`${fmtQty(entry.quantity)} ${entry.unit} × ${fmtMnt(entry.unitCost)}`}
                mono
              />
              <DetailRow label="Дүн" value={fmtMnt(entry.amount)} mono strong />
            </dl>
            <div>
              <div className="mb-1.5 text-xs font-semibold text-[var(--ea-text-2)]">
                GL журнал
                {detail?.voucherDate && (
                  <span className="ml-2 font-mono font-normal text-[var(--ea-text-4)]">
                    {detail.voucherDate}
                  </span>
                )}
              </div>
              {detail && detail.lines.length > 0 ? (
                <VoucherLinesTable
                  lines={detail.lines}
                  activeSegIds={activeSegIds}
                  glName={(main) => glNames[main] ?? ""}
                />
              ) : (
                <div className="rounded-md border border-[var(--ea-border)] py-6 text-center text-xs text-[var(--ea-text-4)]">
                  {entry.status === "draft"
                    ? "Ноорог — батлагдаагүй тул GL журнал үүсээгүй"
                    : !detail
                      ? "Ачаалж байна…"
                      : "GL журнал олдсонгүй"}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
