"use client";

// Lightweight searchable dropdown for long option lists (e.g. the GL
// chart of accounts). A plain <select> becomes unusable past a few dozen
// rows; this gives a filter box plus a keyboard-navigable list, portalled
// to <body> so it isn't clipped by dialog overflow.
// Гар: ↑/↓ мөр солих, Enter идэвхтэй мөрийг сонгох (илэрцгүй бол юу ч
// сонгохгүй), Esc хаах, Tab хаагаад дараагийн талбар. «— Хоосон» нь ЗӨВХӨН
// хулганаар — Tab/Enter-ээр санамсаргүй утга арилахаас сэргийлнэ.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { createPortal } from "react-dom";
import { enterPickValue, initialActiveIndex, moveActiveIndex } from "@/lib/ui/listbox-nav";

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
  /**
   * Хайлтын текст өөрчлөгдөх бүрд (нээхэд "") — СЕРВЕРИЙН хайлттай жагсаалтад
   * (ж: eBarimt-ийн хэдэн мянган ангиллын код). `serverFiltered`-тэй хамт.
   */
  onQueryChange?: (query: string) => void;
  /** `options` аль хэдийн хайлтаар шүүгдсэн — дотооддоо ДАХИН шүүхгүй. */
  serverFiltered?: boolean;
  /**
   * Жагсаалтад байхгүй утгыг ГАРААР оруулах (ж: ТЕГ шинээр нэмсэн код).
   * Хайлтын текстээс сонголт буцаавал жагсаалтын эхэнд гарна; null = үгүй.
   */
  customOption?: (query: string) => SearchableOption | null;
  /** Нэг дор зурах дээд мөр — их жагсаалтад хайлтаа нарийсгахыг санал болгоно. */
  maxVisible?: number;
  /** Жагсаалтын доорх тайлбар (ж: эх сурвалжийн тухай). */
  footer?: ReactNode;
  /** Trigger-ийн утга жагсаалтад байхгүй үед харуулах label (ж: хадгалсан код). */
  valueLabel?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Сонгох...",
  hideValue = false,
  emptyLabel = "Илэрц олдсонгүй",
  disabled = false,
  onQueryChange,
  serverFiltered = false,
  customOption,
  maxVisible,
  footer,
  valueLabel,
}: Props) {
  const [query, setQuery] = useState("");
  // Нээлттэй эсэх нь anchor-оор илэрхийлэгдэнэ — null бол хаалттай.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = anchor !== null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // Гарын идэвхтэй мөр — `visible`-ийн индекс (-1 = мөр алга).
  const [active, setActive] = useState(-1);

  const selected =
    options.find((o) => o.value === value) ??
    (value && valueLabel !== undefined ? { value, label: valueLabel } : undefined);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base =
      !q || serverFiltered
        ? options
        : options.filter(
            (o) =>
              o.value.toLowerCase().includes(q) ||
              o.label.toLowerCase().includes(q) ||
              (o.hint?.toLowerCase().includes(q) ?? false)
          );
    const custom = customOption?.(query.trim()) ?? null;
    return custom && !base.some((o) => o.value === custom.value) ? [custom, ...base] : base;
  }, [options, query, serverFiltered, customOption]);
  const visible = maxVisible ? filtered.slice(0, maxVisible) : filtered;
  const hidden = filtered.length - visible.length;
  // Сервер талын жагсаалт хожуу ирж богиносож болох тул хэрэглэхдээ хязгаарлана.
  const activeIndex = visible.length === 0 ? -1 : Math.min(active, visible.length - 1);

  function changeQuery(next: string) {
    setQuery(next);
    onQueryChange?.(next);
    setActive(next.trim() ? 0 : unfilteredActive());
  }

  // Хайлтгүй жагсаалтад сонгосон утгын мөр (эс бөгөөс эхний мөр).
  function unfilteredActive() {
    const base = maxVisible ? options.slice(0, maxVisible) : options;
    return initialActiveIndex(base.map((o) => o.value), value, false);
  }

  function openDropdown() {
    if (disabled || !triggerRef.current) return;
    setAnchor(triggerRef.current.getBoundingClientRect());
    changeQuery("");
    setTimeout(() => inputRef.current?.focus(), 30);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(moveActiveIndex(activeIndex, e.key === "ArrowDown" ? 1 : -1, visible.length));
    } else if (e.key === "Enter") {
      // Маягтыг submit хийлгэхгүй; илэрцгүй бол юу ч сонгохгүй («Хоосон» БИШ).
      e.preventDefault();
      const next = enterPickValue(visible.map((o) => o.value), activeIndex);
      if (next !== null) {
        pick(next);
        triggerRef.current?.focus();
      }
    } else if (e.key === "Tab") {
      // Portal body-ийн төгсгөлд тул Tab-ийг trigger-ээс үргэлжлүүлнэ.
      setAnchor(null);
      triggerRef.current?.focus();
    }
  }

  // Идэвхтэй мөрийг жагсаалтын харагдах хэсэгт байлгана.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

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
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
                placeholder="Хайх..."
                className="w-full rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg)] px-2 py-1.5 text-xs text-[var(--ea-text-1)] outline-none focus:border-[var(--ea-primary)]"
              />
            </div>
            {/* maxHeight нь эцэг элемент дээр — жагсаалт үлдсэн зайг эзэлнэ. */}
            <div ref={listRef} id={listId} role="listbox" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={() => pick("")}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[var(--ea-text-4)] transition-colors hover:bg-[var(--ea-bg-2)]"
              >
                — Хоосон
              </button>
              {visible.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-[var(--ea-text-4)]">
                  {emptyLabel}
                </div>
              ) : (
                visible.map((o, index) => (
                  <button
                    key={o.value}
                    id={`${listId}-${index}`}
                    type="button"
                    tabIndex={-1}
                    role="option"
                    aria-selected={o.value === value}
                    data-option-index={index}
                    onMouseDown={() => pick(o.value)}
                    onMouseEnter={() => setActive(index)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ea-bg-2)]"
                    style={{
                      background:
                        index === activeIndex
                          ? "var(--ea-bg-2)"
                          : o.value === value
                            ? "var(--ea-primary-50)"
                            : "transparent",
                      boxShadow: index === activeIndex ? "inset 2px 0 0 var(--ea-primary)" : undefined,
                    }}
                  >
                    <Icon name="approve" size="sm" className="shrink-0" style={{ opacity: o.value === value ? 1 : 0, color: "var(--ea-primary)" }} />
                    {/* hideValue: uuid маягийн дотоод түлхүүрийг нуугаад нэрийг
                        нь үндсэн болгоно (данс шиг утга нь өөрөө код бол үзүүлнэ). */}
                    {!hideValue && (
                      <span className="font-mono font-medium shrink-0 text-[var(--ea-primary-500)]">
                        {o.value}
                      </span>
                    )}
                    <span
                      className={
                        hideValue
                          ? "truncate text-[var(--ea-text-1)]"
                          : "truncate text-[var(--ea-text-2)]"
                      }
                    >
                      {o.label}
                    </span>
                    {o.hint && (
                      <span className="ml-auto shrink-0 text-[10px] text-[var(--ea-text-4)]">
                        {o.hint}
                      </span>
                    )}
                  </button>
                ))
              )}
              {hidden > 0 && (
                <div className="px-3 py-2 text-center text-[10px] text-[var(--ea-text-4)]">
                  … өөр {hidden} илэрц — хайлтаа нарийсгана уу
                </div>
              )}
            </div>
            {footer && (
              <div
                className="shrink-0 px-2.5 py-1.5 text-[10px] leading-snug text-[var(--ea-text-4)]"
                style={{ borderTop: "1px solid var(--ea-border)" }}
              >
                {footer}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
