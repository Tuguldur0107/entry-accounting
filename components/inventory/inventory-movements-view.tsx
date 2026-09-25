"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Icon } from "@/components/ui/icon";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type {
  ColDef,
  GridApi,
  ICellRendererParams,
  SelectionChangedEvent,
} from "ag-grid-community";
import { toast } from "sonner";

import { AttachmentList } from "@/components/attachments/attachment-list";
import { GENERIC_ATTACHMENT_KINDS } from "@/lib/attachments/constants";
import { DataGridDynamic } from "@/components/datagrid/DataGridDynamic";
import { Button } from "@/components/ui/button";
import { FilterChips, PageTabs } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import {
  cancelInventoryMovement,
  confirmInventoryMovement,
  confirmInventoryMovements,
  createInventoryMovement,
  deleteInventoryMovement,
  updateInventoryMovement,
} from "@/lib/actions/inventory";
import { createOpeningStock } from "@/lib/actions/opening-stock";
import { ExcelImportDialog } from "@/components/excel/excel-import-dialog";
import { useModuleCan } from "@/components/layout/module-access-context";
import { openingStockSpec, type OpeningStockImport } from "@/lib/excel/specs";
import type {
  InventoryItemView,
  InventoryMovementView,
  WarehouseView,
} from "@/lib/inventory/types";
import type { MovementType } from "@/lib/inventory/balances";
import { cn } from "@/lib/utils";
import { currentDocumentDate } from "@/lib/periods/document-date";
import { col } from "@/lib/grid/columnTypes";

const TYPE_LABELS: Record<string, string> = {
  receipt: "Орлого",
  issue: "Зарлага",
  transfer: "Шилжүүлэг",
  adjustment: "Тохируулга",
  return_in: "Буцаалт (ирсэн)",
  return_out: "Буцаалт (гарсан)",
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
  date: currentDocumentDate(),
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
  // Нээлтийн барааны үлдэгдэл (SIM2-007): бичих эрхтэй бол импортлоно;
  // өртгийн батлах эрхтэй бол шууд GL-д, эс бөгөөс ноорог өртгийн бичилт.
  const canWrite = useModuleCan("inv", "write");
  const canPostCost = useModuleCan("cost", "post");
  const [openingOpen, setOpeningOpen] = useState(false);
  const openingSpec = useMemo(
    () =>
      openingStockSpec({
        itemCodes: new Set(items.filter((item) => item.isActive).map((item) => item.code)),
        warehouseCodes: new Set(warehouses.filter((wh) => wh.isActive).map((wh) => wh.code)),
      }),
    [items, warehouses]
  );

  async function handleOpeningImport(values: OpeningStockImport[]) {
    const dates = [...new Set(values.map((value) => value.date))];
    if (dates.length !== 1)
      return `Бүх мөр НЭГ нээлтийн огноотой байна (одоо: ${dates.join(", ")})`;
    try {
      const result = await createOpeningStock({
        date: dates[0],
        lines: values.map(({ itemCode, warehouseCode, quantity, unitCost }) => ({
          itemCode,
          warehouseCode,
          quantity,
          unitCost,
        })),
        post: canPostCost,
      });
      if (result.error !== undefined) return result.error;
      toast.success(
        result.status === "posted"
          ? `Нээлтийн үлдэгдэл: ${result.created} мөр, ${result.totalAmount.toLocaleString("en-US")}₮ — журнал ${result.voucherNo ?? ""}`
          : `Нээлтийн үлдэгдэл: ${result.created} мөр ноорог өртгийн бичилттэй — Өртөг → Өртгийн бичилтээс батална`
      );
      router.refresh();
    } catch (caught) {
      return caught instanceof Error ? caught.message : "Импорт амжилтгүй";
    }
  }

  const activeTab: TypeTab = TYPE_TABS.some((t) => t.value === initialType)
    ? (initialType as TypeTab)
    : "all";
  const activeStatus: StatusTab = STATUS_TABS.some((t) => t.value === initialStatus)
    ? (initialStatus as StatusTab)
    : "all";

  // Топбарын "+ Шинэ" цэс (болон F2) ?new=1 параметртэй энэ хуудас руу
  // үсэргэдэг — үүсгэх цонхыг шууд нээнэ. State-ээ render үед тохируулна
  // (React-ийн "adjust state when props change" хэв маяг — effect дотор
  // setState хийхийг lint хориглодог).
  const wantsNew = searchParams.get("new") !== null;
  const [prevWantsNew, setPrevWantsNew] = useState(false);
  if (wantsNew !== prevWantsNew) {
    setPrevWantsNew(wantsNew);
    if (wantsNew) {
      setForm(initialForm());
      setError("");
      setEditingId(null);
      setOpen(true);
    }
  }

  // Параметрыг URL-ээс цэвэрлэнэ — refresh/буцахад цонх дахин нээгдэхгүй.
  useEffect(() => {
    if (searchParams.get("new") === null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ""}`
    );
  }, [searchParams, pathname, router]);

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
    (action: () => Promise<{ error?: string }>, successMessage: string) => {
      startTransition(async () => {
        try {
          // Action алдааг шидэхгүй — { error } утгаар буцаана (production
          // дээр Next.js шидсэн мессежийг нуудаг тул).
          const result = await action();
          if (result.error) {
            toast.error(result.error);
            return;
          }
          router.refresh();
          toast.success(successMessage);
        } catch {
          toast.error("Үйлдэл амжилтгүй");
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
    async (id: string, status: string) => {
      const ok = await confirm({
        title: status === "draft" ? "Ноорог устгах" : "Хөдөлгөөн устгах",
        description:
          status === "draft"
            ? "Энэ ноорог хөдөлгөөнийг бүрмөсөн устгах уу?"
            : "Энэ хөдөлгөөнийг бүрмөсөн устгах уу? (Үнэлэгдсэн бол эхлээд өртгийн бичилтийг нь буцаана; үлдэгдэл хасах болохоор бол татгалзана.)",
        confirmText: "Устгах",
        danger: true,
      });
      if (!ok) return;
      runAction(() => deleteInventoryMovement(id), "Хөдөлгөөн устгагдлаа");
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
        if (result.error !== undefined) {
          toast.error(result.error);
          return;
        }
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
      // Төлөв — зүүн талд бэхэлсэн дүрс (lib/status.ts, UI гайдын карт 1).
      col<InventoryMovementView>({ eaType: "status", field: "status" }),
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
                    <Icon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="ea-btn ea-btn--icon ea-btn--success"
                    title="Батлах"
                    aria-label="Батлах"
                    onClick={() => handleConfirm(movement)}
                  >
                    <Icon name="approve" />
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
                  <Icon name="cancel" />
                </button>
              )}
              <button
                type="button"
                className="ea-btn ea-btn--icon ea-btn--danger"
                title={
                  movement.status === "draft"
                    ? "Ноорог устгах"
                    : "Бүрмөсөн устгах"
                }
                aria-label="Устгах"
                onClick={() => handleDelete(movement.id, movement.status)}
              >
                <Icon name="delete" />
              </button>
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
          const updated = await updateInventoryMovement(editingId, payload);
          if (updated.error) {
            setError(updated.error);
            return;
          }
          if (confirmNow) {
            const confirmed = await confirmInventoryMovement(editingId);
            if (confirmed.error) {
              setError(confirmed.error);
              return;
            }
          }
        } else {
          const created = await createInventoryMovement({
            ...payload,
            documentNo: form.documentNo || undefined,
            confirmNow,
          });
          if (created.error) {
            setError(created.error);
            return;
          }
        }
        setOpen(false);
        setEditingId(null);
        router.refresh();
        toast.success(
          confirmNow ? "Хөдөлгөөн бүртгэгдэж батлагдлаа" : "Ноорог хадгалагдлаа"
        );
      } catch {
        setError("Хадгалж чадсангүй");
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
        <div className="flex items-center gap-2">
          {canWrite && (
            <Button
              variant="outline"
              onClick={() => setOpeningOpen(true)}
              title="Нээлтийн барааны үлдэгдлийг өртөгтэй нь Excel-ээс оруулна (Dr нөөц / Cr нээлтийн зөрүүний данс)"
            >
              <Icon name="upload" />
              Нээлтийн үлдэгдэл
            </Button>
          )}
          <Button
            onClick={() => {
              setForm(initialForm());
              setError("");
              setEditingId(null);
              setOpen(true);
            }}
          >
            <Icon name="add" />
            Шинэ хөдөлгөөн
          </Button>
        </div>
      </div>

      <ExcelImportDialog
        open={openingOpen}
        onOpenChange={setOpeningOpen}
        spec={openingSpec}
        title="Нээлтийн барааны үлдэгдэл (өртөгтэй) импортлох"
        onImport={handleOpeningImport}
      />

      <PageTabs
        tabs={TYPE_TABS}
        value={activeTab}
        onChange={(value) => changeParam("type", value)}
        trailing={
          <>
            <FilterChips
              options={STATUS_TABS.map((chip) => ({
                ...chip,
                count:
                  chip.value !== "all" ? statusCounts[chip.value] : undefined,
                tone:
                  chip.value === "draft" && statusCounts.draft > 0
                    ? ("warning" as const)
                    : undefined,
              }))}
              value={activeStatus}
              onChange={(value) => changeParam("status", value)}
            />
            {selectedDrafts.length > 0 && (
              <Button
                size="sm"
                className="ml-1.5 h-7"
                onClick={handleBatchConfirm}
                disabled={isPending}
              >
                <Icon name="approveAll" />
                Сонгосныг батлах ({selectedDrafts.length})
              </Button>
            )}
          </>
        }
      />

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
              <FormField label="Огноо">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((c) => ({ ...c, date: e.target.value }))}
                />
              </FormField>
              <FormField label="Баримтын дугаар">
                <Input
                  value={form.documentNo}
                  placeholder="Хоосон бол автоматаар үүснэ"
                  maxLength={40}
                  disabled={!!editingId}
                  onChange={(e) =>
                    setForm((c) => ({ ...c, documentNo: e.target.value }))
                  }
                />
              </FormField>
            </div>

            <FormField label="Бараа">
              <SearchableSelect
                value={form.itemId}
                onChange={(value) => setForm((c) => ({ ...c, itemId: value }))}
                options={activeItems.map((item) => ({
                  value: item.id,
                  label: `${item.code} · ${item.name}`,
                  hint: item.unit,
                }))}
                placeholder="Бараа сонгох..."
              hideValue
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
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
                hideValue
                />
              </FormField>
              {form.movementType === "transfer" ? (
                <FormField label="Хүлээн авах агуулах">
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
                  hideValue
                  />
                </FormField>
              ) : (
                <FormField
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
                </FormField>
              )}
            </div>

            {form.movementType === "transfer" && (
              <FormField
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
              </FormField>
            )}

            {(form.movementType === "issue" ||
              form.movementType === "return_out") && (
              <FormField label="Зарлагын төрөл">
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
                hideValue
                />
                <p className="mt-1 text-[11px] text-[var(--ea-text-4)]">
                  Өртгийн бичилтийн ДЕБЕТ чиглэл эндээс шийдэгдэнэ. Сонгохгүй
                  бол анхдагч төрөл (COGS) хэрэглэгдэнэ.
                </p>
              </FormField>
            )}

            <FormField label="Тайлбар">
              <Input
                value={form.description}
                placeholder="Хөдөлгөөний утга"
                onChange={(e) =>
                  setForm((c) => ({ ...c, description: e.target.value }))
                }
              />
            </FormField>

            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}

            {/* Хавсралт — зөвхөн хадгалагдсан хөдөлгөөнд (шинэд id алга). */}
            {editingId && (
              <FormField label="Хавсралт">
                <AttachmentList
                  entityType="inventory"
                  entityId={editingId}
                  kinds={GENERIC_ATTACHMENT_KINDS}
                />
              </FormField>
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
              <Icon name="approve" />
              Хадгалж батлах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </section>
  );
}

