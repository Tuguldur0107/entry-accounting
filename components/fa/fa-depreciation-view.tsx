"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { Calculator, Check, CheckCheck, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  deleteDepreciationEntry,
  postDepreciationEntries,
  postDepreciationEntry,
  reverseDepreciationEntry,
  runDepreciation,
} from "@/lib/actions/fa";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

export type DepreciationEntryView = {
  id: string;
  assetCode: string;
  assetName: string;
  periodMonth: string;
  amount: number;
  status: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  posted: "Батлагдсан",
  reversed: "Сторно",
};

interface Props {
  entries: DepreciationEntryView[];
  defaultMonth: string;
}

// Элэгдлийн хуудас: сар сонгож run — идэвхтэй карт бүрд шулуун шугамын
// сарын НООРОГ бичилт; батлахад карт бүрд Dr зардал / Cr хуримт. элэгдэл.
export function FaDepreciationView({ entries, defaultMonth }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [month, setMonth] = useState(defaultMonth);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const gridApiRef = useRef<GridApi<DepreciationEntryView> | null>(null);

  const selectedDrafts = useMemo(
    () =>
      entries.filter(
        (entry) => entry.status === "draft" && selectedDraftIds.includes(entry.id)
      ),
    [entries, selectedDraftIds]
  );

  const runAction = useCallback(
    (action: () => Promise<unknown>, successMessage: string) => {
      startTransition(async () => {
        try {
          await action();
          router.refresh();
          toast.success(successMessage);
        } catch (caught) {
          toast.error(caught instanceof Error ? caught.message : "Үйлдэл амжилтгүй");
        }
      });
    },
    [router]
  );

  function handleRun() {
    startTransition(async () => {
      try {
        const result = await runDepreciation({ month });
        router.refresh();
        if (result.created === 0)
          toast.info("Элэгдүүлэх карт алга — бүгд тооцогдсон эсвэл эхлээгүй");
        else toast.success(`${result.created} картын элэгдлийн ноорог үүслээ`);
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : "Run амжилтгүй");
      }
    });
  }

  const handleBatchPost = useCallback(async () => {
    const drafts = selectedDrafts;
    if (drafts.length === 0) return;
    const total = drafts.reduce((sum, entry) => sum + entry.amount, 0);
    const ok = await confirm({
      title: "Элэгдэл олноор батлах",
      description: `${drafts.length} бичилт (нийт ${fmtMnt(total)}) GL-д бичих үү?`,
      confirmText: `Батлах (${drafts.length})`,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await postDepreciationEntries(drafts.map((e) => e.id));
        gridApiRef.current?.deselectAll();
        setSelectedDraftIds([]);
        router.refresh();
        if (result.failures.length === 0)
          toast.success(`${result.posted} бичилт батлагдлаа`);
        else
          toast.warning(
            `${result.posted} батлагдаж, ${result.failures.length} алдаатай`,
            { description: result.failures.map((f) => f.error).join("\n") }
          );
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Олноор батлах амжилтгүй"
        );
      }
    });
  }, [selectedDrafts, confirm, router]);

  const columns = useMemo<ColDef<DepreciationEntryView>[]>(
    () => [
      {
        headerName: "Сар",
        field: "periodMonth",
        width: 100,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Код", field: "assetCode", width: 170, cellClass: "font-mono text-xs" },
      { headerName: "Хөрөнгө", field: "assetName", minWidth: 200, flex: 1 },
      {
        headerName: "Дүн",
        field: "amount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Төлөв",
        field: "status",
        width: 118,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<DepreciationEntryView>) => {
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
        cellRenderer: (params: ICellRendererParams<DepreciationEntryView>) => {
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
                    onClick={() =>
                      runAction(
                        () => postDepreciationEntry(entry.id),
                        "Элэгдэл GL-д бичигдлээ"
                      )
                    }
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Ноорог устгах"
                    aria-label="Ноорог устгах"
                    onClick={() =>
                      runAction(
                        () => deleteDepreciationEntry(entry.id),
                        "Ноорог устгагдлаа"
                      )
                    }
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
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Сторно бичих",
                      description: `${entry.assetName} — ${entry.periodMonth} сарын элэгдлийг сторно хийх үү?`,
                      confirmText: "Сторно",
                      danger: true,
                    });
                    if (!ok) return;
                    runAction(
                      () => reverseDepreciationEntry(entry.id),
                      "Бичилт сторно хийгдлээ"
                    );
                  }}
                >
                  <RotateCcw />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [confirm, runAction]
  );

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<DepreciationEntryView>) => {
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

  const draftCount = entries.filter((entry) => entry.status === "draft").length;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Элэгдэл
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Шулуун шугамын арга — Dr Элэгдлийн зардал / Cr Хуримтлагдсан элэгдэл
            {draftCount > 0 && (
              <span className="ml-1 font-medium text-[var(--ea-warning-fg)]">
                · {draftCount} ноорог батлахыг хүлээж байна
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedDrafts.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="h-8"
              onClick={handleBatchPost}
              disabled={isPending}
            >
              <CheckCheck />
              Сонгосныг батлах ({selectedDrafts.length})
            </Button>
          )}
          <Input
            type="month"
            className="h-8 w-40"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <Button size="sm" onClick={handleRun} disabled={isPending}>
            <Calculator />
            Элэгдэл тооцох
          </Button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex min-h-56 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Элэгдлийн бичилт байхгүй — сар сонгоод тооцоолуулна
        </div>
      ) : (
        <DataGridDynamic<DepreciationEntryView>
          rowData={entries}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height={Math.min(680, 86 + entries.length * 38)}
          pagination={entries.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName={cn(
            "rounded-md border border-[var(--ea-border)] overflow-hidden"
          )}
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
        />
      )}

      {confirmDialog}
    </section>
  );
}
