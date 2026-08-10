"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { parseMntInput } from "@/lib/grid/formatters";

// Numeric inline editor for debit / credit cells. Returns a parsed money
// number; the Dr⊕Cr mutex is enforced by the surface's onCellValueChanged
// handler (single source of truth — editor must not mutate grid rowData).
export function DebitCreditEditor(
  props: CustomCellEditorProps<Record<string, unknown>, number>
) {
  const initial = props.value == null || props.value === 0 ? "" : String(props.value);
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const nextText = e.target.value;
        setText(nextText);
        const amount = parseMntInput(nextText);
        props.onValueChange(
          Number.isFinite(amount) && amount > 0 ? amount : 0
        );
      }}
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
