"use client";

// Сегмент сонгох НЭГДСЭН panel — anchor-т наасан portal popover.
// Гурван callsite-д НЭГ л энэ component ашиглагдана:
//   1. AccountSegmentEditor  — AG Grid дансны нүдний editor (agPopup)
//   2. AccountInput          — форм дахь дансны талбар
//   3. JournalLinesGrid      — харах горимд сегментийн задаргаа (readOnly)
// Байрлал: viewport-д багтааж дээш/доош эргэнэ, дотроо гүйлгэнэ.
// Төлөв (draft/commit) нь callsite бүрийнх — panel зөвхөн харуулна.

import { useEffect } from "react";
import { createPortal } from "react-dom";

import { AccountSegmentPicker } from "./account-segment-picker";
import { fmtAccountDisplay } from "@/lib/grid/segments";
import { Z } from "@/lib/ui/z-layers";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

const MIN_WIDTH = 380;
const MARGIN = 16;

export interface AccountSegmentPanelProps {
  /** Нээх байрлалын anchor — null бол panel хаалттай. */
  anchor: DOMRect | null;
  /** Бүтэн 10-part код. */
  value: string;
  onChange?: (code: string) => void;
  /** Болих / Хаах / гадна дарах. */
  onCancel: () => void;
  /** Оруулах — readOnly үед үзүүлэхгүй. */
  onConfirm?: () => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  /** Зөвхөн харах — сегментүүд статик, зөвхөн "Хаах" товч. */
  readOnly?: boolean;
  /** AG Grid editor дотор — popup нь grid-ийн focus-ыг таслахгүй байх class. */
  agPopup?: boolean;
  /** Гадна дарж/гүйлгэж хаах (AG Grid editor дотор өөрөө удирддаг). */
  closeOnOutside?: boolean;
}

export function AccountSegmentPanel({
  anchor,
  value,
  onChange,
  onCancel,
  onConfirm,
  activeSegIds,
  segmentOptions,
  defaultSegments = {},
  readOnly = false,
  agPopup = false,
  closeOnOutside = true,
}: AccountSegmentPanelProps) {
  useEffect(() => {
    if (!anchor || !closeOnOutside) return;
    const isInside = (target: EventTarget | null) => {
      const node = target as HTMLElement | null;
      return Boolean(
        node?.closest?.("[data-account-segment-panel]") ||
          // SegSelect-ийн dropdown нь тусдаа portal — panel-ийн дотор гэж үзнэ.
          node?.closest?.("[data-seg-portal]") ||
          // Нээсэн товч өөрөө toggle хийдэг тул mousedown дээр хаахгүй.
          node?.closest?.("[data-account-segment-trigger]")
      );
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!isInside(event.target)) onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    // Anchor координат хуучирдаг тул гадна scroll/resize дээр хаана.
    const onScroll = (event: Event) => {
      if (!isInside(event.target)) onCancel();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onCancel);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onCancel);
    };
  }, [anchor, closeOnOutside, onCancel]);

  if (!anchor || typeof document === "undefined") return null;

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
  // Доошоо багтахгүй, дээр нь илүү зайтай бол дээшээ нээнэ. maxHeight нь
  // боломжит зайнаас хэтрэхгүй — жижиг цонхонд ч viewport-оос гарахгүй.
  const openUp = spaceBelow < 300 && spaceAbove > spaceBelow;
  const available = Math.max(0, openUp ? spaceAbove : spaceBelow) - 4;
  const position = openUp
    ? {
        bottom: window.innerHeight - anchor.top + 4,
        maxHeight: Math.max(120, Math.min(520, available)),
      }
    : {
        top: anchor.bottom + 4,
        maxHeight: Math.max(120, Math.min(520, available)),
      };

  return createPortal(
    <div
      data-account-segment-panel
      role="dialog"
      aria-label="Дансны сегмент"
      className={`flex flex-col rounded-lg print:hidden${agPopup ? " ag-custom-component-popup" : ""}`}
      style={{
        position: "fixed",
        left,
        width,
        ...position,
        zIndex: agPopup ? Z.gridPopup : Z.popover,
        background: "var(--ea-surface)",
        border: "1px solid var(--ea-border-strong)",
        boxShadow: "var(--ea-shadow-3)",
      }}
    >
      {readOnly && (
        <div
          className="flex shrink-0 items-center justify-between gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid var(--ea-border)" }}
        >
          <span className="text-[11px] font-semibold text-[var(--ea-text-2)]">
            Дансны сегмент
          </span>
          <span className="truncate font-mono text-[11px] text-[var(--ea-text-4)]">
            {fmtAccountDisplay(value, activeSegIds)}
          </span>
        </div>
      )}

      <div className="min-h-0 overflow-y-auto p-3">
        <AccountSegmentPicker
          value={value}
          onChange={onChange ?? (() => {})}
          activeSegIds={activeSegIds}
          segmentOptions={segmentOptions}
          defaultSegments={defaultSegments}
          readOnly={readOnly}
        />
      </div>

      <div
        className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5"
        style={{ borderTop: "1px solid var(--ea-border)" }}
      >
        {readOnly ? (
          <span />
        ) : (
          <span className="truncate font-mono text-[11px] text-[var(--ea-text-4)]">
            {fmtAccountDisplay(value, activeSegIds)}
          </span>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{
              border: "1px solid var(--ea-border-strong)",
              color: "var(--ea-text-2)",
            }}
          >
            {readOnly ? "Хаах" : "Болих"}
          </button>
          {!readOnly && onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{
                background: "var(--ea-primary)",
                color: "var(--primary-foreground)",
              }}
            >
              Оруулах
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
