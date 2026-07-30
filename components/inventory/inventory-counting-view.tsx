"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { recordInventoryCount } from "@/lib/actions/inventory";
import type { WarehouseView } from "@/lib/inventory/types";

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

export type CountSheetRow = {
  itemId: string;
  itemLabel: string;
  unit: string;
  systemQty: number;
};

interface Props {
  warehouses: WarehouseView[];
  /** Сонгосон агуулахын тооллогын хуудас (идэвхтэй бүх бараа). */
  rows: CountSheetRow[];
  selectedWarehouseId: string;
  asOfDate: string;
}

// Тооллогын хуудас: системийн үлдэгдлийн хажууд тоолсон тоог бичээд
// "Зөрүү бүртгэх" — зөрүүтэй мөр бүрд тохируулгын НООРОГ үүсч, ердийн
// батлах → costing run замаараа GL-д (илүүдэл 51800003 / дутагдал 87100004)
// бичигдэнэ. Тоолоогүй (хоосон үлдээсэн) мөрийг огт хөндөхгүй.
export function InventoryCountingView({
  warehouses,
  rows,
  selectedWarehouseId,
  asOfDate,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Uncontrolled inputs + ref — keystroke бүрд grid дахин рендэрлэж focus
  // алдахаас сэргийлнэ (costing dashboard-тай ижил хэв).
  const countsRef = useRef<Record<string, string>>({});
  const [dateInput, setDateInput] = useState(asOfDate);

  const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive);

  function changeParams(next: { warehouseId?: string; date?: string }) {
    const params = new URLSearchParams();
    params.set("warehouse", next.warehouseId ?? selectedWarehouseId);
    params.set("date", next.date ?? dateInput);
    countsRef.current = {};
    router.push(`/inventory/counting?${params.toString()}`);
  }

  const columns = useMemo<ColDef<CountSheetRow>[]>(
    () => [
      { headerName: "Бараа", field: "itemLabel", minWidth: 220, flex: 1 },
      { headerName: "Хэмжих нэгж", field: "unit", width: 110 },
      {
        headerName: "Системийн үлдэгдэл",
        field: "systemQty",
        width: 160,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtQty(Number(params.value ?? 0)),
      },
      {
        headerName: "Тоолсон тоо",
        colId: "counted",
        width: 160,
        sortable: false,
        filter: false,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<CountSheetRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <input
              type="number"
              min="0"
              step="0.0001"
              placeholder="—"
              className="h-7 w-full rounded border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] px-2 font-mono text-xs outline-none focus:border-[var(--ea-primary)]"
              defaultValue={countsRef.current[row.itemId] ?? ""}
              onChange={(event) => {
                countsRef.current[row.itemId] = event.target.value;
              }}
            />
          );
        },
      },
    ],
    []
  );

  async function handleRecord() {
    const counts: { itemId: string; countedQty: number }[] = [];
    let differences = 0;
    const systemByItem = new Map(rows.map((row) => [row.itemId, row.systemQty]));
    for (const [itemId, raw] of Object.entries(countsRef.current)) {
      if (raw.trim() === "") continue;
      const countedQty = Number(raw.replaceAll(",", ""));
      if (!Number.isFinite(countedQty) || countedQty < 0) {
        toast.error("Тоолсон тоо 0 буюу түүнээс их тоо байна");
        return;
      }
      counts.push({ itemId, countedQty });
      if (countedQty !== (systemByItem.get(itemId) ?? 0)) differences += 1;
    }
    if (counts.length === 0) {
      toast.info("Тоолсон тоо оруулаагүй байна");
      return;
    }
    const ok = await confirm({
      title: "Тооллогын зөрүү бүртгэх",
      description: `${counts.length} бараа тоологдож, ойролцоогоор ${differences} зөрүү илэрлээ. Зөрүү бүрд тохируулгын ноорог үүсгэх үү? (Ноорог батлагдаж, costing run-аар үнэлэгдсэний дараа GL-д бичигдэнэ.)`,
      confirmText: "Бүртгэх",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await recordInventoryCount({
          date: dateInput,
          warehouseId: selectedWarehouseId,
          counts,
        });
        countsRef.current = {};
        router.refresh();
        if (result.created === 0)
          toast.info("Зөрүү илэрсэнгүй — систем ба тооллого тэнцэж байна ✓");
        else
          toast.success(
            `${result.created} тохируулгын ноорог үүслээ — Хөдөлгөөн хуудаснаас батална уу`
          );
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Тооллого бүртгэгдсэнгүй"
        );
      }
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Тооллого
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Бодит тоог бичээд зөрүүг тохируулгын ноорог болгоно · тоолоогүй
            мөр хөндөгдөхгүй
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <SearchableSelect
              value={selectedWarehouseId}
              onChange={(value) => changeParams({ warehouseId: value })}
              options={activeWarehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.code} · ${warehouse.name}`,
              }))}
              placeholder="Агуулах сонгох..."
            />
          </div>
          <Input
            type="date"
            className="h-8 w-40"
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
            onBlur={() => changeParams({ date: dateInput })}
          />
          <Button size="sm" onClick={handleRecord} disabled={isPending}>
            <Icon name="counting" />
            Зөрүү бүртгэх
          </Button>
        </div>
      </div>

      {activeWarehouses.length === 0 ? (
        <EmptyBox text="Идэвхтэй агуулах алга — эхлээд агуулах бүртгэнэ" />
      ) : rows.length === 0 ? (
        <EmptyBox text="Идэвхтэй бараа алга — эхлээд бараа бүртгэнэ" />
      ) : (
        <DataGridDynamic<CountSheetRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.itemId}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
        />
      )}

      {confirmDialog}
    </section>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
      {text}
    </div>
  );
}
