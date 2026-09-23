// Single source of truth for column type defaults. Surfaces compose by
// spreading these into their own ColDef — they MUST NOT redefine type-level
// settings (alignment, parser, formatter) elsewhere.

import type { ColDef } from "ag-grid-community";
import type { ColumnTypeId } from "./types";
import { moneyValueFormatter, parseMntInput } from "./formatters";
import { StatusCellRenderer } from "./editors/StatusCellRenderer";
import { statusMeta } from "@/lib/status";

export const columnTypeDefaults: Record<ColumnTypeId, Partial<ColDef>> = {
  text: {
    cellDataType: "text",
    editable: true,
  },

  "readonly-text": {
    cellDataType: "text",
    editable: false,
  },

  "number-money": {
    cellDataType: "number",
    editable: true,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueParser: (p) => {
      const n = parseMntInput(p.newValue);
      return Number.isFinite(n) ? n : 0;
    },
    valueFormatter: moneyValueFormatter,
  },

  "readonly-money": {
    cellDataType: "number",
    editable: false,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueFormatter: moneyValueFormatter,
  },

  // Цаг / тоо хэмжээ — мөнгө БИШ тул бутархайг албадан 2 орон болгохгүй
  // (168 нь "168", 7.5 нь "7.5"). Оролтыг мөнгөтэй ИЖИЛ тэвчээртэй уншина.
  "number-hours": {
    cellDataType: "number",
    editable: true,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueParser: (p) => {
      const n = parseMntInput(p.newValue);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    },
    valueFormatter: (p) => {
      const n = Number(p.value ?? 0);
      if (!Number.isFinite(n) || n === 0) return "";
      return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    },
  },

  debit: {
    cellDataType: "number",
    editable: true,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueParser: (p) => {
      const n = parseMntInput(p.newValue);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
    valueFormatter: moneyValueFormatter,
  },

  credit: {
    cellDataType: "number",
    editable: true,
    cellClass: "ag-right-aligned-cell font-mono",
    headerClass: "ag-right-aligned-header",
    valueParser: (p) => {
      const n = parseMntInput(p.newValue);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
    valueFormatter: moneyValueFormatter,
  },

  "account-segment": {
    cellDataType: "text",
    editable: true,
    cellClass: "font-mono",
  },

  date: {
    cellDataType: "dateString",
    editable: true,
    cellClass: "font-mono",
  },

  switch: {
    cellDataType: "boolean",
    editable: false,
  },

  select: {
    cellDataType: "text",
    editable: true,
    cellEditor: "agSelectCellEditor",
  },

  // Баримтын төлөв — ЭХНИЙ багана, зүүн талд бэхэлсэн, зөвхөн дүрс (UI гайдын
  // карт 1, ENT-016). Утга = түүхий төлөв ("posted"); шүүлт/хуулалт/экспортод
  // монгол шошго (lib/status.ts).
  status: {
    headerName: "",
    headerTooltip: "Төлөв",
    width: 52,
    minWidth: 52,
    pinned: "left",
    editable: false,
    sortable: true,
    resizable: false,
    cellRenderer: StatusCellRenderer,
    valueFormatter: (p) => statusMeta(p.value).label,
    filterValueGetter: (p) => statusMeta(p.data?.status).label,
  },
};

export function col<T = unknown>(
  def: ColDef<T> & { eaType?: ColumnTypeId }
): ColDef<T> {
  const { eaType, ...rest } = def;
  if (!eaType) return rest as ColDef<T>;
  return { ...columnTypeDefaults[eaType], ...rest } as ColDef<T>;
}
