"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createInventoryCategory,
  createInventoryItem,
  createWarehouse,
  toggleInventoryCategory,
  deleteInventoryItem,
  toggleInventoryItem,
  toggleWarehouse,
  updateInventoryCategory,
  updateInventoryItem,
} from "@/lib/actions/inventory";
import { importInventoryItems } from "@/lib/actions/inventory-import";
import {
  ITEM_VAT_MODE_LABELS,
  inventoryItemsSpec,
  type InventoryItemImport,
} from "@/lib/excel/specs";
import type {
  InventoryCategoryView,
  InventoryItemView,
  ItemVatMode,
  WarehouseView,
} from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";

interface Props {
  items: InventoryItemView[];
  warehouses: WarehouseView[];
  categories: InventoryCategoryView[];
}

const VAT_MODE_OPTIONS: { value: ItemVatMode; label: string }[] = [
  { value: "standard", label: "10% (НӨАТ-тай)" },
  { value: "exempt", label: "Чөлөөлөгдсөн" },
  { value: "zero", label: "0%" },
];

type ItemForm = {
  id: string;
  code: string;
  name: string;
  unit: string;
  salesPrice: string;
  minSalesPrice: string;
  barcode: string;
  vatMode: ItemVatMode;
  categoryCode: string;
  revenueAccountNumber: string;
  ebarimtClassificationCode: string;
  ebarimtTaxProductCode: string;
};

const emptyItemForm: ItemForm = {
  id: "",
  code: "",
  name: "",
  unit: "ш",
  salesPrice: "",
  minSalesPrice: "",
  barcode: "",
  vatMode: "standard",
  categoryCode: "",
  revenueAccountNumber: "",
  ebarimtClassificationCode: "",
  ebarimtTaxProductCode: "",
};
const emptyWarehouseForm = { code: "", name: "" };
const emptyCategoryForm = { id: "", code: "", name: "", ebarimtClassificationCode: "" };

/** Хоосон текст → null, бусад нь тоо (server талд ДАХИН шалгагдана). */
function priceInput(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed.replaceAll(",", ""));
}

export function InventoryItemsView({ items, warehouses, categories }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [warehouseForm, setWarehouseForm] = useState(emptyWarehouseForm);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function handleDeleteItem(item: InventoryItemView) {
    const ok = await confirm({
      title: "Бараа устгах",
      description: `${item.code} · ${item.name} барааг бүрмөсөн устгах уу? Хөдөлгөөн, нэхэмжлэх, захиалгад ашиглагдсан бараа устгагдахгүй — идэвхгүй болгоно.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      const result = await deleteInventoryItem(item.id);
      if (result.error) throw new Error(result.error);
    }, "Бараа устгагдлаа");
  }

  const categoryNameByCode = useMemo(
    () => new Map(categories.map((category) => [category.code, category.name])),
    [categories]
  );
  const importSpec = useMemo(
    () =>
      inventoryItemsSpec({
        categoryCodes: new Set(
          categories.filter((category) => category.isActive).map((category) => category.code)
        ),
      }),
    [categories]
  );

  function run(action: () => Promise<unknown>, success: string, close?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        // Action-ууд алдааг { error } УТГААР буцаадаг (lib/action-result.ts).
        const result = (await action()) as { error?: string } | undefined;
        if (result?.error !== undefined) {
          if (close) setError(result.error);
          else toast.error(result.error);
          return;
        }
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

  async function handleImport(values: InventoryItemImport[]) {
    try {
      const result = await importInventoryItems(values);
      if (result.error !== undefined) return result.error;
      const parts = [
        result.created > 0 ? `${result.created} шинээр бүртгэгдэв` : null,
        result.updated > 0 ? `${result.updated} шинэчлэгдэв` : null,
      ].filter(Boolean);
      if (result.failures.length > 0) {
        router.refresh();
        return `${parts.join(", ") || "Юу ч ороогүй"}. Алдаа: ${result.failures
          .slice(0, 3)
          .map((entry) => `${entry.code} — ${entry.error}`)
          .join("; ")}${result.failures.length > 3 ? " …" : ""}`;
      }
      toast.success(parts.join(", ") || "Өөрчлөлт ороогүй");
      router.refresh();
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Импорт амжилтгүй";
    }
  }

  const itemColumns = useMemo<ColDef<InventoryItemView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 120, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 180, flex: 1 },
      { headerName: "Хэмжих нэгж", field: "unit", width: 110 },
      {
        headerName: "Борлуулах үнэ",
        field: "salesPrice",
        width: 130,
        type: "rightAligned",
        cellClass: "font-mono text-xs text-right",
        valueFormatter: (params) =>
          params.value == null ? "" : fmtMnt(Number(params.value)),
      },
      {
        headerName: "Баркод",
        field: "barcode",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => params.value ?? "",
      },
      {
        headerName: "НӨАТ",
        field: "vatMode",
        width: 120,
        valueFormatter: (params) =>
          ITEM_VAT_MODE_LABELS[(params.value as ItemVatMode) ?? "standard"] ?? "",
      },
      {
        headerName: "Бүлэг",
        field: "categoryCode",
        width: 130,
        valueFormatter: (params) => {
          const code = params.value as string | null;
          if (!code) return "";
          const name = categoryNameByCode.get(code);
          return name ? `${code} · ${name}` : code;
        },
      },
      {
        headerName: "Борлуулах үнэ",
        field: "salesPrice",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) =>
          params.value != null ? fmtMnt(Number(params.value)) : "—",
      },
      {
        headerName: "eBarimt ангилал",
        field: "ebarimtClassificationCode",
        width: 140,
        cellClass: "font-mono text-xs",
        cellRenderer: (params: ICellRendererParams<InventoryItemView>) =>
          params.data?.ebarimtClassificationCode ? (
            <span>{params.data.ebarimtClassificationCode}</span>
          ) : (
            <span className="text-[var(--ea-warning-fg)]">—</span>
          ),
      },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 100,
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
        width: 96,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (params: ICellRendererParams<InventoryItemView>) => (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              className="ea-btn ea-btn--icon"
              title="Засах"
              aria-label="Засах"
              onClick={() => {
                const data = params.data;
                if (!data) return;
                setItemForm({
                  id: data.id,
                  code: data.code,
                  name: data.name,
                  unit: data.unit,
                  salesPrice: data.salesPrice == null ? "" : String(data.salesPrice),
                  minSalesPrice: data.minSalesPrice == null ? "" : String(data.minSalesPrice),
                  barcode: data.barcode ?? "",
                  vatMode: data.vatMode,
                  categoryCode: data.categoryCode ?? "",
                  revenueAccountNumber: data.revenueAccountNumber ?? "",
                  ebarimtClassificationCode: data.ebarimtClassificationCode ?? "",
                  ebarimtTaxProductCode: data.ebarimtTaxProductCode ?? "",
                });
                setError("");
                setItemOpen(true);
              }}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              className="ea-btn ea-btn--icon ea-btn--danger"
              title="Устгах (түүхгүй бараа)"
              aria-label="Устгах"
              onClick={() => params.data && handleDeleteItem(params.data)}
            >
              <Icon name="delete" />
            </button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryNameByCode]
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

  const categoryColumns = useMemo<ColDef<InventoryCategoryView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 130, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 160, flex: 1 },
      {
        headerName: "Идэвхтэй",
        field: "isActive",
        width: 110,
        cellClass: "flex items-center",
        cellRenderer: (params: ICellRendererParams<InventoryCategoryView>) => (
          <Switch
            checked={params.data?.isActive ?? false}
            onCheckedChange={(checked) =>
              params.data &&
              run(
                () => toggleInventoryCategory(params.data!.id, checked),
                checked ? "Бүлэг идэвхжлээ" : "Бүлэг идэвхгүй боллоо"
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
        cellRenderer: (params: ICellRendererParams<InventoryCategoryView>) => (
          <button
            type="button"
            className="ea-btn ea-btn--icon"
            title="Засах"
            aria-label="Засах"
            onClick={() => {
              const data = params.data;
              if (!data) return;
              setCategoryForm({
                id: data.id,
                code: data.code,
                name: data.name,
                ebarimtClassificationCode: data.ebarimtClassificationCode ?? "",
              });
              setError("");
              setCategoryOpen(true);
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

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Бараа, агуулах
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Тоо хэмжээний бүртгэлийн мастер дата — дансны mapping өртгийн
            модулийн тохиргоонд. Борлуулах үнэ, баркод, НӨАТ-ийн горим нь POS-д.
          </p>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 xl:grid-cols-3">
        <div className="flex min-h-0 min-w-0 flex-col xl:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
              Бараа ({items.length})
            </h2>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setImportOpen(true)}
              >
                <Icon name="upload" size="sm" />
                Excel импорт
              </Button>
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
          </div>
          {items.length === 0 ? (
            <EmptyState icon="inventory" title="Бараа бүртгээгүй байна" />
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

        <div className="flex min-h-0 min-w-0 flex-col gap-6">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              <EmptyState icon="warehouse" title="Агуулах бүртгээгүй байна" />
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

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--ea-text-1)]">
                Барааны бүлэг ({categories.length})
              </h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCategoryForm(emptyCategoryForm);
                  setError("");
                  setCategoryOpen(true);
                }}
              >
                <Icon name="add" />
                Бүлэг нэмэх
              </Button>
            </div>
            {categories.length === 0 ? (
              <EmptyState icon="list" title="Бүлэг бүртгээгүй байна" description="Хөнгөлөлтийн дүрэм, тайланд ашиглана." />
            ) : (
              <DataGridDynamic<InventoryCategoryView>
                rowData={categories}
                columnDefs={categoryColumns}
                getRowId={(params) => params.data.id}
                height="flex"
                wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
                suppressCellFocus
              />
            )}
          </div>
        </div>
      </div>

      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spec={importSpec}
        title="Бараа Excel-ээс импортлох"
        onImport={handleImport}
      />

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{itemForm.id ? "Бараа засах" : "Шинэ бараа"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Код">
                <Input
                  value={itemForm.code}
                  disabled={!!itemForm.id}
                  placeholder="Ж: BM-001"
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, code: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Хэмжих нэгж">
                <Input
                  value={itemForm.unit}
                  placeholder="ш / кг / л / м"
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, unit: e.target.value }))
                  }
                />
              </FormField>
            </div>
            <FormField label="Нэр">
              <Input
                value={itemForm.name}
                placeholder="Барааны нэр"
                onChange={(e) =>
                  setItemForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Борлуулах үнэ (₮)">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={itemForm.salesPrice}
                  placeholder="Тогтоогоогүй"
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, salesPrice: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Доод үнэ (₮)">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={itemForm.minSalesPrice}
                  placeholder="Хөнгөлөлтийн доод хязгаар"
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, minSalesPrice: e.target.value }))
                  }
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Баркод">
                <Input
                  value={itemForm.barcode}
                  placeholder="Сканнерын код (сонголтоор)"
                  className="font-mono"
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, barcode: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="НӨАТ">
                {/* Native select — Dialog доторх Base UI popup давхарга
                    дарагддаг тул ea-form-select идиомыг дагана */}
                <select
                  className="ea-form-select"
                  value={itemForm.vatMode}
                  onChange={(e) =>
                    setItemForm((c) => ({
                      ...c,
                      vatMode: e.target.value as ItemVatMode,
                    }))
                  }
                >
                  {VAT_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Бүлэг">
                <select
                  className="ea-form-select"
                  value={itemForm.categoryCode}
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, categoryCode: e.target.value }))
                  }
                >
                  <option value="">— Бүлэггүй —</option>
                  {categories
                    .filter(
                      (category) =>
                        category.isActive || category.code === itemForm.categoryCode
                    )
                    .map((category) => (
                      <option key={category.id} value={category.code}>
                        {category.code} · {category.name}
                      </option>
                    ))}
                </select>
              </FormField>
              <FormField
                label="Орлогын данс"
                hint="хоосон бол POS тохиргооны орлогын данс"
              >
                <Input
                  value={itemForm.revenueAccountNumber}
                  placeholder="8 оронтой данс, ж: 51100000"
                  className="font-mono"
                  maxLength={8}
                  onChange={(e) =>
                    setItemForm((c) => ({
                      ...c,
                      revenueAccountNumber: e.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="eBarimt ангилал"
                hint="ТЕГ-ийн 7 оронтой ангилал — хоосон бол бүлгийнхийг өвлөнө"
              >
                <Input
                  value={itemForm.ebarimtClassificationCode}
                  placeholder="7 орон, ж: 1234567"
                  className="font-mono"
                  maxLength={7}
                  inputMode="numeric"
                  onChange={(e) =>
                    setItemForm((c) => ({
                      ...c,
                      ebarimtClassificationCode: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </FormField>
              <FormField
                label="Татварын бүтээгдэхүүний код"
                hint="3 орон — НӨАТ-гүй / 0% бараанд ЗААВАЛ"
              >
                <Input
                  value={itemForm.ebarimtTaxProductCode}
                  placeholder="3 орон, ж: 101"
                  className="font-mono"
                  maxLength={3}
                  inputMode="numeric"
                  disabled={itemForm.vatMode === "standard"}
                  onChange={(e) =>
                    setItemForm((c) => ({
                      ...c,
                      ebarimtTaxProductCode: e.target.value.replace(/\D/g, ""),
                    }))
                  }
                />
              </FormField>
            </div>
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
              onClick={() => {
                const posFields = {
                  salesPrice: priceInput(itemForm.salesPrice),
                  minSalesPrice: priceInput(itemForm.minSalesPrice),
                  barcode: itemForm.barcode.trim() || null,
                  vatMode: itemForm.vatMode,
                  categoryCode: itemForm.categoryCode || null,
                  revenueAccountNumber: itemForm.revenueAccountNumber.trim() || null,
                  ebarimtClassificationCode: itemForm.ebarimtClassificationCode.trim() || null,
                  ebarimtTaxProductCode:
                    itemForm.vatMode === "standard"
                      ? null
                      : itemForm.ebarimtTaxProductCode.trim() || null,
                };
                run(
                  () =>
                    itemForm.id
                      ? updateInventoryItem(itemForm.id, {
                          name: itemForm.name,
                          unit: itemForm.unit,
                          ...posFields,
                        })
                      : createInventoryItem({
                          code: itemForm.code,
                          name: itemForm.name,
                          unit: itemForm.unit,
                          ...posFields,
                        }),
                  itemForm.id ? "Бараа шинэчлэгдлээ" : "Бараа нэмэгдлээ",
                  () => setItemOpen(false)
                );
              }}
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
            <FormField label="Код">
              <Input
                value={warehouseForm.code}
                placeholder="Ж: AG-01"
                onChange={(e) =>
                  setWarehouseForm((c) => ({ ...c, code: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Нэр">
              <Input
                value={warehouseForm.name}
                placeholder="Агуулахын нэр"
                onChange={(e) =>
                  setWarehouseForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </FormField>
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

      <Dialog open={categoryOpen} onOpenChange={setCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {categoryForm.id ? "Бүлэг засах" : "Шинэ барааны бүлэг"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField label="Код">
              <Input
                value={categoryForm.code}
                disabled={!!categoryForm.id}
                placeholder="Ж: FOOD"
                onChange={(e) =>
                  setCategoryForm((c) => ({ ...c, code: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Нэр">
              <Input
                value={categoryForm.name}
                placeholder="Бүлгийн нэр"
                onChange={(e) =>
                  setCategoryForm((c) => ({ ...c, name: e.target.value }))
                }
              />
            </FormField>
            <FormField
              label="eBarimt ангилал"
              hint="7 орон — бүлгийн бараанд ангилал хоосон бол ЭНЭ код өвлөгдөнө"
            >
              <Input
                value={categoryForm.ebarimtClassificationCode}
                placeholder="7 орон, ж: 1234567"
                className="font-mono"
                maxLength={7}
                inputMode="numeric"
                onChange={(e) =>
                  setCategoryForm((c) => ({
                    ...c,
                    ebarimtClassificationCode: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </FormField>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCategoryOpen(false)}
              disabled={isPending}
            >
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    categoryForm.id
                      ? updateInventoryCategory(categoryForm.id, {
                          name: categoryForm.name,
                          ebarimtClassificationCode:
                            categoryForm.ebarimtClassificationCode.trim() || null,
                        })
                      : createInventoryCategory({
                          code: categoryForm.code,
                          name: categoryForm.name,
                          ebarimtClassificationCode:
                            categoryForm.ebarimtClassificationCode.trim() || null,
                        }),
                  categoryForm.id ? "Бүлэг шинэчлэгдлээ" : "Бүлэг нэмэгдлээ",
                  () => setCategoryOpen(false)
                )
              }
            >
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
  );
}

