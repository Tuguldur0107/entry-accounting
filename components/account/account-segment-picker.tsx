"use client";

// Дансны сегмент сонгогч — идэвхтэй сегмент бүрд searchable dropdown.
// Бүх модульд (GL, Cash, ирээдүйд VAT/Payroll) дахин ашиглагдана.
// value нь үргэлж бүтэн 10-part dotted код байна.

import { SEGMENT_DEFS, ACCOUNT_GROUPS } from "@/lib/constants/standard-accounts";
import {
  buildSegCode,
  parseSegParts,
  withSegDefaultOption,
} from "@/lib/grid/segments";
import { SegSelect, type SegOption } from "@/lib/grid/editors/SegSelect";

export interface AccountSegmentPickerProps {
  value: string;
  onChange: (value: string) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments?: Record<number, string>;
  /** Dropdown-ий өргөн (px) */
  selectWidth?: number;
  /** Зөвхөн харах — dropdown биш, код + нэрийг статикаар үзүүлнэ. */
  readOnly?: boolean;
}

export function AccountSegmentPicker({
  value,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments = {},
  selectWidth = 280,
  readOnly = false,
}: AccountSegmentPickerProps) {
  const parts = parseSegParts(value, activeSegIds);

  return (
    <div className="grid gap-2">
      {activeSegIds.map((segmentId) => {
        const definition = SEGMENT_DEFS.find(
          (candidate) => candidate.id === segmentId
        );
        if (!definition) return null;
        return (
          <div
            key={segmentId}
            className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2"
          >
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-[var(--ea-text-3)]">
                {definition.nameMn}
              </div>
              <div className="text-[10px] text-[var(--ea-text-4)]">
                S{segmentId}
              </div>
            </div>
            {readOnly ? (
              <div className="min-w-0 rounded-md border border-[var(--ea-border)] bg-[var(--ea-bg-2)] px-2.5 py-1.5">
                <div className="font-mono text-xs text-[var(--ea-text-1)]">
                  {parts[segmentId] || "—"}
                </div>
                <div className="truncate text-[11px] text-[var(--ea-text-3)]">
                  {(segmentOptions[segmentId] ?? []).find(
                    (option) => option.code === parts[segmentId]
                  )?.name ?? "—"}
                </div>
              </div>
            ) : (
              <SegSelect
                options={withSegDefaultOption(
                  segmentId,
                  segmentOptions[segmentId] ?? []
                )}
                value={parts[segmentId] ?? ""}
                onChange={(nextValue) =>
                  onChange(
                    buildSegCode(
                      { ...parts, [segmentId]: nextValue },
                      activeSegIds,
                      defaultSegments
                    )
                  )
                }
                groups={segmentId === 3 ? ACCOUNT_GROUPS : undefined}
                width={selectWidth}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
