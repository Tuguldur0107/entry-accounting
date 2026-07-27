"use client";

// Данс оруулах нэгдсэн input — хоёр горим:
//   1. Гараар бичих: active-only код (ж: "100.11210000") эсвэл бүтэн 10-part код,
//      блюр/Enter дээр normalizePastedAccount-аар бүтэн код болгоно.
//   2. Сегмент сонгох: баруун талын товч → нэгдсэн AccountSegmentPanel
//      (grid editor-той ижил panel — portal, дээш/доош эргэх, гүйлгэх).
// value нь үргэлж бүтэн 10-part dotted код байна.

import { useRef, useState } from "react";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { AccountSegmentPanel } from "./account-segment-panel";
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
  // Panel-ийн anchor — null бол хаалттай.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [draft, setDraft] = useState(value);
  const open = anchor !== null;
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Бичиж байх үед draftText, бусад үед value-гийн display-г үзүүлнэ —
  // effect шаардлагагүй derive.
  const text = draftText ?? fmtAccountDisplay(value, activeSegIds);

  function commitText() {
    if (draftText === null) return;
    const normalized = normalizePastedAccount(draftText, activeSegIds, defaultSegments);
    onChange(normalized);
    setDraftText(null);
  }

  function openPicker() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDraft(value);
    setAnchor(rect);
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
          onClick={() => (open ? setAnchor(null) : openPicker())}
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

      <AccountSegmentPanel
        anchor={anchor}
        value={draft}
        onChange={setDraft}
        onCancel={() => setAnchor(null)}
        onConfirm={() => {
          onChange(draft);
          setDraftText(null);
          setAnchor(null);
        }}
        activeSegIds={activeSegIds}
        segmentOptions={segmentOptions}
        defaultSegments={defaultSegments}
      />
    </div>
  );
}
