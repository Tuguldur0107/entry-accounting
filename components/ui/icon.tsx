import type { CSSProperties, SVGProps } from "react";

import { cn } from "@/lib/utils";
import { ICONS, type IconName } from "./icon-registry";
import styles from "./icon-kit.module.css";

export type { IconName } from "./icon-registry";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type IconTone =
  | "inherit"
  | "default"
  | "muted"
  | "interactive"
  | "selected"
  | "success"
  | "warning"
  | "danger"
  | "inverse";
export type IconState = "default" | "selected" | "disabled" | "loading";

const sizeClasses: Record<IconSize, string> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
  "2xl": styles.size2xl,
};

const toneClasses: Record<IconTone, string> = {
  inherit: styles.toneInherit,
  default: styles.toneDefault,
  muted: styles.toneMuted,
  interactive: styles.toneInteractive,
  selected: styles.toneSelected,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
  inverse: styles.toneInverse,
};

const stateClasses: Record<IconState, string | undefined> = {
  default: undefined,
  selected: styles.stateSelected,
  disabled: styles.stateDisabled,
  loading: styles.stateLoading,
};

export type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "color" | "height" | "name" | "width"
> & {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  state?: IconState;
  /**
   * Icon өөрөө мэдээлэл дамжуулж байвал label өгнө. Товчны дотор эсвэл текстийн
   * хажууд чимэглэл бол label өгөхгүй; автоматаар aria-hidden болно.
   */
  label?: string;
};

export function Icon({
  name,
  size = "md",
  tone = "inherit",
  state = "default",
  label,
  className,
  style,
  ...props
}: IconProps) {
  const Glyph = ICONS[name];
  const accessibility = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true };

  return (
    <Glyph
      focusable="false"
      className={cn(
        styles.icon,
        sizeClasses[size],
        toneClasses[tone],
        stateClasses[state],
        className
      )}
      style={style as CSSProperties}
      {...accessibility}
      {...props}
    />
  );
}
