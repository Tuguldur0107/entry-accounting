"use client";

// Барааны АНГИЛАЛ — олон түвшинтэй мод (lib/inventory/category-tree.ts).
// Хүснэгт нь DataGridDynamic (AG Grid Community-д tree data байхгүй тул мод
// DFS дарааллаар хавтгайрч, нэр нь гүнээрээ догол мөртэй). Түвшний нэрс
// (Ерөнхий / Үндсэн / Дэд …) байгууллага бүрд засагдана; хамгийн багадаа 1.

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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ClassificationCodePicker } from "@/components/inventory/ebarimt-code-pickers";
import {
  createInventoryCategory,
  deleteInventoryCategory,
  saveInventoryCategoryLevels,
  toggleInventoryCategory,
  updateInventoryCategory,
} from "@/lib/actions/inventory";
import {
  MAX_CATEGORY_LEVELS,
  buildCategoryTree,
  categoryLevelName,
  descendantCodes,
  effectiveCategoryClassification,
  maxTreeDepth,
  type CategoryTreeRow,
} from "@/lib/inventory/category-tree";
import type { InventoryCategoryView } from "@/lib/inventory/types";

interface Props {
  categories: InventoryCategoryView[];
  /** Түвшний нэрс дээрээс доош (≥ 1). */
  levels: string[];
  /** Ангиллын код → шууд холбогдсон барааны тоо. */
  itemCounts: Record<string, number>;
}

type Row = CategoryTreeRow<InventoryCategoryView> & {
  levelName: string;
  inherited: string | null;
  itemCount: number;
  subtreeItemCount: number;
};

type CategoryForm = {
  id: string;
  code: string;
  name: string;
  parentId: string;
  ebarimtClassificationCode: string;
};

const emptyForm: CategoryForm = {
  id: "",
  code: "",
  name: "",
  parentId: "",
  ebarimtClassificationCode: "",
};

export function InventoryCategoriesView({ categories, levels, itemCounts }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelDraft, setLevelDraft] = useState<string[]>(levels);
  const [error, setError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();

  const tree = useMemo(() => buildCategoryTree(categories), [categories]);
  const usedDepth = useMemo(() => maxTreeDepth(categories), [categories]);

  const rows = useMemo<Row[]>(
    () =>
      tree.map((row) => {
        const own = row.node.ebarimtClassificationCode?.trim() || null;
        const effective = effectiveCategoryClassification(row.node.code, categories);
        let subtreeItemCount = 0;
        for (const code of descendantCodes(row.node.code, categories))
          subtreeItemCount += itemCounts[code] ?? 0;
        return {
          ...row,
          levelName: categoryLevelName(row.depth, levels),
          inherited: !own && effective ? effective : null,
          itemCount: itemCounts[row.node.code] ?? 0,
          subtreeItemCount,
        };
      }),
    [tree, categories, levels, itemCounts]
  );

  function run(action: () => Promise<{ error?: string } | undefined>, success: string, close?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (result?.error !== undefined) {
        if (close) setError(result.error);
        else toast.error(result.error);
        return;
      }
      close?.();
      router.refresh();
      toast.success(success);
    });
  }

  function openCreate(parent?: InventoryCategoryView) {
    setForm({ ...emptyForm, parentId: parent?.id ?? "" });
    setError("");
    setOpen(true);
  }

  function openEdit(category: InventoryCategoryView) {
    setForm({
      id: category.id,
      code: category.code,
      name: category.name,
      parentId: category.parentId ?? "",
      ebarimtClassificationCode: category.ebarimtClassificationCode ?? "",
    });
    setError("");
    setOpen(true);
  }

  async function handleDelete(category: InventoryCategoryView) {
    const ok = await confirm({
      title: "Ангилал устгах",
      description: `${category.code} · ${category.name} ангиллыг устгах уу? Дэд ангилал, бараа, хөнгөлөлтийн дүрэм холбогдсон бол устгагдахгүй — идэвхгүй болгоно уу.`,
      confirmText: "Устгах",
      danger: true,
    });
    if (!ok) return;
    run(() => deleteInventoryCategory(category.id), "Ангилал устгагдлаа");
  }

  // Эцэг сонгогч: өөрөө ба өөрийн удам сонгогдохгүй (цикл), дээд түвшинд
  // хүрсэн ангилал эцэг болж чадахгүй (server ДАХИН шалгана).
  const parentOptions = useMemo(() => {
    const blocked = form.id
      ? descendantCodes(categories.find((c) => c.id === form.id)?.code ?? "", categories)
      : new Set<string>();
    return tree
      .filter((row) => !blocked.has(row.node.code) && row.depth < levels.length)
      .filter((row) => row.node.isActive || row.node.id === form.parentId)
      .map((row) => ({
        value: row.node.id,
        label: row.pathLabel,
        hint: categoryLevelName(row.depth, levels),
      }));
  }, [tree, form.id, form.parentId, categories, levels]);

  const parentRow = tree.find((row) => row.node.id === form.parentId);
  const newDepth = parentRow ? parentRow.depth + 1 : 1;
  const inheritedForForm = parentRow
    ? effectiveCategoryClassification(parentRow.node.code, categories)
    : null;

  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        headerName: "Ангилал",
        colId: "name",
        minWidth: 280,
        flex: 2,
        valueGetter: (params) => params.data?.node.name ?? "",
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <span
              className="flex items-center gap-1.5 truncate"
              style={{ paddingLeft: (row.depth - 1) * 20 }}
              title={row.pathLabel}
            >
              {row.depth > 1 && <span className="text-[var(--ea-text-4)]">└</span>}
              <span className={row.depth === 1 ? "font-medium text-[var(--ea-text-1)]" : "text-[var(--ea-text-2)]"}>
                {row.node.name}
              </span>
              {row.childCount > 0 && (
                <span className="text-[10px] text-[var(--ea-text-4)]">({row.childCount})</span>
              )}
            </span>
          );
        },
      },
      {
        headerName: "Код",
        colId: "code",
        width: 130,
        cellClass: "font-mono text-xs",
        valueGetter: (params) => params.data?.node.code ?? "",
      },
      { headerName: "Түвшин", field: "levelName", width: 150 },
      {
        headerName: "Бараа",
        colId: "items",
        width: 110,
        type: "rightAligned",
        valueGetter: (params) => params.data?.subtreeItemCount ?? 0,
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <span className="font-mono text-xs" title="Дэд ангиллуудын барааг оруулсан">
              {row.subtreeItemCount}
              {row.subtreeItemCount !== row.itemCount && (
                <span className="text-[var(--ea-text-4)]"> ({row.itemCount})</span>
              )}
            </span>
          );
        },
      },
      {
        headerName: "eBarimt ангилал",
        colId: "ebarimt",
        width: 170,
        valueGetter: (params) =>
          params.data?.node.ebarimtClassificationCode ?? params.data?.inherited ?? "",
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          if (row.node.ebarimtClassificationCode)
            return <span className="font-mono text-xs">{row.node.ebarimtClassificationCode}</span>;
          if (row.inherited)
            return (
              <span className="font-mono text-xs text-[var(--ea-text-4)]" title="Эцэг ангиллаас өвлөсөн">
                {row.inherited} ↑
              </span>
            );
          return <span className="text-[var(--ea-warning-fg)]">—</span>;
        },
      },
      {
        headerName: "Идэвхтэй",
        colId: "active",
        width: 100,
        cellClass: "flex items-center",
        valueGetter: (params) => params.data?.node.isActive ?? false,
        cellRenderer: (params: ICellRendererParams<Row>) => (
          <Switch
            checked={params.data?.node.isActive ?? false}
            onCheckedChange={(checked) =>
              params.data &&
              run(
                () => toggleInventoryCategory(params.data!.node.id, checked),
                checked ? "Ангилал идэвхжлээ" : "Ангилал идэвхгүй боллоо"
              )
            }
          />
        ),
      },
      {
        headerName: "",
        colId: "actions",
        width: 128,
        sortable: false,
        filter: false,
        cellClass: "flex items-center justify-end",
        cellRenderer: (params: ICellRendererParams<Row>) => {
          const row = params.data;
          if (!row) return null;
          const canAddChild = row.depth < levels.length;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                className="ea-btn ea-btn--icon"
                title={
                  canAddChild
                    ? `Дэд ангилал нэмэх (${categoryLevelName(row.depth + 1, levels)})`
                    : "Хамгийн доод түвшин — түвшин нэмж байж дэд ангилал үүснэ"
                }
                aria-label="Дэд ангилал нэмэх"
                disabled={!canAddChild}
                onClick={() => openCreate(row.node)}
              >
                <Icon name="add" />
              </button>
              <button
                type="button"
                className="ea-btn ea-btn--icon"
                title="Засах"
                aria-label="Засах"
                onClick={() => openEdit(row.node)}
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                className="ea-btn ea-btn--icon ea-btn--danger"
                title="Устгах (дэд ангилал, бараагүй үед)"
                aria-label="Устгах"
                onClick={() => handleDelete(row.node)}
              >
                <Icon name="delete" />
              </button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [levels]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-lg font-semibold text-[var(--ea-text-1)]">Барааны ангилал</h1>
          <p className="mt-1 text-xs text-[var(--ea-text-3)]">
            Олон түвшинтэй ангилал ({levels.join(" › ")}). Эцэг ангиллын хөнгөлөлтийн дүрэм,
            POS-ийн шүүлт, тайлан нь дэд ангиллын бараанд ч хамаарна; eBarimt ангилал нь
            хоосон бол эцэгээсээ өвлөгдөнө.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLevelDraft(levels);
              setError("");
              setLevelsOpen(true);
            }}
          >
            <Icon name="settings" size="sm" />
            Түвшний тохиргоо
          </Button>
          <Button size="sm" onClick={() => openCreate()}>
            <Icon name="add" />
            {categoryLevelName(1, levels)} нэмэх
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon="list"
          title="Ангилал бүртгээгүй байна"
          description={`Эхлээд «${categoryLevelName(1, levels)}» нэмээд, мөрийн «+» товчоор дэд ангилал үүсгэнэ.`}
        />
      ) : (
        <DataGridDynamic<Row>
          rowData={rows}
          columnDefs={columns}
          getRowId={(params) => params.data.node.id}
          height="flex"
          wrapperClassName="rounded-md border border-[var(--ea-border)] overflow-hidden"
          suppressCellFocus
          onRowDoubleClicked={(event) => event.data && openEdit(event.data.node)}
        />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Ангилал засах" : `Шинэ ${categoryLevelName(newDepth, levels).toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField
              label="Эцэг ангилал"
              hint={
                parentRow
                  ? `${categoryLevelName(newDepth, levels)} болно`
                  : `Хоосон бол «${categoryLevelName(1, levels)}» (эхний түвшин)`
              }
            >
              <SearchableSelect
                value={form.parentId}
                onChange={(parentId) => setForm((current) => ({ ...current, parentId }))}
                options={parentOptions}
                hideValue
                placeholder={`— ${categoryLevelName(1, levels)} (эцэггүй) —`}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Код" hint={form.id ? "код өөрчлөгдөхгүй (бараа кодоор холбогддог)" : undefined}>
                <Input
                  value={form.code}
                  disabled={!!form.id}
                  placeholder="Ж: FOOD-01"
                  className="font-mono"
                  onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))}
                />
              </FormField>
              <FormField label="Нэр">
                <Input
                  value={form.name}
                  placeholder="Ангиллын нэр"
                  onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                />
              </FormField>
            </div>
            <FormField
              label="eBarimt ангилал (7 орон)"
              hint={
                inheritedForForm && !form.ebarimtClassificationCode
                  ? `Хоосон бол эцгээс өвлөнө: ${inheritedForForm}`
                  : "Энэ ангилал ба дэд ангиллын бараанд код хоосон бол өвлөгдөнө"
              }
            >
              <ClassificationCodePicker
                value={form.ebarimtClassificationCode}
                onChange={(code) =>
                  setForm((current) => ({ ...current, ebarimtClassificationCode: code }))
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
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    form.id
                      ? updateInventoryCategory(form.id, {
                          name: form.name,
                          parentId: form.parentId || null,
                          ebarimtClassificationCode: form.ebarimtClassificationCode.trim() || null,
                        })
                      : createInventoryCategory({
                          code: form.code,
                          name: form.name,
                          parentId: form.parentId || null,
                          ebarimtClassificationCode: form.ebarimtClassificationCode.trim() || null,
                        }),
                  form.id ? "Ангилал шинэчлэгдлээ" : "Ангилал нэмэгдлээ",
                  () => setOpen(false)
                )
              }
            >
              Хадгалах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={levelsOpen} onOpenChange={setLevelsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ангиллын түвшин</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <p className="text-xs text-[var(--ea-text-3)]">
              Дээрээс доош. Хамгийн багадаа 1 түвшин; модонд ашиглагдаж буй
              ({usedDepth}) түвшнээс доош хасахгүй.
            </p>
            {levelDraft.map((name, index) => (
              <FormField key={index} label={`${index + 1}-р түвшин`}>
                <div className="flex items-center gap-2">
                  <Input
                    value={name}
                    placeholder="Ж: Дэд ангилал"
                    onChange={(e) =>
                      setLevelDraft((current) =>
                        current.map((entry, i) => (i === index ? e.target.value : entry))
                      )
                    }
                  />
                  {index === levelDraft.length - 1 && levelDraft.length > Math.max(1, usedDepth) && (
                    <button
                      type="button"
                      className="ea-btn ea-btn--icon ea-btn--danger"
                      title="Сүүлийн түвшинг хасах"
                      aria-label="Сүүлийн түвшинг хасах"
                      onClick={() => setLevelDraft((current) => current.slice(0, -1))}
                    >
                      <Icon name="delete" />
                    </button>
                  )}
                </div>
              </FormField>
            ))}
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={levelDraft.length >= MAX_CATEGORY_LEVELS}
                onClick={() => setLevelDraft((current) => [...current, ""])}
              >
                <Icon name="add" />
                Түвшин нэмэх
              </Button>
            </div>
            {error && (
              <p className="rounded-md bg-[var(--ea-danger-bg)] px-3 py-2 text-xs text-[var(--ea-danger)]">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLevelsOpen(false)} disabled={isPending}>
              Болих
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => saveInventoryCategoryLevels(levelDraft),
                  "Түвшин хадгалагдлаа",
                  () => setLevelsOpen(false)
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
