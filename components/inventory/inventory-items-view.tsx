"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createInventoryItem,
  createWarehouse,
  toggleInventoryItem,
  toggleWarehouse,
  updateInventoryItem,
} from "@/lib/actions/inventory";
import type { InventoryItemView, WarehouseView } from "@/lib/inventory/types";

interface Props {
  items: InventoryItemView[];
  warehouses: WarehouseView[];
}

const emptyItemForm = { id: "", code: "", name: "", unit: "ш" };
const emptyWarehouseForm = { code: "", name: "" };

export function InventoryItemsView({ items, warehouses }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState(emptyWarehouseForm);
  const [error, setError] = useState("");

  function run(action: () => Promise<unknown>, success: string, close?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        await action();
        close?.();
        router.refresh();
        toast.success(success);
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй";
        if (close) setError(message);
        else toast.error(message);
      }
    });
  }

  const itemColumns = useMemo<ColDef<InventoryItemView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 130, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 200, flex: 1 },
      { headerName: "Хэмжих нэгж", field: "unit", width: 120 },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 110,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<InventoryItemView>) => (
          <Switch
            checked={params.data?.isActive ?? false}
            onCheckedChange={(checked) =>
              params.data &&
              run(
                () => toggleInventoryItem(params.data!.id, checked),
                checked ? "Бараа идэвхжлээ" : "Бараа идэвхгүй боллоо"
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
        cellRenderer: (params: ICellRendererParams<InventoryItemView>) => (
          <button
            type="button"
            className="ea-btn ea-btn--icon"
            title="Засах"
            aria-label="Засах"
            onClick={() => {
              const data = params.data;
              if (!data) return;
              setItemForm({ id: data.id, code: data.code, name: data.name, unit: data.unit });
              setError("");
              setItemOpen(true);
            }}
          >
            <Icon name="edit" />
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const warehouseColumns = useMemo<ColDef<WarehouseView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 130, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 200, flex: 1 },
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
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Бараа, агуулах
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Тоо хэмжээний бүртгэлийн мастер дата — дансны mapping өртгийн
            модулийн тохиргоонд.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-2">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Бараа ({items.length})
            </h2>
            <Button
              size="sm"
              onClick={() => {
                setItemForm(emptyItemForm);
                setError("");
                setItemOpen(true);
              }}
            >
              <Icon name="add" />
              Бараа нэмэх
            </Button>
          </div>
          {items.length === 0 ? (
            <EmptyBox text="Бараа бүртгээгүй байна" />
          ) : (
            <DataGridDynamic<InventoryItemView>
              rowData={items}
              columnDefs={itemColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Агуулах ({warehouses.length})
            </h2>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setWarehouseForm(emptyWarehouseForm);
                setError("");
                setWarehouseOpen(true);
              }}
            >
              <Icon name="add" />
              Агуулах нэмэх
            </Button>
          </div>
          {warehouses.length === 0 ? (
            <EmptyBox text="Агуулах бүртгээгүй байна" />
          ) : (
            <DataGridDynamic<WarehouseView>
              rowData={warehouses}
              columnDefs={warehouseColumns}
              getRowId={(params) => params.data.id}
              height="flex"
              wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
              suppressCellFocus
            />
          )}
        </div>
      </div>

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{itemForm.id ? "Бараа засах" : "Шинэ бараа"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Код">
              <Input
                value={itemForm.code}
                disabled={!!itemForm.id}
                placeholder="Ж: BM-001"
                onChange={(e) =>
                  setItemForm((c) => ({ ...c, code: e.target.value }))
                }
              />
            </Field>
            <Field label="Нэр">
              <Input
                value={itemForm.name}
                placeholder="Барааны нэр"
                onChange={(e) =>
                  setItemForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </Field>
            <Field label="Хэмжих нэгж">
              <Input
                value={itemForm.unit}
                placeholder="ш / кг / л / м"
                onChange={(e) =>
                  setItemForm((c) => ({ ...c, unit: e.target.value }))
                }
              />
            </Field>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    itemForm.id
                      ? updateInventoryItem(itemForm.id, {
                          name: itemForm.name,
                          unit: itemForm.unit,
                        })
                      : createInventoryItem({
                          code: itemForm.code,
                          name: itemForm.name,
                          unit: itemForm.unit,
                        }),
                  itemForm.id ? "Бараа шинэчлэгдлээ" : "Бараа нэмэгдлээ",
                  () => setItemOpen(false)
                )
              }
            >
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={warehouseOpen} onOpenChange={setWarehouseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Шинэ агуулах</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Код">
              <Input
                value={warehouseForm.code}
                placeholder="Ж: AG-01"
                onChange={(e) =>
                  setWarehouseForm((c) => ({ ...c, code: e.target.value }))
                }
              />
            </Field>
            <Field label="Нэр">
              <Input
                value={warehouseForm.name}
                placeholder="Агуулахын нэр"
                onChange={(e) =>
                  setWarehouseForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </Field>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWarehouseOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => createWarehouse(warehouseForm),
                  "Агуулах нэмэгдлээ",
                  () => setWarehouseOpen(false)
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function EmptyBox({ text }: { text: string }) {
  return (
    <div className="flex min-h-40 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
      {text}
    </div>
  );
}
