"use client";

// Кассын numpad — docs/pos §4.1 v2. Сонгосон мөрийн Тоо / Хөнг %-ийг
// хүрэлцэх дэлгэцээр засна (Odoo / Square-ийн заншил): горим сонгоод тоо
// дарна, буфер тухай бүр мөрд орно. Үнэ кассаас засагдахгүй
// (барааны картын борлуулах үнэ; буулгах нь хөнгөлөлтөөр). Логик `lib/pos/checkout-state.ts`
// (`pressNumpad`, `applyNumpad`) — энд зөвхөн товчлуурууд.

import { Icon } from "@/components/ui/icon";
import {
  NUMPAD_MODE_LABELS,
  type NumpadKey,
  type NumpadMode,
} from "@/lib/pos/checkout-state";
import { cn } from "@/lib/utils";

const DIGIT_ROWS: NumpadKey[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["0", ".", "⌫"],
];

const MODES: NumpadMode[] = ["qty", "discount"];

const keyClass =
  "ea-interactive flex h-10 select-none items-center justify-center rounded-lg border border-[var(--ea-border)] bg-[var(--ea-surface-raised)] font-mono text-base font-medium text-[var(--ea-text-1)] hover:border-[var(--ea-border-strong)] hover:bg-[var(--ea-hover-subtle)] active:translate-y-px disabled:pointer-events-none disabled:opacity-40";

export function Numpad({
  mode,
  onMode,
  buffer,
  onKey,
  disabled,
  lineLabel,
}: {
  mode: NumpadMode;
  onMode: (mode: NumpadMode) => void;
  buffer: string;
  onKey: (key: NumpadKey) => void;
  /** Мөр сонгогдоогүй үед товчнууд идэвхгүй. */
  disabled: boolean;
  /** Сонгосон мөрийн нэр (буферийн дээр). */
  lineLabel: string | null;
}) {
  return (
    <div className="shrink-0 space-y-1.5">
      <div className="flex h-6 items-center justify-between px-0.5 text-[11px]">
        <span className="min-w-0 truncate text-[var(--ea-text-3)]">
          {lineLabel ?? "Мөр сонгоод тоо / хөнгөлөлт засна"}
        </span>
        {lineLabel && (
          <span className="shrink-0 font-mono text-[var(--ea-text-2)]">
            {NUMPAD_MODE_LABELS[mode]}: {buffer || "…"}
            {mode === "discount" && buffer ? "%" : ""}
          </span>
        )}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {DIGIT_ROWS.map((row, rowIndex) => (
          <div key={rowIndex} className="contents">
            {row.map((key) => (
              <button
                key={key}
                type="button"
                tabIndex={-1}
                className={keyClass}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onKey(key)}
                aria-label={key === "⌫" ? "Арилгах" : key}
              >
                {key === "⌫" ? <Icon name="arrowLeft" size="md" /> : key}
              </button>
            ))}
            {rowIndex < MODES.length ? (
              <button
                type="button"
                tabIndex={-1}
                className={cn(
                  keyClass,
                  "font-sans text-xs",
                  mode === MODES[rowIndex] &&
                    "border-[var(--ea-primary)] bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
                )}
                disabled={disabled}
                aria-pressed={mode === MODES[rowIndex]}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onMode(MODES[rowIndex])}
              >
                {NUMPAD_MODE_LABELS[MODES[rowIndex]]}
              </button>
            ) : (
              <div />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
