"use client";

// Данс оруулах нэгдсэн input — хоёр горим:
//   1. Гараар бичих: active-only код (ж: "100.11210000") эсвэл бүтэн 10-part код,
//      блюр/Enter дээр normalizePastedAccount-аар бүтэн код болгоно.
//   2. Сегмент сонгох: баруун талын товч → нэгдсэн AccountSegmentPanel
//      (grid editor-той ижил panel — portal, дээш/доош эргэх, гүйлгэх).
// value нь үргэлж бүтэн 10-part dotted код байна.
// SIM2-029: бичих үед данс КОД эсвэл НЭРЭЭР санал (код · нэр) гарна —
// ↑↓ сонгож Enter; сегментийн panel нь нарийвчилсан (advanced) горим.

import { useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  buildSegCode,
  fmtAccountDisplay,
  normalizePastedAccount,
  parseSegParts,
} from "@/lib/grid/segments";
import { suggestAccounts } from "@/lib/grid/account-search";
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

  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  // Бичиж байх үед draftText, бусад үед value-гийн display-г үзүүлнэ —
  // effect шаардлагагүй derive.
  const text = draftText ?? fmtAccountDisplay(value, activeSegIds);
  const suggestions = useMemo(
    () => (draftText === null ? [] : suggestAccounts(segmentOptions[3] ?? [], draftText)),
    [draftText, segmentOptions]
  );

  /** Санал болгосон дансыг сонгоно — бусад сегмент одоогийн утгаасаа. */
  function choose(code: string) {
    const parts = value ? parseSegParts(value, activeSegIds) : { ...defaultSegments };
    onChange(buildSegCode({ ...parts, 3: code }, activeSegIds, defaultSegments));
    setDraftText(null);
    setHighlight(0);
  }

  function commitText() {
    if (draftText === null) return;
    // Нэрээр бичээд сонголгүй гарвал: ганц санал бол түүнийг, үгүй бол
    // өмнөх утга хэвээр (нэрийг код болгож эвдэхгүй).
    if (draftText.trim() && !/\d/.test(draftText)) {
      if (suggestions.length === 1) choose(suggestions[0].code);
      else setDraftText(null);
      return;
    }
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
          onChange={(e) => {
            setDraftText(e.target.value);
            setHighlight(0);
          }}
          onBlur={commitText}
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={placeholder}
          onKeyDown={(e) => {
            if (suggestions.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHighlight((current) =>
                e.key === "ArrowDown"
                  ? Math.min(current + 1, suggestions.length - 1)
                  : Math.max(current - 1, 0)
              );
              return;
            }
            if (e.key === "Escape" && draftText !== null) {
              setDraftText(null);
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (suggestions.length > 0 && !/^\d{8}$/.test(draftText?.trim() ?? ""))
                choose(suggestions[Math.min(highlight, suggestions.length - 1)].code);
              else commitText();
            }
          }}
          className="flex-1 min-w-0 px-3 py-2 text-sm font-mono outline-none"
          style={{ background: "var(--ea-surface)", color: "var(--ea-text-1)" }}
        />
        <button
          type="button"
          disabled={disabled}
          // Panel-ийн гадна-дарж-хаах шалгалт энэ товчийг "дотор" гэж үзнэ —
          // үгүй бол mousedown хаагаад click дахин нээж, toggle ажиллахгүй.
          data-account-segment-trigger
          onClick={() => (open ? setAnchor(null) : openPicker())}
          title="Сегментээр сонгох"
          className="px-2.5 flex items-center justify-center transition-colors shrink-0"
          style={{
            borderLeft: "1px solid var(--ea-border)",
            background: open ? "var(--ea-bg-2)" : "var(--ea-surface)",
            color: "var(--ea-text-3)",
          }}
        >
          <Icon name="chevronDown" size="xs" />
        </button>
      </div>

      {suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md py-1 text-sm shadow-lg"
          style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border-strong)" }}
        >
          {suggestions.map((option, index) => (
            <li
              key={option.code}
              role="option"
              aria-selected={index === highlight}
              // mousedown — blur (commitText)-аас ӨМНӨ сонгоно.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option.code);
              }}
              onMouseEnter={() => setHighlight(index)}
              className="flex cursor-pointer gap-2 px-3 py-1.5"
              style={{
                background: index === highlight ? "var(--ea-bg-2)" : undefined,
                color: "var(--ea-text-1)",
              }}
            >
              <span className="font-mono text-[var(--ea-text-3)]">{option.code}</span>
              <span className="truncate">{option.name}</span>
            </li>
          ))}
        </ul>
      )}

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
