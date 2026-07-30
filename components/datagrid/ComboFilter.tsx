"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useGridFilter, type CustomFilterProps } from "ag-grid-react";
import type {
  IDoesFilterPassParams,
  IRowNode,
  ValueFormatterParams,
} from "ag-grid-community";

const BLANK_KEY = "(хоосон)";

type Operator =
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "wildcard"
  | "equals"
  | "notEqual"
  | "greaterThan"
  | "lessThan"
  | "between";

interface ComboFilterModel {
  operator: Operator;
  value: string;
  valueTo: string;
  values: string[] | null;
}

const OPERATORS: Array<{ value: Operator; label: string }> = [
  { value: "contains", label: "Агуулсан" },
  { value: "notContains", label: "Агуулаагүй" },
  { value: "startsWith", label: "Эхэлсэн" },
  { value: "endsWith", label: "Төгссөн" },
  { value: "wildcard", label: "Хэв маяг (* ?)" },
  { value: "equals", label: "Тэнцүү (=)" },
  { value: "notEqual", label: "Тэнцүү биш (≠)" },
  { value: "greaterThan", label: "Их (>)" },
  { value: "lessThan", label: "Бага (<)" },
  { value: "between", label: "Хооронд" },
];

function rawValue(
  api: CustomFilterProps["api"],
  node: IRowNode,
  colId: string
): unknown {
  return api.getCellValue({ rowNode: node, colKey: colId });
}

function displayValue(
  api: CustomFilterProps["api"],
  node: IRowNode,
  colId: string,
  formatter?: (params: ValueFormatterParams) => string
): string {
  const value = rawValue(api, node, colId);
  if (value == null || value === "") return BLANK_KEY;

  if (formatter) {
    try {
      const formatted = formatter({
        value,
        node,
        data: node.data,
        colDef: {} as never,
        column: {} as never,
        api,
        context: undefined,
      });
      if (formatted != null && formatted !== "") return String(formatted);
    } catch {
      // A formatter may depend on params unavailable inside a filter popup.
    }
  }

  return String(value);
}

function asNumber(value: unknown): number | null {
  const normalized = String(value).replace(/[\s,]/g, "");
  if (normalized === "") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function wildcardRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
    "i"
  );
}

function passesOperator(
  cell: unknown,
  operator: Operator,
  value: string,
  valueTo: string
): boolean {
  if (!value) return true;

  const cellNumber = asNumber(cell);
  const valueNumber = asNumber(value);
  const numeric = cellNumber !== null && valueNumber !== null;
  const cellText = String(cell ?? "").toLocaleLowerCase("mn");
  const query = value.toLocaleLowerCase("mn");

  switch (operator) {
    case "contains":
      return cellText.includes(query);
    case "notContains":
      return !cellText.includes(query);
    case "startsWith":
      return cellText.startsWith(query);
    case "endsWith":
      return cellText.endsWith(query);
    case "wildcard":
      return wildcardRegex(value).test(String(cell ?? ""));
    case "equals":
      return numeric ? cellNumber === valueNumber : cellText === query;
    case "notEqual":
      return numeric ? cellNumber !== valueNumber : cellText !== query;
    case "greaterThan":
      return numeric
        ? (cellNumber as number) > (valueNumber as number)
        : cellText > query;
    case "lessThan":
      return numeric
        ? (cellNumber as number) < (valueNumber as number)
        : cellText < query;
    case "between": {
      if (!valueTo) return true;
      const valueToNumber = asNumber(valueTo);
      if (numeric && valueToNumber !== null) {
        const min = Math.min(valueNumber as number, valueToNumber);
        const max = Math.max(valueNumber as number, valueToNumber);
        return (cellNumber as number) >= min && (cellNumber as number) <= max;
      }
      const upper = valueTo.toLocaleLowerCase("mn");
      const min = query < upper ? query : upper;
      const max = query < upper ? upper : query;
      return cellText >= min && cellText <= max;
    }
  }
}

export function ComboFilter(
  props: CustomFilterProps<unknown, ComboFilterModel>
) {
  const { api, column, colDef, model, onModelChange } = props;
  const colId = column.getColId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [draftOperator, setDraftOperator] =
    useState<Operator>("contains");

  const operator = model?.operator ?? draftOperator;
  const value = model?.value ?? "";
  const valueTo = model?.valueTo ?? "";

  const valueFormatter =
    typeof colDef.valueFormatter === "function"
      ? (colDef.valueFormatter as (params: ValueFormatterParams) => string)
      : undefined;

  const allValues = useMemo(() => {
    const values = new Set<string>();
    api.forEachNode((node: IRowNode) => {
      values.add(displayValue(api, node, colId, valueFormatter));
    });
    return [...values].sort((a, b) =>
      a.localeCompare(b, "mn", { numeric: true })
    );
    // Re-read values when the filter model changes or row data is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, colId, model, valueFormatter]);

  const selected = useMemo(() => {
    if (!model?.values) return new Set<string>(allValues);
    return new Set<string>(model.values);
  }, [allValues, model]);

  const doesFilterPass = useCallback(
    (params: IDoesFilterPassParams) => {
      const displayed = displayValue(api, params.node, colId, valueFormatter);
      const selectedPass = !model?.values || model.values.includes(displayed);
      return (
        selectedPass &&
        passesOperator(
          rawValue(api, params.node, colId),
          operator,
          value,
          valueTo
        )
      );
    },
    [api, colId, model, operator, value, valueFormatter, valueTo]
  );

  useGridFilter({
    doesFilterPass,
    afterGuiAttached: () => {
      setSearch("");
      setTimeout(() => searchRef.current?.focus(), 0);
    },
  });

  const visibleValues = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("mn");
    if (!query) return allValues;
    return allValues.filter((item) =>
      item.toLocaleLowerCase("mn").includes(query)
    );
  }, [allValues, search]);

  function update(patch: Partial<ComboFilterModel>) {
    const next: ComboFilterModel = {
      operator,
      value,
      valueTo,
      values: model?.values ?? null,
      ...patch,
    };
    const hasOperator = next.value !== "";
    const hasSelection = next.values !== null;
    onModelChange(hasOperator || hasSelection ? next : null);
  }

  function commitSelection(next: Set<string>) {
    update({ values: next.size === allValues.length ? null : [...next] });
  }

  function toggleValue(item: string) {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    commitSelection(next);
  }

  const visibleAllSelected =
    visibleValues.length > 0 &&
    visibleValues.every((item) => selected.has(item));

  return (
    <div className="ea-combo-filter">
      <div className="ea-combo-filter__label">
        <span>Оператор</span>
        <button
          type="button"
          className="ea-combo-filter__info"
          aria-label="Шүүлтийн тайлбар"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        >
          <Icon name="info" size="sm" />
        </button>
      </div>
      <select
        value={operator}
        onChange={(event) => {
          const nextOperator = event.target.value as Operator;
          setDraftOperator(nextOperator);
          update({ operator: nextOperator });
        }}
      >
        {OPERATORS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <div className={operator === "between" ? "ea-combo-filter__range" : ""}>
        <input
          type="text"
          value={value}
          placeholder="Утга"
          onChange={(event) => update({ value: event.target.value })}
        />
        {operator === "between" && (
          <input
            type="text"
            value={valueTo}
            placeholder="Хүртэл"
            onChange={(event) => update({ valueTo: event.target.value })}
          />
        )}
      </div>
      {showHelp && (
        <div className="ea-combo-filter__hint">
          <strong>*</strong> нь олон, <strong>?</strong> нь нэг тэмдэгт орлоно.
          Тоо болон ISO огноонд харьцуулах оператор ашиглаж болно.
        </div>
      )}

      <div className="ea-combo-filter__divider" />
      <div className="ea-combo-filter__label">
        <span>Утгууд</span>
        <span>
          {model?.values ? `${selected.size}/${allValues.length}` : allValues.length}
        </span>
      </div>
      <input
        ref={searchRef}
        type="search"
        value={search}
        placeholder="Хайх..."
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="ea-combo-filter__list">
        {visibleValues.length > 0 && (
          <label className="ea-combo-filter__all">
            <input
              type="checkbox"
              checked={visibleAllSelected}
              onChange={() => {
                const next = new Set(selected);
                if (visibleAllSelected) {
                  visibleValues.forEach((item) => next.delete(item));
                } else {
                  visibleValues.forEach((item) => next.add(item));
                }
                commitSelection(next);
              }}
            />
            <span>Бүгд</span>
          </label>
        )}
        {visibleValues.length === 0 ? (
          <div className="ea-combo-filter__empty">Илэрц байхгүй</div>
        ) : (
          visibleValues.map((item) => (
            <label key={item}>
              <input
                type="checkbox"
                checked={selected.has(item)}
                onChange={() => toggleValue(item)}
              />
              <span title={item}>{item}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
