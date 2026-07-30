"use client";

// Lightweight searchable dropdown for long option lists (e.g. the GL
// chart of accounts). A plain <select> becomes unusable past a few dozen
// rows; this gives a filter box plus a keyboard-navigable list, portalled
// to <body> so it isn't clipped by dialog overflow.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { createPortal } from "react-dom";

const MIN_WIDTH = 260;
const MARGIN = 8;
/** Хүсэмжит өндөр (хайлтын мөр + жагсаалт) — flip шийдэх босго. */
const PREFERRED_HEIGHT = 300;

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional secondary text shown muted next to the label. */
  hint?: string;
}

/**
 * Anchor-оос portal-ийн байрлалыг тооцно. Trigger-ийн rect нь нээх үед
 * авагддаг тул scroll/resize дээр panel-ыг хаадаг (доор effect); энд зөвхөн
 * viewport-д багтаах — доошоо зай хүрэхгүй бол дээшээ эргэнэ, хэвтээ чиглэлд
 * шахна.
 */
function panelPosition(anchor: DOMRect) {
  const width = Math.min(
    Math.max(MIN_WIDTH, anchor.width),
    window.innerWidth - MARGIN * 2
  );
  const left = Math.max(
    MARGIN,
    Math.min(anchor.left, window.innerWidth - width - MARGIN)
  );
  const spaceBelow = window.innerHeight - anchor.bottom - MARGIN;
  const spaceAbove = anchor.top - MARGIN;
  const openUp = spaceBelow < PREFERRED_HEIGHT && spaceAbove > spaceBelow;
  const available = Math.max(0, openUp ? spaceAbove : spaceBelow) - 4;
  const maxHeight = Math.max(140, Math.min(PREFERRED_HEIGHT, available));
  return openUp
    ? { left, width, bottom: window.innerHeight - anchor.top + 4, maxHeight }
    : { left, width, top: anchor.bottom + 4, maxHeight };
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
  const [query, setQuery] = useState("");
  // Нээлттэй эсэх нь anchor-оор илэрхийлэгдэнэ — null бол хаалттай.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
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
    setAnchor(triggerRef.current.getBoundingClientRect());
    setQuery("");
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) => {
      const node = target as HTMLElement | null;
      return Boolean(
        node && (triggerRef.current?.contains(node) ||
          node.closest?.("[data-searchable-portal]"))
      );
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!isInside(e.target)) setAnchor(null);
    };
    // Capture дээр барьж stopPropagation хийнэ — эс бөгөөс Dialog нь ижил
    // Escape дээр бүхэлдээ хаагдана (Base UI нь document-д bubble сонсдог).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setAnchor(null);
    };
    // Anchor координат хуучирдаг тул гадна scroll/resize дээр хаана.
    const onScroll = (e: Event) => {
      if (!isInside(e.target)) setAnchor(null);
    };
    const onResize = () => setAnchor(null);
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function pick(v: string) {
    onChange(v);
    setAnchor(null);
    setQuery("");
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? setAnchor(null) : openDropdown())}
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
        <Icon name="select" size="sm" className="shrink-0 text-[var(--ea-text-4)]" />
      </button>

      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-searchable-portal=""
            style={{
              position: "fixed",
              ...panelPosition(anchor),
              display: "flex",
              flexDirection: "column",
              zIndex: 10000,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 8,
              boxShadow: "var(--ea-shadow-3)",
              overflow: "hidden",
            }}
          >
            <div
              className="shrink-0 p-1.5"
              style={{ borderBottom: "1px solid var(--ea-border)" }}
            >
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Хайх..."
                className="w-full rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] px-2 py-1.5 text-xs text-[var(--ea-text-1)] outline-none focus:border-[var(--ea-primary)]"
              />
            </div>
            {/* maxHeight нь эцэг элемент дээр — жагсаалт үлдсэн зайг эзэлнэ. */}
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
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
                    <Icon name="approve" size="sm" className="shrink-0" style={{ opacity: o.value === value ? 1 : 0, color: "var(--ea-primary)" }} />
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
