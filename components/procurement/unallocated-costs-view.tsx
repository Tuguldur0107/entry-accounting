"use client";

// "Хуваарилагдаагүй зардал" worklist — PO-той нэхэмжлэхийн бүрэлдэхүүнтэй
// мөр бүр (гааль, тээвэр, брокер …) барааны өртөгт шингэтэл энд үлдэнэ
// (docs/procurement §3.6, гэрээ §9, §11).
//
// ХАТУУ ДҮРМҮҮД (docs/cost README 0.6 / OD-017):
//   • Хуваарийн суурь урьдчилан СОНГОГДОХГҮЙ — хэрэглэгч ил сонгоно.
//   • "Гараар" суурьд мөр бүрийн дүнг хэрэглэгч бичнэ; Σ нь хуваарилах
//     дүнтэй таарахгүй бол ХАДГАЛАХГҮЙ (lib/costing/allocation.ts allocate).
//   • Зорилт нь ЗӨВХӨН тухайн захиалгын батлагдсан хүлээн авалтууд;
//     "үнийн дүнгээр" жин нь `receipt_capitalize` дүн (D6 = (а)) тул
//     хуваарилалтын дарааллаас хамаарахгүй.
//   • Мөрийн үлдэгдлээс их дүн хуваарилахыг сервер [ALLOCATION_EXCEEDS_LINE]
//     гэж татгалзана — UI мөн урьдчилан хориглоно.
//
// ДАВХАР даралт → эх нэхэмжлэхийн АР/АП панель.

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { AllocationTargetsTable } from "@/components/costing/allocation-targets-table";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCostAllocation,
  loadPoAllocationTargets,
  type AllocationTargetOption,
} from "@/lib/actions/cost-allocation";
import {
  ALLOCATION_BASE_LABELS,
  allocate,
  type AllocationBase,
} from "@/lib/costing/allocation";
import type { UnallocatedCostLineView } from "@/lib/procurement/types";
import { fmtMnt } from "@/lib/reports/balances";
import {
  openArapDocPanel,
  refreshOpenPanels,
} from "@/lib/store/panel-store";
import { cn } from "@/lib/utils";

const BASE_OPTIONS = Object.keys(ALLOCATION_BASE_LABELS) as AllocationBase[];

interface Props {
  rows: UnallocatedCostLineView[];
  from: string;
  to: string;
}

type TargetState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; targets: AllocationTargetOption[] };

export function UnallocatedCostsView({ rows, from, to }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [range, setRange] = useState({ from, to });

  // Хуваарилах диалог — нэг удаад НЭГ мөр (зардлын мөр = бүрэлдэхүүн + дүн).
  const [line, setLine] = useState<UnallocatedCostLineView | null>(null);
  const [targetState, setTargetState] = useState<TargetState>({
    status: "loading",
  });
  const [date, setDate] = useState("");
  const [amountInput, setAmountInput] = useState("");
  // OD-017 — суурь УРЬДЧИЛАН сонгогдохгүй: "" нь сонгоогүй гэсэн утга.
  const [base, setBase] = useState<AllocationBase | "">("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    const params = new URLSearchParams(window.location.search);
    params.set("from", next.from);
    params.set("to", next.to);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }

  const openAllocate = useCallback((row: UnallocatedCostLineView) => {
    setLine(row);
    setDate(row.date);
    setAmountInput(String(row.remainingMnt));
    setBase("");
    setSelected({});
    setManual({});
    setError("");
    setTargetState({ status: "loading" });
    // Зорилт нь ЗӨВХӨН тухайн захиалгын батлагдсан хүлээн авалтууд.
    loadPoAllocationTargets(row.purchaseOrderId)
      .then((targets) => {
        setTargetState({ status: "ready", targets });
        // Проposal §3.6 — бүх зорилт урьдчилан ✓ (суурь нь БИШ).
        setSelected(
          Object.fromEntries(targets.map((target) => [target.movementId, true]))
        );
      })
      .catch(() =>
        setTargetState({
          status: "error",
          message: "Хүлээн авалтуудыг уншиж чадсангүй",
        })
      );
  }, []);

  const targets =
    targetState.status === "ready" ? targetState.targets : ([] as AllocationTargetOption[]);
  const chosenTargets = targets.filter((target) => selected[target.movementId]);
  const totalAmount = Number(amountInput.replaceAll(",", "")) || 0;
  const exceedsLine = !!line && totalAmount - line.remainingMnt > 0.005;

  const preview = useMemo(() => {
    if (!base || chosenTargets.length === 0 || totalAmount <= 0) return null;
    return allocate({
      totalAmount,
      base,
      targets: chosenTargets.map((target) => ({
        movementId: target.movementId,
        quantity: target.quantity,
        value: target.value,
        manualAmount: Number(
          (manual[target.movementId] ?? "").replaceAll(",", "")
        ),
      })),
    });
  }, [base, chosenTargets, totalAmount, manual]);

  const previewByMovement = useMemo(() => {
    if (!preview?.ok) return new Map<string, number>();
    return new Map(preview.lines.map((entry) => [entry.movementId, entry.amount]));
  }, [preview]);

  function save() {
    if (!line || !base) return;
    setError("");
    startTransition(async () => {
      const result = await createCostAllocation({
        date,
        costComponentId: line.costComponentId,
        totalAmount,
        allocationBase: base,
        // Хангамжийн эх мөр — сервер тал бүрэлдэхүүн, PO, ханшийг ЭНДЭЭС авч
        // Σ ≤ мөрийн MNT дүн шалгалтыг `for update`-тэй хийнэ.
        sourceLineId: line.lineId,
        description: `${line.documentNo} · ${line.costComponentName}`,
        targets: chosenTargets.map((target) => ({
          movementId: target.movementId,
          manualAmount: Number(
            (manual[target.movementId] ?? "").replaceAll(",", "")
          ),
        })),
      });
      if (!result.ok) {
        setError(result.message ?? "Хадгалж чадсангүй");
        return;
      }
      toast.success(
        `${result.documentNo} — ${result.lineCount} бараанд хуваарилагдлаа`
      );
      setLine(null);
      refreshOpenPanels();
      router.refresh();
    });
  }

  const columnDefs = useMemo<ColDef<UnallocatedCostLineView>[]>(
    () => [
      {
        headerName: "Огноо",
        field: "date",
        width: 112,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Нэхэмжлэх",
        field: "documentNo",
        minWidth: 165,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Нийлүүлэгч",
        field: "counterpartyName",
        minWidth: 160,
        flex: 1,
      },
      {
        headerName: "Захиалга",
        field: "purchaseOrderNo",
        width: 165,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Өртгийн бүрэлдэхүүн",
        field: "costComponentName",
        minWidth: 170,
        flex: 1,
      },
      {
        headerName: "Мөрийн дүн (MNT)",
        field: "amountMnt",
        width: 156,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Хуваарилсан",
        field: "allocatedMnt",
        width: 146,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
      {
        headerName: "Үлдэгдэл",
        field: "remainingMnt",
        width: 146,
        cellClass: "ag-right-aligned-cell font-mono font-semibold",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (
          params: ICellRendererParams<UnallocatedCostLineView>
        ) => (
          <span
            className="flex h-full items-center justify-end"
            style={{ color: "var(--ea-warning-fg)" }}
          >
            {fmtMnt(Number(params.value ?? 0))}
          </span>
        ),
      },
      {
        headerName: "Үйлдэл",
        colId: "actions",
        width: 132,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (
          params: ICellRendererParams<UnallocatedCostLineView>
        ) => {
          const row = params.data;
          if (!row) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="ea-btn ea-btn--icon"
                title="Эх нэхэмжлэхийг нээх"
                aria-label="Эх нэхэмжлэхийг нээх"
                onClick={() =>
                  openArapDocPanel({
                    documentId: row.documentId,
                    mode: "payable",
                    title: `${row.documentNo} · ${row.counterpartyName}`,
                  })
                }
              >
                <Icon name="openDetail" />
              </button>
              <Button size="xs" onClick={() => openAllocate(row)}>
                Хуваарилах
              </Button>
            </div>
          );
        },
      },
    ],
    [openAllocate]
  );

  const totalRemaining = useMemo(
    () => rows.reduce((sum, row) => sum + row.remainingMnt, 0),
    [rows]
  );

  const manualSum = useMemo(
    () =>
      chosenTargets.reduce(
        (sum, target) =>
          sum + (Number((manual[target.movementId] ?? "").replaceAll(",", "")) || 0),
        0
      ),
    [chosenTargets, manual]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Хуваарилагдаагүй зардал
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Гааль, тээвэр, брокерын зэрэг нэмэлт зардал барааны өртөгт шингэтэл
            энд үлдэнэ — бүгд хуваарилагдаагүй бол захиалга ХААГДАХГҮЙ.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="h-8 w-36"
            value={range.from}
            onChange={(event) =>
              applyRange({ ...range, from: event.target.value })
            }
          />
          <span className="text-xs text-[var(--ea-text-4)]">—</span>
          <Input
            type="date"
            className="h-8 w-36"
            value={range.to}
            onChange={(event) => applyRange({ ...range, to: event.target.value })}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="costing"
          title="Хуваарилагдаагүй зардал алга"
          description="Энэ хугацаанд захиалгатай холбоотой бүх нэмэлт зардал барааны өртөгт шингэсэн байна. Шинэ зардал нь PO-той нэхэмжлэхийн бүрэлдэхүүнтэй мөрөөс үүснэ."
          actions={[
            {
              label: "Захиалга руу",
              href: "/procurement/orders",
              icon: "purchaseOrder",
              primary: true,
            },
            {
              label: "Өртгийн бүрэлдэхүүн",
              href: "/costing/settings",
              icon: "settings",
            },
          ]}
        />
      ) : (
        <>
          <DataGridDynamic<UnallocatedCostLineView>
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={(params) => params.data.lineId}
            height="flex"
            pagination={rows.length > 25}
            paginationPageSize={25}
            paginationPageSizeSelector={false}
            wrapperClassName="ea-clickable-rows rounded-md border border-[var(--ea-border)] overflow-hidden"
            suppressCellFocus
            onCellDoubleClicked={(event) => {
              const colId = event.column.getColId();
              if (colId === "actions" || colId.startsWith("ag-Grid")) return;
              const row = event.data;
              if (row)
                openArapDocPanel({
                  documentId: row.documentId,
                  mode: "payable",
                  title: `${row.documentNo} · ${row.counterpartyName}`,
                });
            }}
          />

          <div
            className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md px-4 py-2.5 text-xs"
            style={{
              background: "var(--ea-bg-2)",
              border: "1px solid var(--ea-border)",
            }}
          >
            <span className="mr-auto text-[var(--ea-text-3)]">
              {rows.length} зардлын мөр хуваарилалт хүлээж байна
            </span>
            <span className="text-[var(--ea-text-3)]">
              Хуваарилагдаагүй нийт{" "}
              <span className="font-mono font-semibold text-[var(--ea-warning-fg)]">
                {fmtMnt(totalRemaining)}
              </span>
            </span>
          </div>
        </>
      )}

      <Dialog open={!!line} onOpenChange={(open) => !open && setLine(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Нэмэлт зардал хуваарилах</DialogTitle>
          </DialogHeader>

          {line && (
            <div className="grid gap-4">
              <p className="rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-3 py-2 text-xs text-[var(--ea-text-2)]">
                <span className="font-mono">{line.documentNo}</span> ·{" "}
                {line.counterpartyName} · захиалга{" "}
                <span className="font-mono">{line.purchaseOrderNo}</span>
                <br />
                <b>{line.costComponentName}</b> — мөрийн дүн{" "}
                <span className="font-mono">{fmtMnt(line.amountMnt)}</span>,
                хуваарилсан{" "}
                <span className="font-mono">{fmtMnt(line.allocatedMnt)}</span>,
                үлдэгдэл{" "}
                <span className="font-mono font-semibold text-[var(--ea-warning-fg)]">
                  {fmtMnt(line.remainingMnt)}
                </span>
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5">
                  <Label>Огноо</Label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Хуваарилах дүн (MNT)</Label>
                  <Input
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                    placeholder="0"
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Хуваарийн суурь</Label>
                  {/* OD-017 — default СОНГОГДОХГҮЙ. */}
                  <select
                    className="ea-form-select"
                    value={base}
                    onChange={(event) =>
                      setBase(event.target.value as AllocationBase | "")
                    }
                  >
                    <option value="">Сонгоно уу...</option>
                    {BASE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {ALLOCATION_BASE_LABELS[option]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <Label>Захиалгын хүлээн авалтууд</Label>
                  {base === "manual" && (
                    <span className="text-[11px] text-[var(--ea-text-3)]">
                      Бичсэн дүнгийн нийлбэр{" "}
                      <span
                        className={cn(
                          "font-mono font-medium",
                          Math.abs(manualSum - totalAmount) > 0.005
                            ? "text-[var(--ea-danger-fg)]"
                            : "text-[var(--ea-success-fg)]"
                        )}
                      >
                        {fmtMnt(manualSum)}
                      </span>{" "}
                      / {fmtMnt(totalAmount)}
                    </span>
                  )}
                </div>

                {targetState.status === "loading" ? (
                  <p className="rounded-md border border-[var(--ea-border)] px-3 py-6 text-center text-xs text-[var(--ea-text-4)]">
                    Хүлээн авалтуудыг уншиж байна...
                  </p>
                ) : targetState.status === "error" ? (
                  <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                    {targetState.message}
                  </p>
                ) : (
                  // Өртгийн модультай ИЖИЛ хүснэгт — давхардуулахгүй.
                  <AllocationTargetsTable
                    targets={targets}
                    selected={selected}
                    onToggle={(movementId, checked) =>
                      setSelected((current) => ({
                        ...current,
                        [movementId]: checked,
                      }))
                    }
                    base={base}
                    manualAmounts={manual}
                    onManualChange={(movementId, value) =>
                      setManual((current) => ({
                        ...current,
                        [movementId]: value,
                      }))
                    }
                    previewByMovement={previewByMovement}
                    documentHeader="Орлого"
                    valueHeader="Капитализаци"
                    emptyMessage="Энэ захиалгад батлагдсан хүлээн авалт алга — зардлыг хуваарилахын тулд эхлээд хүлээн авалтыг батална"
                  />
                )}
              </div>

              {!base && (
                <p className="text-xs text-[var(--ea-text-3)]">
                  Хуваарийн суурийг сонгоно уу — систем урьдчилан сонгохгүй
                  (OD-017).
                </p>
              )}
              {exceedsLine && (
                <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                  Хуваарилах дүн мөрийн үлдэгдэл{" "}
                  {fmtMnt(line.remainingMnt)}-аас хэтэрсэн байна
                </p>
              )}
              {preview && !preview.ok && (
                <p className="rounded-md bg-[var(--ea-warning)]/10 px-3 py-2 text-xs text-[var(--ea-warning-fg)]">
                  {preview.error}
                </p>
              )}
              {preview?.ok && (
                <p className="text-xs text-[var(--ea-text-3)]">
                  {preview.lines.length} бараанд хуваарилагдана · нийлбэр{" "}
                  <span className="font-mono font-medium text-[var(--ea-text-1)]">
                    {fmtMnt(
                      preview.lines.reduce((sum, entry) => sum + entry.amount, 0)
                    )}
                  </span>
                </p>
              )}
              {error && (
                <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                  {error}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLine(null)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              onClick={save}
              disabled={
                isPending ||
                !base ||
                exceedsLine ||
                chosenTargets.length === 0 ||
                !preview?.ok
              }
            >
              <Icon name="save" />
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
