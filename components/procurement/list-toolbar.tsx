"use client";

// Хангамжийн ЖАГСААЛТЫН хуудсуудын НИЙТЛЭГ шүүлтүүр + toolbar — НЭГ
// хэрэгжилт, хоёр хэрэглэгч (`purchase-orders-view.tsx`,
// `goods-receipts-view.tsx`). Статусын chip, хоёрдогч сонгогч (нийлүүлэгч /
// захиалга), URL параметрийн бичилт, статусын тоолуур, үйлдлийн
// `startTransition` бүгд ЭНД — хуудас бүрд хуулж бичихийг ХОРИГЛОНО.
//
// UI нь бэлэн ui-kit-ээр л: `FilterChips`, `SearchableSelect`,
// `SavedViewsMenu` (шинэ component/markup нэмээгүй — зөвхөн логик хуваалцав).
//
// Дүрэм: URL-ийн ил параметр (`?status=`, `?supplier=`, `?po=`) нь шүүлтүүрийн
// ЦОРЫН ГАНЦ эх сурвалж — deep link хэвээр ажиллана (CLAUDE.md §4).

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import type { DataGridHandle } from "@/components/datagrid/DataGrid";
import { SavedViewsMenu } from "@/components/datagrid/SavedViewsMenu";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { FilterChips } from "@/components/ui/tabs";
import { refreshOpenPanels } from "@/lib/store/panel-store";

/** "Бүх төлөв" + модулийн статусууд. */
export type ListStatusChip<TStatus extends string> = {
  value: "all" | TStatus;
  label: string;
};

export type ListSecondaryOption = { value: string; label: string };

interface FilterInput<TRow, TStatus extends string> {
  rows: TRow[];
  /** Модуль бүрийн chip-үүд ("all" эхэнд) — МОДУЛЬ ТҮВШИНД тогтмол байх ёстой. */
  statusChips: readonly ListStatusChip<TStatus>[];
  statusOf: (row: TRow) => TStatus;
  /** URL-ийн `?status=`. */
  initialStatus?: string;
  /** Хоёрдогч шүүлтүүрийн URL параметрийн нэр (ж: "supplier" | "po"). */
  secondaryParam: string;
  initialSecondary?: string;
  /**
   * Мөрөөс хоёрдогч сонголт (null = сонголт үүсгэхгүй). Сонголтууд нь
   * ЖАГСААЛТААС гарна — тусдаа query хэрэггүй, үргэлж бодит өгөгдөлтэй таарна.
   * Тогтвортой (модулийн түвшний) функц дамжуулна.
   */
  secondaryOf: (row: TRow) => ListSecondaryOption | null;
  /** Хоосон утгын шошго (ж: "Бүх нийлүүлэгч"). */
  secondaryAllLabel: string;
}

/**
 * Статус + хоёрдогч шүүлтүүрийн төлөв, тоолуур, харагдах мөрүүд.
 * Хоёрдогч шүүлтүүр ЭХЭЛЖ хэрэглэгдэнэ — статусын тоолуур нь тухайн
 * нийлүүлэгч/захиалгын мөрүүдээс бодогдоно.
 */
export function useListFilters<TRow, TStatus extends string>({
  rows,
  statusChips,
  statusOf,
  initialStatus,
  secondaryParam,
  initialSecondary,
  secondaryOf,
  secondaryAllLabel,
}: FilterInput<TRow, TStatus>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeStatus: "all" | TStatus = statusChips.some(
    (chip) => chip.value === initialStatus
  )
    ? (initialStatus as "all" | TStatus)
    : "all";

  const secondaryOptions = useMemo<ListSecondaryOption[]>(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      const option = secondaryOf(row);
      if (option?.value) byId.set(option.value, option.label);
    }
    return [
      { value: "", label: secondaryAllLabel },
      ...[...byId.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [rows, secondaryOf, secondaryAllLabel]);

  const activeSecondary =
    initialSecondary &&
    secondaryOptions.some((option) => option.value === initialSecondary)
      ? initialSecondary
      : "";

  const secondaryFiltered = useMemo(
    () =>
      activeSecondary
        ? rows.filter((row) => secondaryOf(row)?.value === activeSecondary)
        : rows,
    [rows, activeSecondary, secondaryOf]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: secondaryFiltered.length };
    for (const chip of statusChips)
      if (chip.value !== "all") counts[chip.value] = 0;
    for (const row of secondaryFiltered) counts[statusOf(row)] += 1;
    return counts;
  }, [secondaryFiltered, statusChips, statusOf]);

  const visibleRows = useMemo(
    () =>
      activeStatus === "all"
        ? secondaryFiltered
        : secondaryFiltered.filter((row) => statusOf(row) === activeStatus),
    [secondaryFiltered, activeStatus, statusOf]
  );

  const changeParam = useCallback(
    (key: string, next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!next || next === "all") params.delete(key);
      else params.set(key, next);
      // Хадгалсан харагдац (?view=) нь grid-ийн ӨӨРИЙН шүүлтийг сэргээдэг
      // тул chip/нийлүүлэгч солиход хүчингүй болно — эс бөгөөс шинэ
      // шүүлтүүрийн мөрүүдийг хуучин харагдац дахин нууж, хүснэгт
      // тайлбаргүй хоосорно.
      if (key !== "view") params.delete("view");
      router.replace(
        `${pathname}${params.toString() ? `?${params.toString()}` : ""}`
      );
    },
    [pathname, router, searchParams]
  );

  const changeStatus = useCallback(
    (next: string) => changeParam("status", next),
    [changeParam]
  );

  const changeSecondary = useCallback(
    (next: string) => changeParam(secondaryParam, next),
    [changeParam, secondaryParam]
  );

  return {
    activeStatus,
    statusCounts,
    secondaryOptions,
    activeSecondary,
    visibleRows,
    changeStatus,
    changeSecondary,
  };
}

/**
 * Жагсаалтын мөрийн үйлдэл (батлах, буцаах, устгах …) — server action-ыг
 * transition дотор дуудаж, нээлттэй панелиуд ба хуудсыг сэргээнэ.
 * Server action нь ActionResult буцаадаг тул `error` талбараар шалгана.
 */
export function useListAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const runAction = useCallback(
    (action: () => Promise<{ error?: string }>, successMessage: string) => {
      startTransition(async () => {
        try {
          const result = await action();
          if (result.error) {
            toast.error(result.error);
            return;
          }
          refreshOpenPanels();
          router.refresh();
          toast.success(successMessage);
        } catch {
          toast.error("Үйлдэл амжилтгүй");
        }
      });
    },
    [router]
  );

  return { isPending, runAction };
}

interface ToolbarProps<TStatus extends string> {
  statusChips: readonly ListStatusChip<TStatus>[];
  statusCounts: Record<string, number>;
  activeStatus: "all" | TStatus;
  onStatusChange: (next: string) => void;
  secondaryOptions: ListSecondaryOption[];
  activeSecondary: string;
  onSecondaryChange: (next: string) => void;
  secondaryPlaceholder: string;
  /** Сонгогчийн өргөн (ж: "w-56" / "w-64"). */
  secondaryWidthClass?: string;
  /** Хадгалсан харагдацын түлхүүр (surface бүрд давтагдашгүй). */
  surfaceId: string;
  gridRef: React.RefObject<DataGridHandle | null>;
}

/** Статусын chip + хоёрдогч сонгогч + хадгалсан харагдацын цэс. */
export function ListToolbar<TStatus extends string>({
  statusChips,
  statusCounts,
  activeStatus,
  onStatusChange,
  secondaryOptions,
  activeSecondary,
  onSecondaryChange,
  secondaryPlaceholder,
  secondaryWidthClass = "w-56",
  surfaceId,
  gridRef,
}: ToolbarProps<TStatus>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChips
        options={statusChips.map((chip) => ({
          value: chip.value,
          label: chip.label,
          count: chip.value !== "all" ? statusCounts[chip.value] : undefined,
          // Ноорог үлдсэн бол анхааруулгын өнгөөр — сарын хаалтыг хоригловол
          // хэрэглэгч эндээс шууд олж харна.
          tone:
            chip.value === "draft" && (statusCounts.draft ?? 0) > 0
              ? ("warning" as const)
              : undefined,
        }))}
        value={activeStatus}
        onChange={onStatusChange}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <div className={secondaryWidthClass}>
          <SearchableSelect
            value={activeSecondary}
            onChange={onSecondaryChange}
            options={secondaryOptions}
            placeholder={secondaryPlaceholder}
            hideValue
          />
        </div>
        <SavedViewsMenu surfaceId={surfaceId} gridRef={gridRef} />
      </div>
    </div>
  );
}
