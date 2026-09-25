"use client";

import { useNewParam } from "@/components/ui/use-new-param";

// БАРАА — бараа материалын мастер дата (өөрийн хуудас; ангилал, агуулах нь
// тусдаа хуудсанд). Барааны карт нь ДЭЛГЭРЭНГҮЙ: үндсэн мэдээлэл, үнэ ба
// НӨАТ, eBarimt (ангилал 7 орон / татварын код 3 орон — хайлттай сонгогч),
// нэмэлт мэдээлэл, үнийн түүх. Дансны холболт нь өртгийн модулийн тохиргоонд.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { toast } from "sonner";

import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { ClassificationCodePicker, TaxProductCodePicker } from "@/components/inventory/ebarimt-code-pickers";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { FilterChips } from "@/components/ui/tabs";
import {
  createInventoryItem,
  deleteInventoryItem,
  listItemPriceHistory,
  toggleInventoryItem,
  updateInventoryItem,
} from "@/lib/actions/inventory";
import { importInventoryItems } from "@/lib/actions/inventory-import";
import { EBARIMT_BARCODE_TYPES } from "@/lib/ebarimt/constants";
import { taxProductCodeName } from "@/lib/ebarimt/tax-product-codes";
import {
  ITEM_VAT_MODE_LABELS,
  inventoryItemsSpec,
  type InventoryItemImport,
} from "@/lib/excel/specs";
import {
  buildCategoryTree,
  categoryLevelName,
  categoryPathLabel,
  descendantCodes,
  effectiveCategoryClassification,
} from "@/lib/inventory/category-tree";
import type {
  InventoryCategoryView,
  InventoryItemView,
  ItemVatMode,
} from "@/lib/inventory/types";
import { fmtMnt } from "@/lib/reports/balances";

interface Props {
  items: InventoryItemView[];
  categories: InventoryCategoryView[];
  /** Ангиллын түвшний нэрс (дээрээс доош). */
  levels: string[];
  /** НӨАТ төлөгч биш бол НӨАТ / татварын кодын талбар хураагдана (SIM2-030). */
  isVatPayer?: boolean;
}

const VAT_MODE_OPTIONS: { value: ItemVatMode; label: string }[] = [
  { value: "standard", label: "10% (НӨАТ-тай)" },
  { value: "exempt", label: "Чөлөөлөгдсөн" },
  { value: "zero", label: "0%" },
];

const BARCODE_TYPE_LABELS: Record<(typeof EBARIMT_BARCODE_TYPES)[number], string> = {
  UNDEFINED: "Тодорхойгүй / дотоод код",
  GS1: "GS1 (EAN/UPC — олон улсын)",
  ISBN: "ISBN (ном)",
};

/** Түгээмэл хэмжих нэгж — санал (өөр нэгж бичиж болно). */
const UNIT_SUGGESTIONS = ["ш", "кг", "гр", "л", "мл", "м", "м²", "м³", "хайрцаг", "багц", "боодол", "уут", "шил", "лааз", "хос", "цаг", "үйлчилгээ"];

type StatusFilter = "active" | "inactive" | "no_ebarimt" | "all";

type ItemForm = {
  id: string;
  code: string;
  name: string;
  unit: string;
  categoryCode: string;
  salesPrice: string;
  minSalesPrice: string;
  vatMode: ItemVatMode;
  revenueAccountNumber: string;
  barcode: string;
  barcodeType: string;
  ebarimtClassificationCode: string;
  ebarimtTaxProductCode: string;
  brand: string;
  manufacturer: string;
  originCountry: string;
  description: string;
};

const emptyItemForm: ItemForm = {
  id: "",
  code: "",
  name: "",
  unit: "ш",
  categoryCode: "",
  salesPrice: "",
  minSalesPrice: "",
  vatMode: "standard",
  revenueAccountNumber: "",
  barcode: "",
  barcodeType: "",
  ebarimtClassificationCode: "",
  ebarimtTaxProductCode: "",
  brand: "",
  manufacturer: "",
  originCountry: "",
  description: "",
};

type PriceHistoryEntry = { salesPrice: number | null; effectiveFrom: string; createdAt: string };

/** Хоосон текст → null, бусад нь тоо (server талд ДАХИН шалгагдана). */
function priceInput(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed.replaceAll(",", ""));
}

function formOf(item: InventoryItemView): ItemForm {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    categoryCode: item.categoryCode ?? "",
    salesPrice: item.salesPrice == null ? "" : String(item.salesPrice),
    minSalesPrice: item.minSalesPrice == null ? "" : String(item.minSalesPrice),
    vatMode: item.vatMode,
    revenueAccountNumber: item.revenueAccountNumber ?? "",
    barcode: item.barcode ?? "",
    barcodeType: item.barcodeType ?? "",
    ebarimtClassificationCode: item.ebarimtClassificationCode ?? "",
    ebarimtTaxProductCode: item.ebarimtTaxProductCode ?? "",
    brand: item.brand ?? "",
    manufacturer: item.manufacturer ?? "",
    originCountry: item.originCountry ?? "",
    description: item.description ?? "",
  };
}

/** Маягтын хэсгийн гарчиг. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-4 rounded-lg border border-[var(--ea-border)] p-4">
      <legend className="px-1 text-xs font-semibold text-[var(--ea-text-2)]">
        {title}
        {hint && <span className="ml-2 font-normal text-[var(--ea-text-4)]">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

export function InventoryItemsView({ items, categories, levels, isVatPayer = true }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [itemOpen, setItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[] | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const categoryOptions = useMemo(
    () =>
      tree
        .filter((row) => row.node.isActive || row.node.code === itemForm.categoryCode)
        .map((row) => ({
          value: row.node.code,
          label: row.pathLabel,
          hint: categoryLevelName(row.depth, levels),
        })),
    [tree, levels, itemForm.categoryCode]
  );
  const filterCategoryOptions = useMemo(
    () =>
      tree.map((row) => ({
        value: row.node.code,
        label: row.pathLabel,
        hint: categoryLevelName(row.depth, levels),
      })),
    [tree, levels]
  );

  /** Бараа → eBarimt ангилал: өөрийн, эсвэл ангиллын модноос өвлөсөн. */
  const effectiveClassification = (item: Pick<InventoryItemView, "ebarimtClassificationCode" | "categoryCode">) =>
    item.ebarimtClassificationCode?.trim() ||
    effectiveCategoryClassification(item.categoryCode, categories) ||
    null;

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let noEbarimt = 0;
    for (const item of items) {
      if (item.isActive) active += 1;
      else inactive += 1;
      if (item.isActive && !effectiveClassification(item)) noEbarimt += 1;
    }
    return { active, inactive, noEbarimt };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories]);

  const visibleItems = useMemo(() => {
    const scope = categoryFilter ? descendantCodes(categoryFilter, categories) : null;
    return items.filter((item) => {
      if (scope && !(item.categoryCode && scope.has(item.categoryCode))) return false;
      if (status === "active") return item.isActive;
      if (status === "inactive") return !item.isActive;
      if (status === "no_ebarimt") return item.isActive && !effectiveClassification(item);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories, categoryFilter, status]);

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
        const message = caught instanceof Error ? caught.message : "Хадгалж чадсангүй";
        if (close) setError(message);
        else toast.error(message);
      }
    });
  }

  function openCreate() {
    setItemForm({ ...emptyItemForm, categoryCode: categoryFilter });
    setPriceHistory(null);
    setError("");
    setItemOpen(true);
  }
  // SIM2-032: «+ Шинэ» цэсийн «Лавлах» (?new=1).
  useNewParam(openCreate);

  function openEdit(item: InventoryItemView) {
    setItemForm(formOf(item));
    setError("");
    setPriceHistory(null);
    setItemOpen(true);
    // Үнийн түүх — зөвхөн засахад (аудит, харах).
    void listItemPriceHistory(item.id)
      .then((history) => setPriceHistory(history.slice(0, 6)))
      .catch(() => setPriceHistory([]));
  }

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

  function save() {
    const fields = {
      salesPrice: priceInput(itemForm.salesPrice),
      minSalesPrice: priceInput(itemForm.minSalesPrice),
      barcode: itemForm.barcode.trim() || null,
      barcodeType: itemForm.barcode.trim() ? itemForm.barcodeType || null : null,
      vatMode: itemForm.vatMode,
      categoryCode: itemForm.categoryCode || null,
      revenueAccountNumber: itemForm.revenueAccountNumber.trim() || null,
      ebarimtClassificationCode: itemForm.ebarimtClassificationCode.trim() || null,
      ebarimtTaxProductCode:
        itemForm.vatMode === "standard" ? null : itemForm.ebarimtTaxProductCode.trim() || null,
      brand: itemForm.brand.trim() || null,
      manufacturer: itemForm.manufacturer.trim() || null,
      originCountry: itemForm.originCountry.trim() || null,
      description: itemForm.description.trim() || null,
    };
    run(
      () =>
        itemForm.id
          ? updateInventoryItem(itemForm.id, { name: itemForm.name, unit: itemForm.unit, ...fields })
          : createInventoryItem({ code: itemForm.code, name: itemForm.name, unit: itemForm.unit, ...fields }),
      itemForm.id ? "Бараа шинэчлэгдлээ" : "Бараа нэмэгдлээ",
      () => setItemOpen(false)
    );
  }

  const itemColumns = useMemo<ColDef<InventoryItemView>[]>(
    () => [
      { headerName: "Код", field: "code", width: 120, cellClass: "font-mono text-xs" },
      { headerName: "Нэр", field: "name", minWidth: 200, flex: 1 },
      {
        headerName: "Ангилал",
        field: "categoryCode",
        minWidth: 170,
        flex: 1,
        valueFormatter: (params) => categoryPathLabel(params.value as string | null, categories),
        tooltipValueGetter: (params) => categoryPathLabel(params.value as string | null, categories),
      },
      { headerName: "Нэгж", field: "unit", width: 90 },
      {
        headerName: "Борлуулах үнэ",
        field: "salesPrice",
        width: 140,
        cellClass: "ag-right-aligned-cell font-mono",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => (params.value != null ? fmtMnt(Number(params.value)) : "—"),
      },
      {
        headerName: "НӨАТ",
        field: "vatMode",
        width: 120,
        valueFormatter: (params) =>
          ITEM_VAT_MODE_LABELS[(params.value as ItemVatMode) ?? "standard"] ?? "",
      },
      {
        headerName: "Баркод",
        field: "barcode",
        width: 140,
        cellClass: "font-mono text-xs",
        valueFormatter: (params) => params.value ?? "",
      },
      {
        headerName: "eBarimt ангилал",
        colId: "ebarimt",
        width: 150,
        valueGetter: (params) => (params.data ? effectiveClassification(params.data) ?? "" : ""),
        cellRenderer: (params: ICellRendererParams<InventoryItemView>) => {
          const item = params.data;
          if (!item) return null;
          if (item.ebarimtClassificationCode)
            return <span className="font-mono text-xs">{item.ebarimtClassificationCode}</span>;
          const inherited = effectiveCategoryClassification(item.categoryCode, categories);
          if (inherited)
            return (
              <span className="font-mono text-xs text-[var(--ea-text-4)]" title="Ангиллаас өвлөсөн">
                {inherited} ↑
              </span>
            );
          return <span className="text-[var(--ea-warning-fg)]" title="eBarimt баримт илгээгдэхгүй">—</span>;
        },
      },
      {
        headerName: "Брэнд",
        field: "brand",
        width: 120,
        valueFormatter: (params) => params.value ?? "",
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
              onClick={() => params.data && openEdit(params.data)}
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
    [categories]
  );

  const inheritedClassification = effectiveCategoryClassification(itemForm.categoryCode || null, categories);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Бараа</h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Барааны карт — ангилал, үнэ, НӨАТ, eBarimt код, нэмэлт мэдээлэл. Дансны холболт
            өртгийн модулийн тохиргоонд; ангилал ба агуулах тусдаа хуудсанд.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size="sm" />
            Excel импорт
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Icon name="add" />
            Бараа нэмэх
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips<StatusFilter>
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Идэвхтэй", count: counts.active },
            { value: "no_ebarimt", label: "eBarimt ангилалгүй", count: counts.noEbarimt, tone: "warning" },
            { value: "inactive", label: "Идэвхгүй", count: counts.inactive },
            { value: "all", label: "Бүгд", count: items.length },
          ]}
        />
        <div className="w-full sm:w-72">
          <SearchableSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={filterCategoryOptions}
            hideValue
            placeholder="Бүх ангилал"
          />
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="inventory" title="Бараа бүртгээгүй байна" />
      ) : (
        <DataGridDynamic<InventoryItemView>
          rowData={visibleItems}
          columnDefs={itemColumns}
          getRowId={(params) => params.data.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => event.data && openEdit(event.data)}
        />
      )}

      <ExcelImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        spec={importSpec}
        title="Бараа Excel-ээс импортлох"
        onImport={handleImport}
      />

      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {itemForm.id ? `Барааны карт — ${itemForm.code}` : "Шинэ бараа"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5">
            <Section title="Үндсэн мэдээлэл">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Код" hint={itemForm.id ? "код өөрчлөгдөхгүй" : undefined}>
                  <Input
                    value={itemForm.code}
                    disabled={!!itemForm.id}
                    placeholder="Ж: BM-001"
                    className="font-mono"
                    onChange={(e) => setItemForm((c) => ({ ...c, code: e.target.value }))}
                  />
                </FormField>
                <FormField label="Нэр" className="sm:col-span-2">
                  <Input
                    value={itemForm.name}
                    placeholder="Барааны нэр"
                    onChange={(e) => setItemForm((c) => ({ ...c, name: e.target.value }))}
                  />
                </FormField>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Ангилал" className="sm:col-span-2">
                  <SearchableSelect
                    value={itemForm.categoryCode}
                    onChange={(categoryCode) => setItemForm((c) => ({ ...c, categoryCode }))}
                    options={categoryOptions}
                    hideValue
                    placeholder="— Ангилалгүй —"
                  />
                </FormField>
                <FormField label="Хэмжих нэгж">
                  <Input
                    value={itemForm.unit}
                    placeholder="ш / кг / л / м"
                    list="inventory-unit-suggestions"
                    onChange={(e) => setItemForm((c) => ({ ...c, unit: e.target.value }))}
                  />
                  <datalist id="inventory-unit-suggestions">
                    {UNIT_SUGGESTIONS.map((unit) => (
                      <option key={unit} value={unit} />
                    ))}
                  </datalist>
                </FormField>
              </div>
            </Section>

            <Section title="Үнэ ба НӨАТ">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Борлуулах үнэ (₮)">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={itemForm.salesPrice}
                    placeholder="Тогтоогоогүй"
                    onChange={(e) => setItemForm((c) => ({ ...c, salesPrice: e.target.value }))}
                  />
                </FormField>
                <FormField label="Доод үнэ (₮)" hint="кассчны хөнгөлөлтийн доод хязгаар">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={itemForm.minSalesPrice}
                    placeholder="Хязгааргүй"
                    onChange={(e) => setItemForm((c) => ({ ...c, minSalesPrice: e.target.value }))}
                  />
                </FormField>
                <FormField
                  label="НӨАТ"
                  hint={isVatPayer ? undefined : "Байгууллага НӨАТ төлөгч биш — борлуулалтад НӨАТ тооцогдохгүй"}
                >
                  {/* Native select — Dialog доторх Base UI popup давхарга дарагддаг */}
                  <select
                    disabled={!isVatPayer}
                    className="ea-form-select"
                    value={itemForm.vatMode}
                    onChange={(e) =>
                      setItemForm((c) => ({ ...c, vatMode: e.target.value as ItemVatMode }))
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
              <FormField label="Орлогын данс" hint="хоосон бол POS тохиргооны орлогын данс">
                <Input
                  value={itemForm.revenueAccountNumber}
                  placeholder="8 оронтой данс, ж: 51100000"
                  className="font-mono sm:max-w-xs"
                  maxLength={8}
                  onChange={(e) =>
                    setItemForm((c) => ({ ...c, revenueAccountNumber: e.target.value }))
                  }
                />
              </FormField>
              {itemForm.id && priceHistory && priceHistory.length > 0 && (
                <div className="text-xs text-[var(--ea-text-3)]">
                  <span className="font-medium text-[var(--ea-text-2)]">Үнийн түүх: </span>
                  {priceHistory
                    .map(
                      (entry) =>
                        `${entry.effectiveFrom} — ${entry.salesPrice == null ? "тогтоогоогүй" : fmtMnt(entry.salesPrice)}`
                    )
                    .join(" · ")}
                </div>
              )}
            </Section>

            <Section title="eBarimt" hint="цахим төлбөрийн баримтад заавал">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Баркод">
                  <Input
                    value={itemForm.barcode}
                    placeholder="Сканнерын код (сонголтоор)"
                    className="font-mono"
                    onChange={(e) => setItemForm((c) => ({ ...c, barcode: e.target.value }))}
                  />
                </FormField>
                <FormField label="Баркодын төрөл">
                  <select
                    className="ea-form-select"
                    value={itemForm.barcodeType}
                    disabled={!itemForm.barcode.trim()}
                    onChange={(e) => setItemForm((c) => ({ ...c, barcodeType: e.target.value }))}
                  >
                    <option value="">— Тодорхойгүй —</option>
                    {EBARIMT_BARCODE_TYPES.filter((type) => type !== "UNDEFINED").map((type) => (
                      <option key={type} value={type}>
                        {BARCODE_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
              <FormField
                label="Бараа, үйлчилгээний ангиллын код (7 орон)"
                hint={
                  !itemForm.ebarimtClassificationCode && inheritedClassification
                    ? `Хоосон бол ангиллаас өвлөнө: ${inheritedClassification}`
                    : "ТЕГ/ҮСХ-ын нэгдсэн ангилал — код эсвэл нэрээр хайна"
                }
              >
                <ClassificationCodePicker
                  value={itemForm.ebarimtClassificationCode}
                  onChange={(code) => setItemForm((c) => ({ ...c, ebarimtClassificationCode: code }))}
                />
              </FormField>
              {isVatPayer && (
              <FormField
                label="Татварын бүтээгдэхүүний код (3 орон)"
                hint={
                  itemForm.vatMode === "standard"
                    ? "НӨАТ-гүй / 0% бараанд л шаардана"
                    : taxProductCodeName(itemForm.ebarimtTaxProductCode) ?? "НӨАТ-гүй / 0% бараанд ЗААВАЛ"
                }
              >
                <TaxProductCodePicker
                  vatMode={itemForm.vatMode}
                  value={itemForm.vatMode === "standard" ? "" : itemForm.ebarimtTaxProductCode}
                  onChange={(code) => setItemForm((c) => ({ ...c, ebarimtTaxProductCode: code }))}
                />
              </FormField>
              )}
            </Section>

            <Section title="Нэмэлт мэдээлэл" hint="сонголтоор">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Брэнд">
                  <Input
                    value={itemForm.brand}
                    maxLength={120}
                    onChange={(e) => setItemForm((c) => ({ ...c, brand: e.target.value }))}
                  />
                </FormField>
                <FormField label="Үйлдвэрлэгч">
                  <Input
                    value={itemForm.manufacturer}
                    maxLength={160}
                    onChange={(e) => setItemForm((c) => ({ ...c, manufacturer: e.target.value }))}
                  />
                </FormField>
                <FormField label="Гарал үүслийн улс">
                  <Input
                    value={itemForm.originCountry}
                    maxLength={80}
                    placeholder="Ж: Монгол"
                    onChange={(e) => setItemForm((c) => ({ ...c, originCountry: e.target.value }))}
                  />
                </FormField>
              </div>
              <FormField label="Тайлбар">
                <textarea
                  className="min-h-20 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  value={itemForm.description}
                  maxLength={2000}
                  rows={3}
                  placeholder="Барааны онцлог, хадгалах нөхцөл, бүрдэл…"
                  onChange={(e) => setItemForm((c) => ({ ...c, description: e.target.value }))}
                />
              </FormField>
            </Section>

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
            <Button disabled={isPending} onClick={save}>
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </section>
  );
}
