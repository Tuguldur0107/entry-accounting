"use client";

import { SEGMENT_DEFS, ACCOUNT_GROUPS } from "@/lib/constants/standard-accounts";
import { buildSegCode, parseSegParts } from "@/lib/grid/segments";
import { SegSelect, type SegOption } from "@/lib/grid/editors/SegSelect";

interface Props {
  value: string;
  onChange: (value: string) => void;
  activeSegIds: number[];
  segmentOptions: Record<number, SegOption[]>;
  defaultSegments: Record<number, string>;
}

export function AccountSegmentPicker({
  value,
  onChange,
  activeSegIds,
  segmentOptions,
  defaultSegments,
}: Props) {
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
            <SegSelect
              options={segmentOptions[segmentId] ?? []}
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
              width={280}
            />
          </div>
        );
      })}
    </div>
  );
}

