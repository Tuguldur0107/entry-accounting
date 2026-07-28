"use client";

// Статус badge — журналын баланс, шалгалтын үр дүн зэрэг төлөв үзүүлэхэд.
// UI Kit-ийн "Badge ба статус" хэсэгт баримтжсан хэв маягийн нэгдсэн component.

import type { ReactNode } from "react";

export type StatusTone = "success" | "danger" | "warning" | "muted";

// ТЕКСТЭД --ea-*-fg, дэвсгэр/хүрээнд --ea-* хэрэглэнэ.
// Шалтгаан: суурь өнгө (#10B981 г.м.) цайвар surface дээр 2.5:1 контрасттай —
// WCAG AA (4.5:1) давахгүй. `-fg` хувилбар нь горим бүрд уншигдахаар тааруулагдсан.
const TONE_STYLES: Record<StatusTone, React.CSSProperties> = {
  success: {
    color: "var(--ea-success-fg)",
    background: "color-mix(in srgb, var(--ea-success) 10%, var(--ea-surface))",
    border: "1px solid color-mix(in srgb, var(--ea-success) 30%, transparent)",
  },
  danger: {
    color: "var(--ea-danger-fg)",
    background: "color-mix(in srgb, var(--ea-danger) 10%, var(--ea-surface))",
    border: "1px solid color-mix(in srgb, var(--ea-danger) 30%, transparent)",
  },
  warning: {
    color: "var(--ea-warning-fg)",
    background: "color-mix(in srgb, var(--ea-warning) 10%, var(--ea-surface))",
    border: "1px solid color-mix(in srgb, var(--ea-warning) 30%, transparent)",
  },
  muted: {
    color: "var(--ea-text-3)",
    background: "var(--ea-bg-2)",
  },
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`text-sm px-3 py-1.5 rounded-md font-medium ${className ?? ""}`}
      style={TONE_STYLES[tone]}
    >
      {children}
    </span>
  );
}
