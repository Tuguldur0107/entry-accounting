"use client";

// Lightweight searchable dropdown for long option lists (e.g. the GL
// chart of accounts). A plain <select> becomes unusable past a few dozen
// rows; this gives a filter box plus a keyboard-navigable list, portalled
// to <body> so it isn't clipped by dialog overflow.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronsUpDown, Check } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional secondary text shown muted next to the label. */
  hint?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  /** Trigger дээр түлхүүр утгыг (font-mono) нуугаад зөвхөн label үзүүлнэ. */
  hideValue?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Сонгох...",
  hideValue = false,
  emptyLabel = "Илэрц олдсонгүй",
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(q) ||
        o.label.toLowerCase().includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  function openDropdown() {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    setQuery("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-searchable-portal]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="ea-form-select flex w-full items-center justify-between gap-2 text-left disabled:opacity-50"
      >
        <span
          className={selected ? "truncate text-[var(--ea-text-1)]" : "truncate text-[var(--ea-text-4)]"}
        >
          {selected ? (
            hideValue ? (
              <span>{selected.label}</span>
            ) : (
              <>
                <span className="font-mono">{selected.value}</span>
                <span className="ml-2 text-[var(--ea-text-3)]">{selected.label}</span>
              </>
            )
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-[var(--ea-text-4)]" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-searchable-portal=""
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: Math.max(pos.width, 260),
              zIndex: 10000,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 8,
              boxShadow: "var(--ea-shadow-3)",
              overflow: "hidden",
            }}
          >
            <div className="p-1.5" style={{ borderBottom: "1px solid var(--ea-border)" }}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Хайх..."
                className="w-full rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] px-2 py-1.5 text-xs text-[var(--ea-text-1)] outline-none focus:border-[var(--ea-primary)]"
              />
            </div>
            <div style={{ maxHeight: 260, overflowY: "auto" }}>
              <button
                type="button"
                onMouseDown={() => pick("")}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--ea-text-4)] transition-colors hover:bg-[var(--ea-bg-2)]"
              >
                — Хоосон
              </button>
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--ea-text-4)]">
                  {emptyLabel}
                </div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onMouseDown={() => pick(o.value)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ea-bg-2)]"
                    style={{
                      background: o.value === value ? "var(--ea-primary-50)" : "transparent",
                    }}
                  >
                    <Check
                      size={13}
                      className="shrink-0"
                      style={{ opacity: o.value === value ? 1 : 0, color: "var(--ea-primary)" }}
                    />
                    <span className="font-mono font-medium shrink-0 text-[var(--ea-primary-500)]">
                      {o.value}
                    </span>
                    <span className="truncate text-[var(--ea-text-2)]">{o.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
