"use client";

// Агуулах — бараа материалын мастер дата (өөрийн хуудас). Хөдөлгөөнтэй
// агуулахыг устгахгүй, идэвхгүй болгоно; код өөрчлөгдөхгүй (баримтын холбоос).

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
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
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createWarehouse, toggleWarehouse, updateWarehouse } from "@/lib/actions/inventory";
import type { WarehouseView } from "@/lib/inventory/types";

const emptyForm = { id: "", code: "", name: "" };

export function InventoryWarehousesView({ warehouses }: { warehouses: WarehouseView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  function run(action: () => Promise<{ error?: string } | void>, success: string, close?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        const result = await action();
        if (result && result.error !== undefined) {
          if (close) setError(result.error);
          else toast.error(result.error);
          return;
        }
        close?.();
        router.refresh();
        toast.success(success);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Хадгалж чадсангүй";
        if (close) setError(message);
        else toast.error(message);
      }
    });
  }

  function openEdit(warehouse: WarehouseView) {
    setForm({ id: warehouse.id, code: warehouse.code, name: warehouse.name });
    setError("");
    setOpen(true);
  }

  const columns = useMemo<ColDef<WarehouseView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 140, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 220, flex: 1 },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 110,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<WarehouseView>) => (
          <Switch
            checked={params.data?.isActive ?? false}
            onCheckedChange={(checked) =>
              params.data &&
              run(
                () => toggleWarehouse(params.data!.id, checked),
                checked ? "Агуулах идэвхжлээ" : "Агуулах идэвхгүй боллоо"
              )
            }
          />
        ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 64,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (params: ICellRendererParams<WarehouseView>) => (
          <button
            type="button"
            className="ea-btn ea-btn--icon"
            title="Засах"
            aria-label="Засах"
            onClick={() => params.data && openEdit(params.data)}
          >
            <Icon name="edit" />
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Агуулах</h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Бараа хадгалах байршил — хөдөлгөөн, тооллого, POS ээлж агуулахаар бүртгэгдэнэ.
            Хөдөлгөөнтэй агуулахыг устгахгүй, идэвхгүй болгоно.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setForm(emptyForm);
            setError("");
            setOpen(true);
          }}
        >
          <Icon name="add" />
          Агуулах нэмэх
        </Button>
      </div>

      {warehouses.length === 0 ? (
        <EmptyState icon="warehouse" title="Агуулах бүртгээгүй байна" />
      ) : (
        <DataGridDynamic<WarehouseView>
          rowData={warehouses}
          columnDefs={columns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => event.data && openEdit(event.data)}
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Агуулах засах" : "Шинэ агуулах"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField label="Код" hint={form.id ? "код өөрчлөгдөхгүй" : undefined}>
              <Input
                value={form.code}
                disabled={!!form.id}
                placeholder="Ж: AG-01"
                className="font-mono"
                onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))}
              />
            </FormField>
            <FormField label="Нэр">
              <Input
                value={form.name}
                placeholder="Агуулахын нэр"
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              />
            </FormField>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    form.id
                      ? updateWarehouse(form.id, { name: form.name })
                      : createWarehouse({ code: form.code, name: form.name }),
                  form.id ? "Агуулах шинэчлэгдлээ" : "Агуулах нэмэгдлээ",
                  () => setOpen(false)
                )
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
