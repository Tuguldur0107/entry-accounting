"use client";

// AG Grid-ийн данс cell editor — INLINE горим:
//   - Нүдэнд шууд гараар бичнэ (active-only эсвэл бүтэн 10-part код)
//   - Баруун талын ⌄ товч → сегмент бүрийн dropdown panel (portal)
//
// АНХААР (AG Grid v32+): React custom editor нь утгаа заавал
// props.onValueChange()-ээр дамжуулна — ref.getValue() ажиллахгүй.
// Panel нь document.body-д portal хийгддэг тул grid focus алдаж edit-ийг
// таслахаас сэргийлж "ag-custom-component-popup" class заавал хэрэгтэй.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CustomCellEditorProps } from "ag-grid-react";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { AccountSegmentPicker } from "@/components/account/account-segment-picker";
import type { SegOption } from "./SegSelect";

export interface AccountSegmentEditorParams {
  activeSegIds: number[];
  segOptions: Record<number, SegOption[]>;
  extraDefaults?: Record<number, string>;
}

export function AccountSegmentEditor(
  props: CustomCellEditorProps<unknown, string> & Partial<AccountSegmentEditorParams>
) {
  const activeSegIds = props.activeSegIds ?? [];
  const segOptions = props.segOptions ?? {};
  const extraDefaults = props.extraDefaults ?? {};

  const initialCode = props.value ?? "";
  // eventKey: хэрэглэгч үсэг дарж эхэлсэн бол тэр тэмдэгтээр эхэлнэ
  const startText =
    props.eventKey && props.eventKey.length === 1
      ? props.eventKey
      : fmtAccountDisplay(initialCode, activeSegIds);

  const [text, setText] = useState(startText);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Бичиж эхэлсэн бол курсор төгсгөлд, эс бол бүгдийг сонгоно
    if (props.eventKey && props.eventKey.length === 1) {
      inputRef.current?.setSelectionRange(1, 1);
    } else {
      inputRef.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Гараар бичсэн текстийг цаг тухайд нь normalize хийж grid-д дамжуулна —
  // focus гэнэт алдагдсан ч сүүлийн утга хадгалагдана.
  function handleTextChange(next: string) {
    setText(next);
    props.onValueChange(
      next.trim() === ""
        ? ""
        : normalizePastedAccount(next, activeSegIds, extraDefaults)
    );
  }

  function openPanel() {
    const r = wrapperRef.current?.getBoundingClientRect();
    if (r) setPanelPos({ top: r.bottom + 2, left: r.left });
    setPanelOpen(true);
  }

  function handlePick(code: string) {
    props.onValueChange(code);
    setText(fmtAccountDisplay(code, activeSegIds));
  }

  return (
    <div
      ref={wrapperRef}
      className="flex items-stretch w-full h-full"
      style={{ background: "var(--ea-surface)" }}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && panelOpen) setPanelOpen(false);
        }}
        className="flex-1 min-w-0 px-2 text-xs font-mono outline-none border-0"
        style={{ background: "transparent", color: "var(--ea-text-1)" }}
        placeholder="Данс..."
      />
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}
        title="Сегментээр сонгох"
        className="px-1.5 flex items-center justify-center shrink-0 transition-colors"
        style={{
          borderLeft: "1px solid var(--ea-border)",
          background: panelOpen ? "var(--ea-bg-2)" : "transparent",
          color: "var(--ea-text-3)",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path
            d="M2 4.5L6 8l4-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {panelOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="ag-custom-component-popup"
            style={{
              position: "fixed",
              top: panelPos.top,
              left: panelPos.left,
              zIndex: 10000,
              minWidth: 380,
              padding: 12,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 10,
              boxShadow: "var(--ea-shadow-3)",
            }}
          >
            <AccountSegmentPicker
              value={props.value ?? ""}
              onChange={handlePick}
              activeSegIds={activeSegIds}
              segmentOptions={segOptions}
              defaultSegments={extraDefaults}
            />
            <div
              className="flex items-center justify-end gap-2 mt-3 pt-2.5"
              style={{ borderTop: "1px solid var(--ea-border)" }}
            >
              <button
                type="button"
                onClick={() => {
                  props.onValueChange(initialCode);
                  setText(fmtAccountDisplay(initialCode, activeSegIds));
                  setPanelOpen(false);
                }}
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
                  setPanelOpen(false);
                  props.stopEditing();
                }}
                className="px-3 py-1.5 text-xs font-semibold text-white rounded-md"
                style={{ background: "var(--ea-primary)" }}
              >
                Оруулах
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
