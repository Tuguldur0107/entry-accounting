"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { SEGMENT_DEFS, ACCOUNT_GROUPS } from "@/lib/constants/standard-accounts";
import { buildSegCode, parseSegParts } from "@/lib/grid/segments";
import { SegSelect, type SegOption } from "./SegSelect";

export interface AccountSegmentEditorParams {
  activeSegIds: number[];
  segOptions: Record<number, SegOption[]>;
  extraDefaults?: Record<number, string>;
}

interface CellEditorRef {
  getValue: () => string;
  isPopup: () => boolean;
}

function AccountSegmentEditorInner(
  props: CustomCellEditorProps<unknown, string> & {
    activeSegIds?: number[];
    segOptions?: Record<number, SegOption[]>;
    extraDefaults?: Record<number, string>;
  },
  ref: ForwardedRef<CellEditorRef>
) {
  const activeSegIds = props.activeSegIds ?? [];
  const segOptions = props.segOptions ?? {};
  const extraDefaults = props.extraDefaults ?? {};

  const initial = parseSegParts(props.value ?? "", activeSegIds);
  const [draft, setDraft] = useState<Record<number, string>>(initial);
  const finalCodeRef = useRef<string>(props.value ?? "");

  useImperativeHandle(ref, () => ({
    getValue: () => finalCodeRef.current,
    isPopup: () => true,
  }));

  function commit(next: Record<number, string>) {
    setDraft(next);
    finalCodeRef.current = buildSegCode(next, activeSegIds, extraDefaults);
  }

  function confirm() {
    finalCodeRef.current = buildSegCode(draft, activeSegIds, extraDefaults);
    props.stopEditing();
  }

  function cancel() {
    finalCodeRef.current = props.value ?? "";
    props.stopEditing(true);
  }

  return (
    <div
      style={{
        width: 320,
        background: "var(--ea-surface)",
        border: "1px solid var(--ea-border-strong)",
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--ea-border)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
          Данс сонгох
        </span>
        <button
          type="button"
          onClick={cancel}
          className="w-5 h-5 flex items-center justify-center rounded text-sm leading-none transition-colors"
          style={{ color: "var(--ea-text-4)" }}
        >
          ×
        </button>
      </div>

      <div className="p-3 space-y-2">
        {activeSegIds.map((segId) => {
          const def = SEGMENT_DEFS.find((d) => d.id === segId);
          if (!def) return null;
          return (
            <div key={segId} className="flex items-center gap-2">
              <div className="w-[88px] shrink-0">
                <span className="text-[11px] font-medium block" style={{ color: "var(--ea-text-3)" }}>
                  {def.nameMn}
                </span>
                <span className="text-[10px]" style={{ color: "var(--ea-text-4)" }}>
                  S{segId}
                </span>
              </div>
              <div className="flex-1">
                <SegSelect
                  options={segOptions[segId] ?? []}
                  value={draft[segId] ?? ""}
                  onChange={(v) => commit({ ...draft, [segId]: v })}
                  groups={segId === 3 ? ACCOUNT_GROUPS : undefined}
                  width={260}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="flex items-center justify-end gap-2 px-3 py-2.5"
        style={{ borderTop: "1px solid var(--ea-border)" }}
      >
        <button
          type="button"
          onClick={cancel}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          style={{
            border: "1px solid var(--ea-border-strong)",
            background: "transparent",
            color: "var(--ea-text-2)",
          }}
        >
          Болих
        </button>
        <button
          type="button"
          onClick={confirm}
          className="px-3 py-1.5 text-xs font-semibold text-white rounded-md transition-colors"
          style={{ background: "var(--ea-primary)" }}
        >
          Оруулах
        </button>
      </div>
    </div>
  );
}

export const AccountSegmentEditor = forwardRef(AccountSegmentEditorInner);
