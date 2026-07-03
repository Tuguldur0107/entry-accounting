"use client";

// Данс оруулах нэгдсэн input — хоёр горим:
//   1. Гараар бичих: active-only код (ж: "100.11210000") эсвэл бүтэн 10-part код,
//      блюр/Enter дээр normalizePastedAccount-аар бүтэн код болгоно.
//   2. Сегмент сонгох: баруун талын товч → AccountSegmentPicker popover.
// value нь үргэлж бүтэн 10-part dotted код байна.

import { useEffect, useRef, useState } from "react";
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Бичиж байх үед draftText, бусад үед value-гийн display-г үзүүлнэ —
  // effect шаардлагагүй derive.
  const text = draftText ?? fmtAccountDisplay(value, activeSegIds);

  // Popover-оос гадуур дарвал хаана
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapperRef.current?.contains(t)) return;
      // SegSelect-ийн portal dropdown дээр дарсныг popover-ийн дотор гэж үзнэ
      if ((t as HTMLElement).closest?.("[data-seg-portal]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function commitText() {
    if (draftText === null) return;
    const normalized = normalizePastedAccount(draftText, activeSegIds, defaultSegments);
    onChange(normalized);
    setDraftText(null);
  }

  function openPicker() {
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

      {open && (
        <div
          className="absolute z-50 mt-1 left-0 p-3 rounded-lg"
          style={{
            minWidth: 380,
            background: "var(--ea-surface)",
            border: "1px solid var(--ea-border-strong)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          <AccountSegmentPicker
            value={draft}
            onChange={setDraft}
            activeSegIds={activeSegIds}
            segmentOptions={segmentOptions}
            defaultSegments={defaultSegments}
          />
          <div
            className="flex items-center justify-end gap-2 mt-3 pt-2.5"
            style={{ borderTop: "1px solid var(--ea-border)" }}
          >
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
      )}
    </div>
  );
}
