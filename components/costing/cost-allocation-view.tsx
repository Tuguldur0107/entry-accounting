"use client";

// Нэмэлт зардлын хуваарилалт — тээвэр, гааль, даатгалыг бараанд хуваарилна.
// docs/cost §10 (FR-ALLOC-*). Хуваарийн суурийг баримт бүрд сонгоно
// (OD-017, README change-control 0.3): үнийн дүнгээр / тоо хэмжээгээр /
// гараар.
//
// Хуваарилалт бүр `landed_cost` төрлийн НООРОГ өртгийн бичилт үүсгэж,
// барааны Орлогын дүнд нэмэгдэнэ. GL-д бичих нь тусдаа алхам.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef } from "ag-grid-community";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createCostAllocation,
  type AllocationRow,
  type AllocationTargetOption,
} from "@/lib/actions/cost-allocation";
import {
  ALLOCATION_BASE_LABELS,
  allocate,
  type AllocationBase,
} from "@/lib/costing/allocation";
import { fmtMnt } from "@/lib/reports/balances";
import { cn } from "@/lib/utils";

interface Props {
  rows: AllocationRow[];
  targets: AllocationTargetOption[];
  components: { id: string; code: string; name: string }[];
  from: string;
  to: string;
}

export function CostAllocationView({
  rows,
  targets,
  components,
  from,
  to,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState({ from, to });

  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    costComponentId: "",
    totalAmount: "",
    allocationBase: "value" as AllocationBase,
    documentNo: "",
    description: "",
  });
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Record<string, string>>({});

  function applyRange(next: { from: string; to: string }) {
    setRange(next);
    const params = new URLSearchParams(window.location.search);
    params.set("from", next.from);
    params.set("to", next.to);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  }

  const chosenTargets = targets.filter((target) => selected[target.movementId]);
  const totalAmount = Number(form.totalAmount.replaceAll(",", "")) || 0;

  // Урьдчилсан харагдац — хадгалахаас өмнө хуваарь ямар байхыг үзүүлнэ.
  const preview = useMemo(() => {
    if (chosenTargets.length === 0 || totalAmount <= 0) return null;
    return allocate({
      totalAmount,
      base: form.allocationBase,
      targets: chosenTargets.map((target) => ({
        movementId: target.movementId,
        quantity: target.quantity,
        value: target.value,
        manualAmount: Number(
          (manual[target.movementId] ?? "").replaceAll(",", "")
        ),
      })),
    });
  }, [chosenTargets, totalAmount, form.allocationBase, manual]);

  const previewByMovement = useMemo(() => {
    if (!preview?.ok) return new Map<string, number>();
    return new Map(preview.lines.map((line) => [line.movementId, line.amount]));
  }, [preview]);

  function save() {
    setError("");
    startTransition(async () => {
      const result = await createCostAllocation({
        date: form.date,
        costComponentId: form.costComponentId,
        totalAmount,
        allocationBase: form.allocationBase,
        documentNo: form.documentNo || undefined,
        description: form.description,
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
      setOpen(false);
      setSelected({});
      setManual({});
      setForm((current) => ({ ...current, totalAmount: "", documentNo: "" }));
      router.refresh();
    });
  }

  const columns = useMemo<ColDef<AllocationRow>[]>(
    () => [
      {
        headerName: "Дугаар",
        field: "documentNo",
        width: 190,
        cellClass: "font-mono text-xs",
      },
      { headerName: "Огноо", field: "date", width: 110, cellClass: "font-mono text-xs" },
      {
        headerName: "Өртгийн бүрэлдэхүүн",
        field: "componentLabel",
        minWidth: 200,
        flex: 1,
      },
      {
        headerName: "Хуваарийн суурь",
        field: "allocationBase",
        width: 160,
        valueGetter: (params) =>
          ALLOCATION_BASE_LABELS[
            (params.data?.allocationBase ?? "value") as AllocationBase
          ] ?? params.data?.allocationBase,
        cellClass: "text-xs",
      },
      {
        headerName: "Бараа",
        field: "lineCount",
        width: 90,
        cellClass: "ag-right-aligned-cell font-mono text-xs",
        headerClass: "ag-right-aligned-header",
      },
      {
        headerName: "Нийт дүн",
        field: "totalAmount",
        width: 150,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtMnt(Number(params.value ?? 0)),
      },
    ],
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Нэмэлт зардлын хуваарилалт
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Тээвэр, гааль, даатгал зэргийг орлогын хөдөлгөөнүүдэд хуваарилж
            барааны өртөгт шингээнэ (IAS 2.11). Хуваарийн суурийг баримт бүрд
            сонгоно.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
          disabled={components.length === 0}
          title={
            components.length === 0
              ? "Эхлээд Өртгийн тохиргоо → Өртгийн бүрэлдэхүүн нэмнэ үү"
              : undefined
          }
        >
          <Plus size={14} />
          Хуваарилах
        </Button>
      </div>

      {components.length === 0 && (
        <p className="rounded-md border border-[var(--ea-warning)]/40 bg-[var(--ea-warning)]/8 px-3 py-2 text-xs">
          Өртгийн бүрэлдэхүүн бүртгээгүй байна — Өртгийн тохиргоо →
          &quot;Өртгийн бүрэлдэхүүн&quot; хэсэгт тээвэр, гааль гэх мэт
          ангилалаа нэмнэ үү.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Хуваарилалт бүртгээгүй байна
        </div>
      ) : (
        <DataGridDynamic<AllocationRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Нэмэлт зардал хуваарилах</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Огноо</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, date: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Өртгийн бүрэлдэхүүн</Label>
                <SearchableSelect
                  value={form.costComponentId}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, costComponentId: value }))
                  }
                  options={components.map((component) => ({
                    value: component.id,
                    label: `${component.code} · ${component.name}`,
                  }))}
                  placeholder="Бүрэлдэхүүн сонгох..."
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Нийт дүн</Label>
                <Input
                  value={form.totalAmount}
                  onChange={(event) =>
                    setForm((c) => ({ ...c, totalAmount: event.target.value }))
                  }
                  placeholder="1,000,000"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Хуваарийн суурь</Label>
                <select
                  className="h-9 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-2 text-sm text-[var(--ea-text-1)]"
                  value={form.allocationBase}
                  onChange={(event) =>
                    setForm((c) => ({
                      ...c,
                      allocationBase: event.target.value as AllocationBase,
                    }))
                  }
                >
                  <option value="value">Үнийн дүнгээр</option>
                  <option value="quantity">Тоо хэмжээгээр</option>
                  <option value="manual">Гараар</option>
                </select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Тайлбар</Label>
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm((c) => ({ ...c, description: event.target.value }))
                }
                placeholder="Тээврийн нэхэмжлэх №..."
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label>Хуваарилах орлогууд</Label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="date"
                    value={range.from}
                    onChange={(event) =>
                      applyRange({ ...range, from: event.target.value })
                    }
                    className="h-7 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-xs"
                  />
                  <span className="text-xs text-[var(--ea-text-4)]">—</span>
                  <input
                    type="date"
                    value={range.to}
                    onChange={(event) =>
                      applyRange({ ...range, to: event.target.value })
                    }
                    className="h-7 rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1.5 text-xs"
                  />
                </div>
              </div>

              {targets.length === 0 ? (
                <p className="rounded-md border border-[var(--ea-border)] px-3 py-6 text-center text-xs text-[var(--ea-text-4)]">
                  Энэ хугацаанд батлагдсан орлого алга
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-[var(--ea-border)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--ea-bg-2)] text-[var(--ea-text-3)]">
                      <tr>
                        <th className="w-8 px-2 py-1.5" />
                        <th className="px-2 py-1.5 text-left">Баримт</th>
                        <th className="px-2 py-1.5 text-left">Бараа</th>
                        <th className="px-2 py-1.5 text-right">Тоо</th>
                        <th className="px-2 py-1.5 text-right">Өртөг</th>
                        <th className="px-2 py-1.5 text-right">
                          {form.allocationBase === "manual"
                            ? "Дүн бичих"
                            : "Хуваарилах дүн"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.map((target) => {
                        const isSelected = !!selected[target.movementId];
                        return (
                          <tr
                            key={target.movementId}
                            className={cn(
                              "border-t border-[var(--ea-border)]",
                              isSelected && "bg-[var(--ea-primary)]/6"
                            )}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(event) =>
                                  setSelected((current) => ({
                                    ...current,
                                    [target.movementId]: event.target.checked,
                                  }))
                                }
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono">
                              {target.documentNo}
                              <span className="ml-1.5 text-[var(--ea-text-4)]">
                                {target.date}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              {target.itemLabel}
                              <span className="ml-1.5 text-[var(--ea-text-4)]">
                                {target.warehouseLabel}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {target.quantity.toLocaleString("en-US", {
                                maximumFractionDigits: 4,
                              })}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {fmtMnt(target.value)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono">
                              {form.allocationBase === "manual" ? (
                                <input
                                  value={manual[target.movementId] ?? ""}
                                  onChange={(event) =>
                                    setManual((current) => ({
                                      ...current,
                                      [target.movementId]: event.target.value,
                                    }))
                                  }
                                  disabled={!isSelected}
                                  placeholder="0"
                                  className="h-6 w-24 rounded border border-[var(--ea-border)] bg-[var(--ea-surface)] px-1 text-right font-mono text-xs disabled:opacity-40"
                                />
                              ) : isSelected ? (
                                (previewByMovement.get(target.movementId) ??
                                  0) > 0 ? (
                                  fmtMnt(
                                    previewByMovement.get(target.movementId)!
                                  )
                                ) : (
                                  "—"
                                )
                              ) : (
                                ""
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {preview && !preview.ok && (
              <p className="rounded-md bg-[var(--ea-warning)]/10 px-3 py-2 text-xs text-[var(--ea-warning-fg,var(--ea-text-1))]">
                {preview.error}
              </p>
            )}
            {preview?.ok && (
              <p className="text-xs text-[var(--ea-text-3)]">
                {preview.lines.length} бараанд хуваарилагдана · нийлбэр{" "}
                <span className="font-mono font-medium text-[var(--ea-text-1)]">
                  {fmtMnt(
                    preview.lines.reduce((sum, line) => sum + line.amount, 0)
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

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              onClick={save}
              disabled={
                isPending ||
                !form.costComponentId ||
                chosenTargets.length === 0 ||
                !preview?.ok
              }
            >
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
