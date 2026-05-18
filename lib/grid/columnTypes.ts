// Single source of truth for column type defaults. Surfaces compose by
// spreading these into their own ColDef — they MUST NOT redefine type-level
// settings (alignment, parser, formatter) elsewhere.

import type { ColDef } from "ag-grid-community";
import type { ColumnTypeId } from "./types";
import { moneyValueFormatter, parseMntInput } from "./formatters";

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
};

export function col<T = unknown>(
  def: ColDef<T> & { eaType?: ColumnTypeId }
): ColDef<T> {
  const { eaType, ...rest } = def;
  if (!eaType) return rest as ColDef<T>;
  return { ...columnTypeDefaults[eaType], ...rest } as ColDef<T>;
}
