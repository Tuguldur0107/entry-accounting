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
import type { CustomCellEditorProps } from "ag-grid-react";
import {
  fmtAccountDisplay,
  normalizePastedAccount,
} from "@/lib/grid/segments";
import { AccountSegmentPanel } from "@/components/account/account-segment-panel";
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
  // Panel-ийн anchor — null бол хаалттай.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const panelOpen = anchor !== null;
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
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setAnchor(rect);
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
          if (e.key === "Enter" && panelOpen) setAnchor(null);
        }}
        className="flex-1 min-w-0 px-2 text-xs font-mono outline-none border-0"
        style={{ background: "transparent", color: "var(--ea-text-1)" }}
        placeholder="Данс..."
      />
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (panelOpen ? setAnchor(null) : openPanel())}
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

      <AccountSegmentPanel
        anchor={anchor}
        value={props.value ?? ""}
        onChange={handlePick}
        onCancel={() => {
          props.onValueChange(initialCode);
          setText(fmtAccountDisplay(initialCode, activeSegIds));
          setAnchor(null);
        }}
        onConfirm={() => {
          setAnchor(null);
          props.stopEditing();
        }}
        activeSegIds={activeSegIds}
        segmentOptions={segOptions}
        defaultSegments={extraDefaults}
        agPopup
        // AG Grid өөрөө focus/stopEditing-ээ удирддаг тул гадна дарж хаахгүй.
        closeOnOutside={false}
      />
    </div>
  );
}
