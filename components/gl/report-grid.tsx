"use client";

import { useMemo } from "react";
import type { ColDef, RowClassParams } from "ag-grid-community";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import { moneyValueFormatter } from "@/lib/grid/formatters";
import type { SegmentDef } from "@/lib/constants/standard-accounts";

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
}

interface Props {
  activeSegments: SegmentDef[];
  rows: ReportRow[];
  height?: number | string;
}

const SECTION_LIKE: ReadonlySet<ReportRowKind> = new Set([
  "section",
  "group",
  "empty",
  "footnote",
]);

export function ReportGrid({ activeSegments, rows, height }: Props) {
  const columnDefs = useMemo<ColDef<ReportRow>[]>(() => {
    const segCols: ColDef<ReportRow>[] = activeSegments.map((s, idx) => ({
      headerName: s.nameMn,
      colId: `seg-${s.id}`,
      width: 120,
      cellClass: (p) => {
        const k = p.data?.kind;
        if (k === "section") return "report-section-cell";
        if (k === "group") return "report-group-cell";
        if (k === "subtotal") return "report-subtotal-cell";
        if (k === "total") return "report-total-cell";
        if (k === "footnote") return "report-footnote-cell";
        return "font-mono text-xs";
      },
      valueGetter: (p) => p.data?.segs?.[s.id] ?? "",
      colSpan: (p) => {
        const k = p.data?.kind;
        if (idx === 0 && (SECTION_LIKE.has(k as ReportRowKind) || k === "subtotal" || k === "total")) {
          return activeSegments.length + 1;
        }
        return 1;
      },
      cellRenderer: (p: { data?: ReportRow }) => {
        const r = p.data;
        if (!r) return null;
        if (idx === 0 && SECTION_LIKE.has(r.kind)) return r.label ?? "";
        if (idx === 0 && (r.kind === "subtotal" || r.kind === "total")) return r.label ?? "";
        return r.segs?.[s.id] ?? "";
      },
      sortable: false,
      suppressMovable: true,
    }));

    const nameCol: ColDef<ReportRow> = {
      headerName: "Үндсэн дансны нэр",
      colId: "name",
      flex: 1,
      minWidth: 220,
      valueGetter: (p) => p.data?.name ?? "",
      cellRenderer: (p: { data?: ReportRow }) => {
        const r = p.data;
        if (!r) return null;
        if (SECTION_LIKE.has(r.kind) || r.kind === "subtotal" || r.kind === "total") return "";
        return r.name || "—";
      },
      cellClass: (p) => {
        const k = p.data?.kind;
        if (k === "detail") return "text-[var(--ea-text-1)]";
        return "";
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

    return [...segCols, nameCol, amountCol];
  }, [activeSegments]);

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

  const computedHeight = useMemo(() => {
    if (height != null) return height;
    return Math.min(720, 60 + rows.length * 36);
  }, [height, rows.length]);

  return (
    <EaGridDynamic<ReportRow>
      rowData={rows}
      columnDefs={columnDefs}
      getRowId={(p) => p.data.id}
      rowClassRules={rowClassRules}
      height={computedHeight}
      wrapperClassName="ea-report-grid rounded-md border border-[var(--ea-border)] overflow-hidden"
      suppressCellFocus
      cellSelection={false}
    />
  );
}
