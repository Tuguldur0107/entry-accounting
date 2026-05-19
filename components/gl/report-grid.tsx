"use client";

import { useMemo } from "react";
import type { ColDef, ICellRendererParams, RowClassParams } from "ag-grid-community";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import { moneyValueFormatter } from "@/lib/grid/formatters";
import type { SegmentDef } from "@/lib/constants/standard-accounts";
import { ChevronDown, ChevronRight, Eye, EyeOff, SlidersHorizontal, Trash2 } from "lucide-react";

export type ReportRowKind =
  | "section"
  | "group"
  | "detail"
  | "empty"
  | "subtotal"
  | "total"
  | "footnote";

export interface ReportRow {
  id: string;
  kind: ReportRowKind;
  label?: string;
  segs?: Record<number, string>;
  name?: string;
  amount?: number;
  amountSign?: "pos" | "neg" | "auto";
  /**
   * If set, this detail row is mappable to a set of GL accounts. The
   * Mapping column renders an icon button for these rows; clicking it
   * fires `onMappingClick(lineKey)` so the parent can open its
   * MappingDialog.
   */
  lineKey?: string;
  /** Set by the parent so collapse filter can hide rows under a folded
   *  section / group without losing the row's identity. */
  parentSectionId?: string;
  parentGroupId?: string;
  /** Visibility / origin flags consumed by the Actions column. */
  isHidden?: boolean;
  isCustom?: boolean;
}

interface Props {
  activeSegments: SegmentDef[];
  rows: ReportRow[];
  height?: number | string;
  /**
   * Skip the "Данс" (account code) column. Useful for the Balance Sheet
   * where account numbers are noise — the line label and amount are
   * enough. Section / group / subtotal / total labels move to the name
   * column when the account column is hidden.
   */
  hideAccount?: boolean;
  /**
   * Prepend a "№" column that auto-numbers detail rows (1, 2, 3, …).
   * Section / group / subtotal / total / empty / footnote rows leave
   * the cell blank. Matches the statutory Mongolian SAS report layout.
   */
  showLineNumbers?: boolean;
  /**
   * Append a "Mapping" column with an icon button on each detail row
   * that carries a `lineKey`. The click fires this callback so the
   * parent can open its configuration dialog.
   */
  onMappingClick?: (lineKey: string) => void;
  /**
   * IDs of section / group rows that should hide their children. When
   * provided alongside `onToggleCollapse`, section and group cells
   * render a chevron toggle.
   */
  collapsedKeys?: Set<string>;
  onToggleCollapse?: (rowId: string) => void;
  /**
   * When any of these callbacks are provided an "Үйлдэл" column is
   * appended with contextual icons (hide / unhide / remove). Only
   * detail rows with a `lineKey` receive the icons.
   */
  onHideLine?: (lineKey: string) => void;
  onUnhideLine?: (lineKey: string) => void;
  onRemoveLine?: (lineKey: string) => void;
}

const SECTION_LIKE: ReadonlySet<ReportRowKind> = new Set([
  "section",
  "group",
  "empty",
  "footnote",
]);

export function ReportGrid({
  activeSegments,
  rows,
  height,
  hideAccount = false,
  showLineNumbers = false,
  onMappingClick,
  collapsedKeys,
  onToggleCollapse,
  onHideLine,
  onUnhideLine,
  onRemoveLine,
}: Props) {
  // Drop rows whose parent section or group is collapsed. Section / group
  // rows themselves stay visible so the user always has a way to expand.
  const visibleRows = useMemo(() => {
    if (!collapsedKeys || collapsedKeys.size === 0) return rows;
    return rows.filter((r) => {
      if (r.parentSectionId && collapsedKeys.has(r.parentSectionId)) return false;
      if (r.parentGroupId && collapsedKeys.has(r.parentGroupId)) return false;
      return true;
    });
  }, [rows, collapsedKeys]);
  const hasActionColumn = !!(onHideLine || onUnhideLine || onRemoveLine);
  // Pre-compute hierarchical line numbers once so the column's valueGetter
  // stays pure. Numbering tracks three nested counters and rebuilds the
  // dotted string per row:
  //
  //   section  →  "1", "2", "3"
  //   group    →  "1.1", "1.2", "2.1"
  //   detail   →  "1.1.1", "1.1.2", "1.2.1"
  //
  // Subtotal / total / empty / footnote rows leave the cell blank — their
  // dedicated styling and label are enough to communicate role.
  const lineNumberMap = useMemo(() => {
    const map = new Map<string, string>();
    let section = 0;
    let group = 0;
    let detail = 0;
    for (const r of rows) {
      if (r.kind === "section") {
        section += 1;
        group = 0;
        detail = 0;
        map.set(r.id, `${section}`);
      } else if (r.kind === "group") {
        group += 1;
        detail = 0;
        map.set(r.id, `${section || 1}.${group}`);
      } else if (r.kind === "detail") {
        detail += 1;
        // Auto-promote into a synthetic group when a section emits details
        // directly (e.g. no group header between section and detail).
        const groupPart = group || 1;
        map.set(r.id, `${section || 1}.${groupPart}.${detail}`);
      }
    }
    return map;
  }, [rows]);
  // Standard: ONE "Данс" column showing the active segments joined with ".".
  // Column width is handled by AG Grid's `autoSizeStrategy: fitCellContents`
  // (wired below on EaGridDynamic) so the column hugs the longest visible
  // value across the active segments.
  const columnDefs = useMemo<ColDef<ReportRow>[]>(() => {
    const labelClass = (p: { data?: ReportRow }) => {
      const k = p.data?.kind;
      if (k === "section") return "report-section-cell";
      if (k === "group") return "report-group-cell";
      if (k === "subtotal") return "report-subtotal-cell";
      if (k === "total") return "report-total-cell";
      if (k === "footnote") return "report-footnote-cell";
      return "";
    };

    const accountCol: ColDef<ReportRow> = {
      headerName: "Данс",
      colId: "account",
      cellClass: (p) => {
        const cls = labelClass(p);
        return cls || "font-mono text-xs";
      },
      valueGetter: (p) => {
        const r = p.data;
        if (!r) return "";
        if (SECTION_LIKE.has(r.kind) || r.kind === "subtotal" || r.kind === "total") {
          return r.label ?? "";
        }
        return activeSegments
          .map((s) => r.segs?.[s.id] ?? "")
          .filter((part) => part !== "")
          .join(".");
      },
      // Section / group / subtotal / total / empty / footnote rows put their
      // label in the account column and span across the name column too.
      colSpan: (p) => {
        const k = p.data?.kind;
        if (SECTION_LIKE.has(k as ReportRowKind) || k === "subtotal" || k === "total") {
          return 2;
        }
        return 1;
      },
      sortable: false,
      suppressMovable: true,
    };

    // Indentation by depth so the hierarchy is visible at a glance:
    //   section            →   0px
    //   group              →  16px
    //   subtotal / total   →  20px (sit just inside their group)
    //   detail / footnote  →  32px
    // Applied via cellStyle on the name column.
    const indentByKind: Record<ReportRowKind, number> = {
      section: 0,
      group: 16,
      detail: 32,
      empty: 32,
      footnote: 32,
      subtotal: 20,
      total: 0,
    };

    // When the account column is hidden the name column becomes the leftmost
    // column and inherits responsibility for rendering section / group /
    // subtotal / total / empty / footnote labels (since the account column
    // was previously doing that via colSpan).
    const nameCol: ColDef<ReportRow> = {
      headerName: "Үндсэн дансны нэр",
      colId: "name",
      flex: 1,
      minWidth: 220,
      valueGetter: (p) => {
        const r = p.data;
        if (!r) return "";
        if (hideAccount && (SECTION_LIKE.has(r.kind) || r.kind === "subtotal" || r.kind === "total")) {
          return r.label ?? "";
        }
        return r.name ?? "";
      },
      cellRenderer: (p: ICellRendererParams<ReportRow>) => {
        const r = p.data;
        if (!r) return null;
        const isCollapsible =
          (r.kind === "section" || r.kind === "group") && !!onToggleCollapse;
        const collapsed = collapsedKeys?.has(r.id) ?? false;
        const label =
          SECTION_LIKE.has(r.kind) || r.kind === "subtotal" || r.kind === "total"
            ? hideAccount
              ? r.label ?? ""
              : ""
            : r.name || "—";
        if (isCollapsible) {
          return (
            <button
              type="button"
              onClick={() => onToggleCollapse?.(r.id)}
              className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
              aria-label={collapsed ? "Дэлгэх" : "Хумих"}
            >
              {collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              <span>{label}</span>
            </button>
          );
        }
        return <span>{label}</span>;
      },
      cellClass: (p) => {
        const r = p.data;
        if (hideAccount) {
          const cls = labelClass(p);
          if (cls) return cls;
        }
        const parts: string[] = [];
        if (r?.kind === "detail") parts.push("text-[var(--ea-text-1)]");
        if (r?.isHidden) parts.push("opacity-50 line-through");
        return parts.join(" ");
      },
      cellStyle: (p) => {
        const k = p.data?.kind;
        if (!k) return null;
        return { paddingLeft: 12 + indentByKind[k] };
      },
      sortable: false,
      suppressMovable: true,
    };

    const amountCol: ColDef<ReportRow> = {
      headerName: "Дүн",
      colId: "amount",
      width: 160,
      valueGetter: (p) => p.data?.amount,
      valueFormatter: (p) => {
        const r = p.data as ReportRow | undefined;
        if (!r) return "";
        if (SECTION_LIKE.has(r.kind) && r.kind !== "footnote") return "";
        return moneyValueFormatter({ value: r.amount });
      },
      cellClass: (p) => {
        const r = p.data;
        if (!r) return "";
        const parts = ["ag-right-aligned-cell", "font-mono"];
        if (r.kind === "subtotal") parts.push("font-semibold");
        if (r.kind === "total") parts.push("font-bold");
        const amt = r.amount ?? 0;
        const sign = r.amountSign ?? "auto";
        if (sign === "neg" || (sign === "auto" && amt < 0)) parts.push("text-[var(--ea-danger)]");
        else if (sign === "pos" && amt > 0) parts.push("text-[var(--ea-success)]");
        return parts.join(" ");
      },
      headerClass: "ag-right-aligned-header",
      sortable: false,
      suppressMovable: true,
    };

    const lineNumberCol: ColDef<ReportRow> = {
      headerName: "№",
      colId: "lineNumber",
      width: 78,
      maxWidth: 96,
      cellClass: (p) => {
        const cls = labelClass(p);
        return cls
          ? `${cls} text-right`
          : "ag-right-aligned-cell text-xs text-[var(--ea-text-3)] font-mono";
      },
      headerClass: "ag-right-aligned-header",
      valueGetter: (p) => {
        const r = p.data;
        if (!r) return "";
        return lineNumberMap.get(r.id) ?? "";
      },
      sortable: false,
      suppressMovable: true,
    };

    const mappingCol: ColDef<ReportRow> = {
      headerName: "Mapping",
      colId: "mapping",
      width: 84,
      maxWidth: 100,
      sortable: false,
      suppressMovable: true,
      cellClass: "flex items-center justify-center",
      headerClass: "ag-center-aligned-header",
      cellRenderer: (p: ICellRendererParams<ReportRow>) => {
        const r = p.data;
        if (!r || r.kind !== "detail" || !r.lineKey) return null;
        const key = r.lineKey;
        return (
          <button
            type="button"
            onClick={() => onMappingClick?.(key)}
            className="ea-btn ea-btn--icon ea-btn--primary"
            title="Дансны mapping тохируулах"
            aria-label="Дансны mapping тохируулах"
          >
            <SlidersHorizontal />
          </button>
        );
      },
    };

    const actionsCol: ColDef<ReportRow> = {
      headerName: "Үйлдэл",
      colId: "row-actions",
      width: 110,
      maxWidth: 140,
      sortable: false,
      suppressMovable: true,
      cellClass: "flex items-center justify-center gap-1",
      headerClass: "ag-center-aligned-header",
      cellRenderer: (p: ICellRendererParams<ReportRow>) => {
        const r = p.data;
        if (!r || r.kind !== "detail" || !r.lineKey) return null;
        const key = r.lineKey;
        const isHidden = !!r.isHidden;
        const isCustom = !!r.isCustom;
        return (
          <div className="flex items-center justify-center gap-1 h-full">
            {isHidden
              ? onUnhideLine && (
                  <button
                    type="button"
                    onClick={() => onUnhideLine(key)}
                    className="ea-btn ea-btn--icon ea-btn--primary"
                    title="Дахин харуулах"
                    aria-label="Дахин харуулах"
                  >
                    <Eye />
                  </button>
                )
              : onHideLine && (
                  <button
                    type="button"
                    onClick={() => onHideLine(key)}
                    className="ea-btn ea-btn--icon"
                    title="Нуух"
                    aria-label="Нуух"
                  >
                    <EyeOff />
                  </button>
                )}
            {isCustom && onRemoveLine && (
              <button
                type="button"
                onClick={() => {
                  if (confirm("Энэ мөрийг устгах уу?")) onRemoveLine(key);
                }}
                className="ea-btn ea-btn--icon ea-btn--danger"
                title="Мөрийг устгах"
                aria-label="Мөрийг устгах"
              >
                <Trash2 />
              </button>
            )}
          </div>
        );
      },
    };

    const dataCols = hideAccount ? [nameCol, amountCol] : [accountCol, nameCol, amountCol];
    const cols: ColDef<ReportRow>[] = [];
    if (showLineNumbers) cols.push(lineNumberCol);
    cols.push(...dataCols);
    if (onMappingClick) cols.push(mappingCol);
    if (hasActionColumn) cols.push(actionsCol);
    return cols;
  }, [
    activeSegments,
    hideAccount,
    showLineNumbers,
    lineNumberMap,
    onMappingClick,
    onToggleCollapse,
    collapsedKeys,
    onHideLine,
    onUnhideLine,
    onRemoveLine,
    hasActionColumn,
  ]);

  const rowClassRules = useMemo(
    () => ({
      "report-row-section": (p: RowClassParams<ReportRow>) => p.data?.kind === "section",
      "report-row-group": (p: RowClassParams<ReportRow>) => p.data?.kind === "group",
      "report-row-subtotal": (p: RowClassParams<ReportRow>) => p.data?.kind === "subtotal",
      "report-row-total": (p: RowClassParams<ReportRow>) => p.data?.kind === "total",
      "report-row-footnote": (p: RowClassParams<ReportRow>) => p.data?.kind === "footnote",
      "report-row-empty": (p: RowClassParams<ReportRow>) => p.data?.kind === "empty",
    }),
    []
  );

  // Default to filling the parent flex container; callers may still pass a
  // fixed `height` prop for embedded use-cases (modals, side panels).
  return (
    <EaGridDynamic<ReportRow>
      rowData={visibleRows}
      columnDefs={columnDefs}
      getRowId={(p) => p.data.id}
      rowClassRules={rowClassRules}
      height={height ?? "100%"}
      autoSizeStrategy={{ type: "fitCellContents" }}
      wrapperClassName="ea-report-grid rounded-md border border-[var(--ea-border)] overflow-hidden h-full"
      suppressCellFocus
      cellSelection={false}
    />
  );
}
