"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { Ban, Check, CheckCheck, Pencil, Plus, Trash2 } from "lucide-react";
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
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  cancelInventoryMovement,
  confirmInventoryMovement,
  confirmInventoryMovements,
  createInventoryMovement,
  deleteInventoryMovement,
  updateInventoryMovement,
} from "@/lib/actions/inventory";
import type {
  InventoryItemView,
  InventoryMovementView,
  WarehouseView,
} from "@/lib/inventory/types";
import type { MovementType } from "@/lib/inventory/balances";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  issue: "Зарлага",
  transfer: "Шилжүүлэг",
  adjustment: "Тохируулга",
  return_in: "Буцаалт (ирсэн)",
  return_out: "Буцаалт (гарсан)",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Ноорог",
  confirmed: "Баталсан",
  cancelled: "Цуцалсан",
};

type TypeTab = "all" | MovementType;
type StatusTab = "all" | "draft" | "confirmed" | "cancelled";

const TYPE_TABS: { value: TypeTab; label: string }[] = [
  { value: "all", label: "Бүгд" },
  { value: "receipt", label: "Орлого" },
  { value: "issue", label: "Зарлага" },
  { value: "transfer", label: "Шилжүүлэг" },
  { value: "adjustment", label: "Тохируулга" },
  { value: "return_in", label: "Буцаалт ирсэн" },
  { value: "return_out", label: "Буцаалт гарсан" },
];

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "Бүх төлөв" },
  { value: "draft", label: "Ноорог" },
  { value: "confirmed", label: "Баталсан" },
  { value: "cancelled", label: "Цуцалсан" },
];

const fmtQty = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

const initialForm = () => ({
  movementType: "receipt" as MovementType,
  date: new Date().toISOString().slice(0, 10),
  itemId: "",
  warehouseId: "",
  toWarehouseId: "",
  quantity: "",
  documentNo: "",
  description: "",
  issueTypeId: "",
});

export type IssueTypeOption = {
  id: string;
  code: string;
  name: string;
  destinationClass: string;
};

interface Props {
  movements: InventoryMovementView[];
  items: InventoryItemView[];
  warehouses: WarehouseView[];
  /** Идэвхтэй зарлагын төрлүүд — зарлагын дебет чиглэлийг шийднэ. */
  issueTypes: IssueTypeOption[];
  initialType?: string;
  initialStatus?: string;
}

export function InventoryMovementsView({
  movements,
  items,
  warehouses,
  issueTypes,
  initialType,
  initialStatus,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  // null = шинээр үүсгэх; id = ноорог засварлах (sentinel бөглөх гол зам).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const gridApiRef = useRef<GridApi<InventoryMovementView> | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  const activeTab: TypeTab = TYPE_TABS.some((t) => t.value === initialType)
    ? (initialType as TypeTab)
    : "all";
  const activeStatus: StatusTab = STATUS_TABS.some((t) => t.value === initialStatus)
    ? (initialStatus as StatusTab)
    : "all";

  function changeParam(key: "type" | "status", next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete(key);
    else params.set(key, next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`);
  }

  const typeFiltered = useMemo(
    () =>
      activeTab === "all"
        ? movements
        : movements.filter((m) => m.movementType === activeTab),
    [movements, activeTab]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: typeFiltered.length,
      draft: 0,
      confirmed: 0,
      cancelled: 0,
    };
    for (const m of typeFiltered) {
      if (m.status === "draft" || m.status === "confirmed" || m.status === "cancelled")
        counts[m.status] += 1;
    }
    return counts;
  }, [typeFiltered]);

  const visibleMovements = useMemo(
    () =>
      activeStatus === "all"
        ? typeFiltered
        : typeFiltered.filter((m) => m.status === activeStatus),
    [typeFiltered, activeStatus]
  );

  const selectedDrafts = useMemo(
    () =>
      visibleMovements.filter(
        (m) => m.status === "draft" && selectedDraftIds.includes(m.id)
      ),
    [visibleMovements, selectedDraftIds]
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

  const handleConfirm = useCallback(
    async (movement: InventoryMovementView) => {
      const ok = await confirm({
        title: "Хөдөлгөөн батлах",
        description:
          "Тоо хэмжээний бүртгэл эцэслэгдэнэ. GL журнал энд үүсэхгүй — үнэлгээ costing run-аар хийгдэнэ. Батлах уу?",
        confirmText: "Батлах",
      });
      if (!ok) return;
      runAction(
        () => confirmInventoryMovement(movement.id),
        "Хөдөлгөөн батлагдлаа — өртгийн модульд үнэлгээ хүлээгдэнэ"
      );
    },
    [runAction, confirm]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Ноорог устгах",
        description: "Энэ ноорог хөдөлгөөнийг бүрмөсөн устгах уу?",
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(() => deleteInventoryMovement(id), "Ноорог устгагдлаа");
    },
    [runAction, confirm]
  );

  const handleCancel = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: "Хөдөлгөөн цуцлах",
        description:
          "Баталсан хөдөлгөөнийг цуцална (үнэлэгдээгүй тохиолдолд л боломжтой). Цуцлах уу?",
        confirmText: "Цуцлах",
        danger: true,
      });
      if (!ok) return;
      runAction(() => cancelInventoryMovement(id), "Хөдөлгөөн цуцлагдлаа");
    },
    [runAction, confirm]
  );

  const handleBatchConfirm = useCallback(async () => {
    // Он цагийн дарааллаар (орлого түрүүлж) батлана — нэг барааны орлого,
    // зарлагыг зэрэг сонгоход зарлага нь түрүүлж очиж "үлдэгдэл хасах"
    // алдаа өгөхөөс сэргийлнэ.
    const typeOrder: Record<string, number> = {
      receipt: 0,
      return_in: 0,
      adjustment: 1,
      transfer: 2,
      issue: 3,
      return_out: 3,
    };
    const drafts = [...selectedDrafts].sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return (typeOrder[a.movementType] ?? 9) - (typeOrder[b.movementType] ?? 9);
    });
    if (drafts.length === 0) return;
    const ok = await confirm({
      title: "Олноор батлах",
      description: `${drafts.length} ноорог хөдөлгөөнийг батлах уу? Алдаатай нь алгасагдаж тайлан гарна.`,
      confirmText: `Батлах (${drafts.length})`,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await confirmInventoryMovements(drafts.map((d) => d.id));
        gridApiRef.current?.deselectAll();
        setSelectedDraftIds([]);
        router.refresh();
        if (result.failures.length === 0)
          toast.success(`${result.confirmed} хөдөлгөөн батлагдлаа`);
        else {
          const numberById = new Map(drafts.map((d) => [d.id, d.documentNo]));
          toast.warning(
            `${result.confirmed} батлагдаж, ${result.failures.length} алдаатай`,
            {
              description: result.failures
                .map((f) => `${numberById.get(f.id) ?? f.id}: ${f.error}`)
                .join("\n"),
              duration: 10000,
            }
          );
        }
      } catch (caught) {
        toast.error(
          caught instanceof Error ? caught.message : "Олноор батлах амжилтгүй"
        );
      }
    });
  }, [selectedDrafts, confirm, router]);

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<InventoryMovementView>) => {
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

  const columnDefs = useMemo<ColDef<InventoryMovementView>[]>(
    () => [
      { headerName: "Огноо", field: "date", width: 112, cellClass: "font-mono text-xs" },
      {
        headerName: "Баримтын №",
        field: "documentNo",
        width: 190,
        cellClass: "font-mono text-xs",
      },
      {
        headerName: "Төрөл",
        field: "movementType",
        width: 118,
        valueGetter: (params) => TYPE_LABELS[params.data?.movementType ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<InventoryMovementView>) => {
          const type = params.data?.movementType ?? "";
          return (
            <span
              className={cn(
                "text-xs font-medium",
                (type === "receipt" || type === "return_in") &&
                  "text-[var(--ea-success)]",
                (type === "issue" || type === "return_out") &&
                  "text-[var(--ea-danger)]",
                type === "transfer" && "text-[var(--ea-primary)]",
                type === "adjustment" && "text-[var(--ea-warning-fg)]"
              )}
            >
              {TYPE_LABELS[type] ?? type}
            </span>
          );
        },
      },
      { headerName: "Бараа", field: "itemLabel", minWidth: 200, flex: 1 },
      {
        headerName: "Агуулах",
        colId: "warehouse",
        minWidth: 150,
        flex: 1,
        valueGetter: (params) => {
          const m = params.data;
          if (!m) return "";
          return m.movementType === "transfer"
            ? `${m.warehouseName} → ${m.toWarehouseName ?? ""}`
            : m.warehouseName;
        },
      },
      {
        headerName: "Тоо хэмжээ",
        field: "quantity",
        width: 120,
        cellClass: "ag-right-aligned-cell font-mono font-medium",
        headerClass: "ag-right-aligned-header",
        valueFormatter: (params) => fmtQty(Number(params.value ?? 0)),
      },
      { headerName: "Хэмжих нэгж", field: "unit", width: 110 },
      { headerName: "Утга", field: "description", minWidth: 160, flex: 1 },
      {
        headerName: "Төлөв",
        field: "status",
        width: 118,
        valueGetter: (params) => STATUS_LABELS[params.data?.status ?? ""] ?? "",
        cellRenderer: (params: ICellRendererParams<InventoryMovementView>) => {
          const status = params.data?.status ?? "";
          return (
            <div className="flex h-full items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    status === "confirmed"
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
        cellRenderer: (params: ICellRendererParams<InventoryMovementView>) => {
          const movement = params.data;
          if (!movement) return null;
          return (
            <div className="flex items-center justify-end gap-1">
              {movement.status === "draft" && (
                <>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon"
                    title="Засах"
                    aria-label="Засах"
                    onClick={() => {
                      setForm({
                        movementType: movement.movementType as MovementType,
                        date: movement.date,
                        itemId: movement.itemId ?? "",
                        warehouseId: movement.warehouseId ?? "",
                        toWarehouseId: movement.toWarehouseId ?? "",
                        quantity: movement.quantity ? String(movement.quantity) : "",
                        documentNo: movement.documentNo,
                        description: movement.description,
                        issueTypeId: movement.issueTypeId ?? "",
                      });
                      setError("");
                      setEditingId(movement.id);
                      setOpen(true);
                    }}
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Батлах"
                    aria-label="Батлах"
                    onClick={() => handleConfirm(movement)}
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--danger"
                    title="Ноорог устгах"
                    aria-label="Ноорог устгах"
                    onClick={() => handleDelete(movement.id)}
                  >
                    <Trash2 />
                  </button>
                </>
              )}
              {movement.status === "confirmed" && !movement.hasCostEntry && (
                <button
                  type="button"
                  className="ea-btn ea-btn--icon ea-btn--warning"
                  title="Цуцлах"
                  aria-label="Цуцлах"
                  onClick={() => handleCancel(movement.id)}
                >
                  <Ban />
                </button>
              )}
            </div>
          );
        },
      },
    ],
    [handleCancel, handleConfirm, handleDelete]
  );

  function save(confirmNow: boolean) {
    setError("");
    startTransition(async () => {
      try {
        const payload = {
          movementType: form.movementType,
          date: form.date,
          itemId: form.itemId,
          warehouseId: form.warehouseId,
          toWarehouseId: form.toWarehouseId || undefined,
          quantity: Number(form.quantity.replaceAll(",", "")),
          description: form.description,
          issueTypeId: form.issueTypeId || undefined,
        };
        if (editingId) {
          await updateInventoryMovement(editingId, payload);
          if (confirmNow) await confirmInventoryMovement(editingId);
        } else {
          await createInventoryMovement({
            ...payload,
            documentNo: form.documentNo || undefined,
            confirmNow,
          });
        }
        setOpen(false);
        setEditingId(null);
        router.refresh();
        toast.success(
          confirmNow ? "Хөдөлгөөн бүртгэгдэж батлагдлаа" : "Ноорог хадгалагдлаа"
        );
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Хадгалж чадсангүй"
        );
      }
    });
  }

  const activeItems = items.filter((item) => item.isActive);
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.isActive);
  const selectedItem = items.find((item) => item.id === form.itemId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">
            Барааны хөдөлгөөн
          </h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Зөвхөн тоо хэмжээ — үнэлгээ, GL бичилтийг өртгийн модуль хийнэ.
          </p>
        </div>
        <Button
          onClick={() => {
            setForm(initialForm());
            setError("");
            setEditingId(null);
            setOpen(true);
          }}
        >
          <Plus />
          Шинэ хөдөлгөөн
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-0 gap-y-1.5 border-b border-[var(--ea-border)]">
        {TYPE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => changeParam("type", tab.value)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-xs font-medium transition-colors",
              activeTab === tab.value
                ? "border-[var(--ea-primary)] text-[var(--ea-primary)]"
                : "border-transparent text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]"
            )}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 pb-1.5 pl-3">
          {STATUS_TABS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => changeParam("status", chip.value)}
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
              onClick={handleBatchConfirm}
              disabled={isPending}
            >
              <CheckCheck />
              Сонгосныг батлах ({selectedDrafts.length})
            </Button>
          )}
        </div>
      </div>

      {visibleMovements.length === 0 ? (
        <div className="flex min-h-56 flex-1 items-center justify-center rounded-md border border-[var(--ea-border)] text-sm text-[var(--ea-text-4)]">
          Хөдөлгөөн байхгүй
        </div>
      ) : (
        <DataGridDynamic<InventoryMovementView>
          rowData={visibleMovements}
          columnDefs={columnDefs}
          getRowId={(params) => params.data.id}
          height="flex"
          pagination={visibleMovements.length > 25}
          paginationPageSize={25}
          paginationPageSizeSelector={false}
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Хөдөлгөөн засах" : "Шинэ хөдөлгөөн"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div
              className="grid grid-cols-3 overflow-hidden rounded-md border border-[var(--ea-border)]"
              role="group"
              aria-label="Хөдөлгөөний төрөл"
            >
              {(Object.keys(TYPE_LABELS) as MovementType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() =>
                    setForm((current) => ({ ...current, movementType: type }))
                  }
                  className={cn(
                    "h-9 border-b border-r border-[var(--ea-border)] text-xs font-medium [&:nth-child(3n)]:border-r-0 [&:nth-child(n+4)]:border-b-0",
                    form.movementType === type
                      ? "bg-[var(--ea-primary)] text-[var(--primary-foreground)]"
                      : "bg-[var(--ea-bg-2)] text-[var(--ea-text-2)] hover:bg-[var(--ea-bg-3)]"
                  )}
                >
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Огноо">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))}
                />
              </Field>
              <Field label="Баримтын дугаар">
                <Input
                  value={form.documentNo}
                  placeholder="Хоосон бол автоматаар үүснэ"
                  maxLength={40}
                  disabled={!!editingId}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, documentNo: e.target.value }))
                  }
                />
              </Field>
            </div>

            <Field label="Бараа">
              <SearchableSelect
                value={form.itemId}
                onChange={(value) => setForm((c) => ({ ...c, itemId: value }))}
                options={activeItems.map((item) => ({
                  value: item.id,
                  label: `${item.code} · ${item.name}`,
                  hint: item.unit,
                }))}
                placeholder="Бараа сонгох..."
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label={form.movementType === "transfer" ? "Гаргах агуулах" : "Агуулах"}
              >
                <SearchableSelect
                  value={form.warehouseId}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, warehouseId: value }))
                  }
                  options={activeWarehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: `${warehouse.code} · ${warehouse.name}`,
                  }))}
                  placeholder="Агуулах сонгох..."
                />
              </Field>
              {form.movementType === "transfer" ? (
                <Field label="Хүлээн авах агуулах">
                  <SearchableSelect
                    value={form.toWarehouseId}
                    onChange={(value) =>
                      setForm((c) => ({ ...c, toWarehouseId: value }))
                    }
                    options={activeWarehouses.map((warehouse) => ({
                      value: warehouse.id,
                      label: `${warehouse.code} · ${warehouse.name}`,
                    }))}
                    placeholder="Агуулах сонгох..."
                  />
                </Field>
              ) : (
                <Field
                  label={`Тоо хэмжээ${selectedItem ? ` (${selectedItem.unit})` : ""}`}
                >
                  <Input
                    type="number"
                    step="0.0001"
                    value={form.quantity}
                    placeholder={
                      form.movementType === "adjustment"
                        ? "+ илүүдэл / − дутагдал"
                        : "0"
                    }
                    onChange={(e) =>
                      setForm((c) => ({ ...c, quantity: e.target.value }))
                    }
                  />
                </Field>
              )}
            </div>

            {form.movementType === "transfer" && (
              <Field
                label={`Тоо хэмжээ${selectedItem ? ` (${selectedItem.unit})` : ""}`}
              >
                <Input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  value={form.quantity}
                  placeholder="0"
                  onChange={(e) =>
                    setForm((c) => ({ ...c, quantity: e.target.value }))
                  }
                />
              </Field>
            )}

            {(form.movementType === "issue" ||
              form.movementType === "return_out") && (
              <Field label="Зарлагын төрөл">
                <SearchableSelect
                  value={form.issueTypeId}
                  onChange={(value) =>
                    setForm((c) => ({ ...c, issueTypeId: value }))
                  }
                  options={issueTypes.map((type) => ({
                    value: type.id,
                    label: `${type.code} · ${type.name}`,
                    hint: type.destinationClass || undefined,
                  }))}
                  placeholder="Төрөл сонгох..."
                />
                <p className="mt-1 text-[11px] text-[var(--ea-text-4)]">
                  Өртгийн бичилтийн ДЕБЕТ чиглэл эндээс шийдэгдэнэ. Сонгохгүй
                  бол анхдагч төрөл (COGS) хэрэглэгдэнэ.
                </p>
              </Field>
            )}

            <Field label="Тайлбар">
              <Input
                value={form.description}
                placeholder="Хөдөлгөөний утга"
                onChange={(e) =>
                  setForm((c) => ({ ...c, description: e.target.value }))
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
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={isPending}>
              Ноорог хадгалах
            </Button>
            <Button onClick={() => save(true)} disabled={isPending}>
              <Check />
              Хадгалж батлах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
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
