"use client";

// Статус badge — журналын баланс, шалгалтын үр дүн, БАРИМТЫН ТӨЛӨВ үзүүлэхэд.
// UI Kit-ийн "Badge ба статус" хэсэгт баримтжсан хэв маягийн нэгдсэн component.
//
// Баримтын төлөвийг (Батлагдсан/Ноорог/Буцаагдсан…) `DocumentStatusBadge`-аар
// харуулна — өнгө + дүрс + хэлбэр нь `lib/status.ts`-ийн НЭГ бүртгэлээс
// (UI гайдын карт 1, ENT-016). Жагсаалтад `variant="icon"` (тайлбар нь
// tooltip + aria-label), дэлгэрэнгүй/маягтад `variant="full"`.

import type { CSSProperties, ReactNode } from "react";

import { statusMeta, type StatusShape, type StatusTone } from "@/lib/status";
import { Icon, type IconName } from "./icon";

export type { StatusTone } from "@/lib/status";

// ТЕКСТЭД --ea-*-fg, дэвсгэр/хүрээнд --ea-* хэрэглэнэ.
// Шалтгаан: суурь өнгө (#10B981 г.м.) цайвар surface дээр 2.5:1 контрасттай —
// WCAG AA (4.5:1) давахгүй. `-fg` хувилбар нь горим бүрд уншигдахаар тааруулагдсан.
const TONE_STYLES: Record<StatusTone, CSSProperties> = {
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
  reversed: {
    color: "var(--ea-reversed-fg)",
    background: "var(--ea-reversed-bg)",
    border: "1px solid color-mix(in srgb, var(--ea-reversed) 35%, transparent)",
  },
};

/** Хэлбэрийн ялгаа — өнгөнөөс үл хамааран танигдана. */
function shapeStyle(tone: StatusTone, shape: StatusShape): CSSProperties {
  if (shape === "dashed")
    return {
      background: "transparent",
      border: `1px dashed ${tone === "muted" ? "var(--ea-text-4)" : "currentColor"}`,
    };
  if (shape === "struck") return { textDecoration: "line-through" };
  return {};
}

export function StatusBadge({
  tone,
  children,
  className,
  size = "md",
  icon,
  shape = "solid",
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
  /** sm — хүснэгтийн нүд, жагсаалтын мөр доторх авсаархан badge. */
  size?: "md" | "sm";
  /** Текстийн өмнөх дүрс (icon-registry-ээс). */
  icon?: IconName;
  /** solid (default) · dashed (ноорог — хөндий) · struck (буцаагдсан). */
  shape?: StatusShape;
}) {
  return (
    <span
      className={`${
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-3 py-1.5 text-sm"
      } inline-flex items-center gap-1 rounded-md font-medium ${className ?? ""}`}
      style={{ ...TONE_STYLES[tone], ...shapeStyle(tone, shape) }}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? "xs" : "sm"} aria-hidden /> : null}
      {children}
    </span>
  );
}

/**
 * Баримтын төлөв — `lib/status.ts`-ийн нэгдсэн бүртгэлээр.
 * `variant="icon"`: жагсаалтын нарийн багана — зөвхөн дүрс, тайлбар нь
 * tooltip (hover/focus) + aria-label; `variant="full"`: дүрс + текст.
 */
export function DocumentStatusBadge({
  status,
  variant = "full",
  size = "sm",
  className,
}: {
  status: string | null | undefined;
  variant?: "full" | "icon";
  size?: "md" | "sm";
  className?: string;
}) {
  const meta = statusMeta(status);
  if (variant === "icon")
    return (
      <span
        role="img"
        tabIndex={0}
        aria-label={meta.label}
        title={meta.label}
        className={`inline-flex h-[22px] w-[22px] items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--ea-primary)] ${className ?? ""}`}
        style={{ ...TONE_STYLES[meta.tone], ...shapeStyle(meta.tone, meta.shape), textDecoration: "none" }}
      >
        <Icon name={meta.icon} size="xs" aria-hidden />
      </span>
    );
  return (
    <StatusBadge tone={meta.tone} size={size} icon={meta.icon} shape={meta.shape} className={className}>
      {meta.label}
    </StatusBadge>
  );
}
