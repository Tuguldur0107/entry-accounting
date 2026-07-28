"use client";

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import {
  Icon,
  type IconName,
  type IconSize,
} from "@/components/ui/icon";
import styles from "./icon-kit.module.css";

export type IconActionSize = "xs" | "sm" | "md" | "lg";
export type IconActionVariant =
  | "ghost"
  | "outline"
  | "soft"
  | "solid"
  | "danger";

const actionSizeClasses: Record<IconActionSize, string> = {
  xs: styles.actionXs,
  sm: styles.actionSm,
  md: styles.actionMd,
  lg: styles.actionLg,
};

const iconSizeByAction: Record<IconActionSize, IconSize> = {
  xs: "xs",
  sm: "sm",
  md: "md",
  lg: "lg",
};

const variantClasses: Record<IconActionVariant, string | undefined> = {
  ghost: undefined,
  outline: styles.variantOutline,
  soft: styles.variantSoft,
  solid: styles.variantSolid,
  danger: styles.variantDanger,
};

export type IconActionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "title"
> & {
  name: IconName;
  /** Icon-only товч бүр харагдахгүй ч заавал accessible нэртэй байна. */
  label: string;
  tooltip?: string;
  size?: IconActionSize;
  variant?: IconActionVariant;
  selected?: boolean;
  /** Toggle action бол aria-pressed-ийг илэрхий заана. */
  pressed?: boolean;
  loading?: boolean;
};

export function IconAction({
  name,
  label,
  tooltip,
  size = "md",
  variant = "ghost",
  selected = false,
  pressed,
  loading = false,
  disabled,
  className,
  type = "button",
  ...props
}: IconActionProps) {
  const iconName = loading ? "loading" : name;
  const dataState = loading
    ? "loading"
    : selected || pressed
      ? "selected"
      : disabled
        ? "disabled"
        : "default";

  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      title={tooltip ?? label}
      disabled={disabled || loading}
      data-selected={selected || undefined}
      data-state={dataState}
      className={cn(
        styles.action,
        actionSizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      <Icon
        name={iconName}
        size={iconSizeByAction[size]}
        state={loading ? "loading" : "default"}
      />
    </button>
  );
}
