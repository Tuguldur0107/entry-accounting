"use client";

// Данс оруулах нэгдсэн input — хоёр горим:
//   1. Гараар бичих: active-only код (ж: "100.11210000") эсвэл бүтэн 10-part код,
//      блюр/Enter дээр normalizePastedAccount-аар бүтэн код болгоно.
//   2. Сегмент сонгох: баруун талын товч → AccountSegmentPicker popover.
// value нь үргэлж бүтэн 10-part dotted код байна.
//
// Popover нь document.body-руу portal хийгдэнэ: dialog/grid-ийн overflow
// хайрцагт хавчигдахгүй, идэвхтэй сегментийн тоо нэмэгдэхэд (динамик)
// viewport-д багтааж дээш/доош эргэж, дотроо гүйлгэдэг.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import {
  AccountSegmentPicker,
} from "./account-segment-picker";
import type { SegOption } from "@/lib/grid/editors/SegSelect";

export interface AccountInputProps {
  value: string;
  onChange: (code: string) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  placeholder?: string;
  disabled?: boolean;
}

const POPOVER_WIDTH = 400;
const MARGIN = 16;

export function AccountInput({
  value,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments = {},
  placeholder = "Данс...",
  disabled = false,
}: AccountInputProps) {
  const [draftText, setDraftText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  // Viewport координат — portal хийгдсэн popover-ийн байрлал.
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({ left: 0, width: POPOVER_WIDTH, maxHeight: 480 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Бичиж байх үед draftText, бусад үед value-гийн display-г үзүүлнэ —
  // effect шаардлагагүй derive.
  const text = draftText ?? fmtAccountDisplay(value, activeSegIds);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      // SegSelect-ийн portal dropdown дээр дарсныг popover-ийн дотор гэж үзнэ
      if ((t as HTMLElement).closest?.("[data-seg-portal]")) return;
      setOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Гадна талын scroll/resize нь хадгалсан координатыг хуучруулна — хаана.
    // Popover болон SegSelect list доторх scroll-д хаахгүй.
    const closeOnScroll = (e: Event) => {
      const t = e.target as Node | null;
      if (
        t &&
        (popoverRef.current?.contains(t) ||
          (t as HTMLElement).closest?.("[data-seg-portal]"))
      )
        return;
      setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("scroll", closeOnScroll, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("scroll", closeOnScroll, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  function commitText() {
    if (draftText === null) return;
    const normalized = normalizePastedAccount(draftText, activeSegIds, defaultSegments);
    onChange(normalized);
    setDraftText(null);
  }

  function openPicker() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(
        Math.max(POPOVER_WIDTH, rect.width),
        window.innerWidth - MARGIN * 2
      );
      const left = Math.max(
        MARGIN,
        Math.min(rect.left, window.innerWidth - width - MARGIN)
      );
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const spaceAbove = rect.top - MARGIN;
      // Доошоо багтахгүй, дээр нь илүү зайтай бол дээшээ нээнэ; аль ч
      // талд maxHeight хязгаартай тул олон сегменттэй үед дотроо гүйлгэнэ.
      const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
      setPos(
        openUp
          ? {
              bottom: window.innerHeight - rect.top + 4,
              left,
              width,
              maxHeight: Math.max(240, spaceAbove - 4),
            }
          : {
              top: rect.bottom + 4,
              left,
              width,
              maxHeight: Math.max(240, spaceBelow - 4),
            }
      );
    }
    setDraft(value);
    setOpen(true);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div
        className="flex items-stretch rounded-md overflow-hidden"
        style={{ border: "1px solid var(--ea-border-strong)" }}
      >
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitText();
            }
          }}
          className="flex-1 min-w-0 px-3 py-2 text-sm font-mono outline-none"
          style={{ background: "var(--ea-surface)", color: "var(--ea-text-1)" }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openPicker())}
          title="Сегментээр сонгох"
          className="px-2.5 flex items-center justify-center transition-colors shrink-0"
          style={{
            borderLeft: "1px solid var(--ea-border)",
            background: open ? "var(--ea-bg-2)" : "var(--ea-surface)",
            color: "var(--ea-text-3)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 4.5L6 8l4-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            data-account-input-portal
            className="flex flex-col rounded-lg"
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: 70,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              boxShadow: "var(--ea-shadow-3)",
            }}
          >
            <div className="min-h-0 overflow-y-auto p-3">
              <AccountSegmentPicker
                value={draft}
                onChange={setDraft}
                activeSegIds={activeSegIds}
                segmentOptions={segmentOptions}
                defaultSegments={defaultSegments}
              />
            </div>
            <div
              className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5"
              style={{ borderTop: "1px solid var(--ea-border)" }}
            >
              <span className="truncate font-mono text-[11px] text-[var(--ea-text-4)]">
                {fmtAccountDisplay(draft, activeSegIds)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-md"
                  style={{
                    border: "1px solid var(--ea-border-strong)",
                    color: "var(--ea-text-2)",
                  }}
                >
                  Болих
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChange(draft);
                    setDraftText(null);
                    setOpen(false);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-white rounded-md"
                  style={{ background: "var(--ea-primary)" }}
                >
                  Оруулах
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
