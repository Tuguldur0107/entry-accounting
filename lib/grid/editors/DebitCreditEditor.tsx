"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { parseMntInput } from "@/lib/grid/formatters";

interface CellEditorRef {
  getValue: () => number;
}

// Numeric inline editor for debit / credit cells. Returns a parsed money
// number; the Dr⊕Cr mutex is enforced by the surface's onCellValueChanged
// handler (single source of truth — editor must not mutate grid rowData).
function DebitCreditEditorInner(
  props: CustomCellEditorProps<Record<string, unknown>, number>,
  ref: ForwardedRef<CellEditorRef>
) {
  const initial = props.value == null || props.value === 0 ? "" : String(props.value);
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useImperativeHandle(ref, () => ({
    getValue: () => {
      const n = parseMntInput(text);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
  }));

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
      }}
      style={{
        width: "100%",
        height: "100%",
        padding: "0 12px",
        border: "none",
        outline: "none",
        background: "transparent",
        color: "var(--ea-text-1)",
        fontFamily: "var(--ea-font-mono, ui-monospace, monospace)",
        fontSize: 13,
        textAlign: "right",
      }}
    />
  );
}

export const DebitCreditEditor = forwardRef(DebitCreditEditorInner);
