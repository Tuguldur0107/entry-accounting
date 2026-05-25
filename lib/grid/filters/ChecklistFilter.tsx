"use client";

// Excel-style "Select values" filter that's free in AG Grid Community.
// `agSetColumnFilter` is enterprise; this re-implements the same UX:
//
//   ┌──────────────────────────────┐
//   │ [search...........]          │
//   │ ☑ (Select all)               │
//   │ ─────────────────────────    │
//   │ ☑ Касс                       │
//   │ ☑ Харилцах данс              │
//   │ ☐ ...                        │
//   └──────────────────────────────┘
//
// Filter is applied incrementally on every checkbox change — no Apply button.

import { useCallback, useMemo, useRef, useState } from "react";
import { useGridFilter, type CustomFilterProps } from "ag-grid-react";
import type {
  IDoesFilterPassParams,
  IRowNode,
  ValueFormatterParams,
} from "ag-grid-community";

const BLANK_KEY = "(хоосон)";

interface InternalModel {
  values: string[];
}

function rawValue(api: CustomFilterProps["api"], node: IRowNode, colId: string): unknown {
  return api.getCellValue({ rowNode: node, colKey: colId });
}

function displayValue(
  api: CustomFilterProps["api"],
  node: IRowNode,
  colId: string,
  formatter?: (p: ValueFormatterParams) => string
): string {
  const v = rawValue(api, node, colId);
  if (v == null || v === "") return BLANK_KEY;
  // Honour the column's `valueFormatter` so the checkbox list looks the
  // same as the cell (e.g. "1,234.00", "Бичигдсэн").
  if (formatter) {
    try {
      const formatted = formatter({
        value: v,
        node,
        data: node.data,
        colDef: {} as never,
        column: {} as never,
        api,
        context: undefined,
      });
      if (formatted != null && formatted !== "") return formatted;
    } catch {
      /* fall through to raw */
    }
  }
  return String(v);
}

export function ChecklistFilter(props: CustomFilterProps<unknown, InternalModel>) {
  const { api, column, colDef, model, onModelChange } = props;
  const colId = column.getColId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const valueFormatter =
    typeof colDef.valueFormatter === "function"
      ? (colDef.valueFormatter as (p: ValueFormatterParams) => string)
      : undefined;

  // All unique displayed values from current rowData. Recomputed on every
  // render so newly-loaded rows show up immediately.
  const allValues = useMemo(() => {
    const set = new Set<string>();
    api.forEachNode((node: IRowNode) => {
      set.add(displayValue(api, node, colId, valueFormatter));
    });
    return [...set].sort((a, b) => a.localeCompare(b, "mn"));
    // colId is stable; api.forEachNode walks current data which is enough.
    // We intentionally re-run when `model` changes so the "Бүгдийг сонгох"
    // visual stays in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, colId, model]);

  // Selected = which values pass through (Excel-style "checked = visible").
  // model.values === undefined ⇒ all selected (filter inactive).
  const selected = useMemo<Set<string>>(() => {
    if (!model || !Array.isArray(model.values)) return new Set<string>(allValues);
    return new Set<string>(model.values);
  }, [model, allValues]);

  const isActive = useCallback(() => {
    return !!model && Array.isArray(model.values);
  }, [model]);

  const doesFilterPass = useCallback(
    (params: IDoesFilterPassParams) => {
      if (!model || !Array.isArray(model.values)) return true;
      const key = displayValue(api, params.node, colId, valueFormatter);
      return model.values.includes(key);
    },
    [model, api, colId, valueFormatter]
  );

  useGridFilter({
    doesFilterPass,
    afterGuiAttached: () => {
      setQuery("");
      // Focus the search box when the popup opens.
      setTimeout(() => searchRef.current?.focus(), 0);
    },
  });

  const filtered = useMemo(() => {
    if (!query.trim()) return allValues;
    const q = query.toLowerCase();
    return allValues.filter((v) => v.toLowerCase().includes(q));
  }, [allValues, query]);

  function commit(nextSet: Set<string>) {
    // If every known value is selected, treat as "no filter".
    if (nextSet.size === allValues.length) {
      onModelChange(null);
      return;
    }
    onModelChange({ values: [...nextSet] });
  }

  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    commit(next);
  }

  const visibleAllChecked = filtered.length > 0 && filtered.every((v) => selected.has(v));
  function toggleVisible() {
    const next = new Set(selected);
    if (visibleAllChecked) filtered.forEach((v) => next.delete(v));
    else filtered.forEach((v) => next.add(v));
    commit(next);
  }

  function selectAll() {
    onModelChange(null);
  }
  function selectNone() {
    onModelChange({ values: [] });
  }

  return (
    <div
      className="ea-checklist-filter"
      style={{
        width: 240,
        padding: 8,
        background: "var(--ea-surface)",
        color: "var(--ea-text-1)",
      }}
    >
      <input
        ref={searchRef}
        type="text"
        placeholder="Хайх..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-8 px-2 text-xs border border-[var(--ea-border)] rounded-md bg-[var(--ea-bg)] text-[var(--ea-text-1)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--ea-primary)_22%,transparent)] focus:border-[var(--ea-primary)]"
      />
      <div className="flex items-center gap-2 text-[11px] mt-2">
        <button
          type="button"
          onClick={selectAll}
          className="text-[var(--ea-primary)] hover:underline"
        >
          Бүгдийг сонгох
        </button>
        <span className="text-[var(--ea-text-4)]">·</span>
        <button
          type="button"
          onClick={selectNone}
          className="text-[var(--ea-text-3)] hover:underline"
        >
          Цэвэрлэх
        </button>
        <span className="ml-auto text-[var(--ea-text-4)]">
          {isActive() ? `${selected.size}/${allValues.length}` : `${allValues.length}`}
        </span>
      </div>
      <div
        className="mt-2 border border-[var(--ea-border)] rounded-md overflow-y-auto"
        style={{ maxHeight: 240, background: "var(--ea-surface)" }}
      >
        {filtered.length > 0 && (
          <label
            className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-[var(--ea-bg-2)] border-b border-[var(--ea-border)] font-medium"
            style={{ position: "sticky", top: 0, background: "var(--ea-bg-2)" }}
          >
            <input
              type="checkbox"
              checked={visibleAllChecked}
              onChange={toggleVisible}
              className="w-3.5 h-3.5 accent-[var(--ea-primary)]"
            />
            <span>(Бүгдийг)</span>
          </label>
        )}
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-center text-[var(--ea-text-4)]">
            Илэрц байхгүй
          </div>
        ) : (
          filtered.map((v) => (
            <label
              key={v}
              className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-[var(--ea-bg-2)] border-b border-[var(--ea-border)] last:border-b-0"
            >
              <input
                type="checkbox"
                checked={selected.has(v)}
                onChange={() => toggle(v)}
                className="w-3.5 h-3.5 accent-[var(--ea-primary)] shrink-0"
              />
              <span className="truncate" title={v}>
                {v}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
