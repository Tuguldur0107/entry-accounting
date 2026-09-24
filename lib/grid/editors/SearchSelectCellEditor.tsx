"use client";

// Хайлттай сонголтын cell editor (popup) — AG Grid Community-ийн
// `agSelectCellEditor` эхний үсгээр л үсэрдэг тул 30+ бараатай үед хүссэнээ
// олох боломжгүй байв («ITM-013» гэж бичихэд ITM-002 сонгогдов — ENT-040,
// UI гайдын карт 5). Нэр, код, нэмэлт тайлбар (үнэ, үлдэгдэл) аль нэгээр нь
// хайна; ↑↓ Enter, Esc.
//
// АНХААР (AG Grid v32+): утгаа props.onValueChange()-ээр дамжуулна.
// `cellEditorPopup: true`-тэй хэрэглэнэ (grid-ийн popup давхаргад суудаг тул
// focus алдахгүй).

import { useEffect, useMemo, useRef, useState } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";

import { cn } from "@/lib/utils";

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Саарал жижиг код (ITM-013). */
  code?: string;
  /** Баруун талын тайлбар (үнэ, үлдэгдэл). */
  hint?: string;
  /** Тайлбарын өнгө — бага үлдэгдэл шар, байхгүй улаан. */
  hintTone?: "warning" | "danger";
}

export interface SearchSelectCellEditorParams {
  options: SearchSelectOption[];
  /** Хоосон утга сонгох мөр (default «— сонгохгүй»). null бол харуулахгүй. */
  emptyLabel?: string | null;
}

/** Хайлтын ЦЭВЭР шүүлт — бүх үг нэр/код/тайлбарт агуулагдана (тесттэй). */
export function filterSearchOptions(
  options: SearchSelectOption[],
  query: string
): SearchSelectOption[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;
  return options.filter((option) => {
    const haystack = `${option.label} ${option.code ?? ""} ${option.hint ?? ""}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function SearchSelectCellEditor(
  props: CustomCellEditorProps<unknown, string> & Partial<SearchSelectCellEditorParams>
) {
  const options = useMemo(() => props.options ?? [], [props.options]);
  const emptyLabel = props.emptyLabel === undefined ? "— сонгохгүй" : props.emptyLabel;
  const [query, setQuery] = useState(
    props.eventKey && props.eventKey.length === 1 ? props.eventKey : ""
  );
  const filtered = useMemo(() => {
    const list = filterSearchOptions(options, query);
    return emptyLabel && !query ? [{ value: "", label: emptyLabel }, ...list] : list;
  }, [options, query, emptyLabel]);
  const [active, setActive] = useState(() =>
    Math.max(0, filtered.findIndex((option) => option.value === (props.value ?? "")))
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(option: SearchSelectOption | undefined) {
    if (!option) return;
    props.onValueChange(option.value);
    // onValueChange-ийн дараа editor-ийг хаана (утга commit болно).
    setTimeout(() => props.stopEditing(), 0);
  }

  return (
    <div
      className="w-[320px] rounded-md border border-[var(--ea-border-strong)] bg-[var(--ea-surface)] shadow-lg"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          setActive((index) => Math.min(filtered.length - 1, index + 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          event.stopPropagation();
          setActive((index) => Math.max(0, index - 1));
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          pick(filtered[active]);
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        aria-label="Хайх (нэр, код, үнэ)"
        placeholder="Хайх — нэр, код…"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        className="h-9 w-full border-b border-[var(--ea-border)] bg-transparent px-2.5 text-sm outline-none"
      />
      <div ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-[var(--ea-text-4)]">Олдсонгүй</div>
        ) : (
          filtered.map((option, index) => (
            <div
              key={option.value || "__empty"}
              role="option"
              aria-selected={index === active}
              data-index={index}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex min-h-10 cursor-pointer items-center gap-2 px-2.5 text-sm",
                index === active && "bg-[var(--ea-selected-bg)]"
              )}
            >
              <span className="min-w-0 flex-1 truncate text-[var(--ea-text-1)]">{option.label}</span>
              {option.code ? (
                <span className="font-mono text-[11px] text-[var(--ea-text-4)]">{option.code}</span>
              ) : null}
              {option.hint ? (
                <span
                  className={cn(
                    "font-mono text-[11px] tabular-nums",
                    option.hintTone === "danger"
                      ? "text-[var(--ea-danger-fg)]"
                      : option.hintTone === "warning"
                        ? "text-[var(--ea-warning-fg)]"
                        : "text-[var(--ea-text-3)]"
                  )}
                >
                  {option.hint}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
