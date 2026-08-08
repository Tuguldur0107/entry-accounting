"use client";

// Хуудасны доторх таб + шүүлтүүрийн chip — системийн ЦОРЫН ГАНЦ хэрэгжилт.
// Шинэ хуудсанд өөрийн tab markup бичихийг ХОРИГЛОНО — эндээс compose хийнэ.
//
//   PageTabs    — доогуур зураастай хэсгийн таб (жагсаалтын төрөл, тохиргооны
//                 бүлэг). Cash/Inventory/GL-ийн жагсаалтуудад хэрэглэгдэж
//                 байсан хэв маягийг стандарт болгов.
//   FilterChips — дугуй хүрээтэй жижиг шүүлтүүр (статус г.м.) — табын хажууд
//                 эсвэл toolbar-т.

import { cn } from "@/lib/utils";

export type TabOption<T extends string> = {
  value: T;
  label: string;
  /** Түр сонгох боломжгүй таб (ж: засварын горимд бусад таб түгжигдэнэ). */
  disabled?: boolean;
};

export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = "sm",
  className,
  trailing,
  ariaLabel,
}: {
  tabs: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** sm — жагсаалт/тохиргооны таб (default); md — том хэсгийн таб. */
  size?: "sm" | "md";
  className?: string;
  /** Баруун талд зэрэгцэх агуулга (ж: FilterChips). */
  trailing?: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-0 gap-y-1.5 border-b border-[var(--ea-border)]",
        className
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          disabled={tab.disabled}
          onClick={() => onChange(tab.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 font-medium transition-colors",
            size === "md" ? "px-5 py-2.5 text-sm" : "px-4 py-2 text-xs",
            value === tab.value
              ? "border-[var(--ea-primary)] text-[var(--ea-primary)]"
              : "border-transparent text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)]",
            tab.disabled && "cursor-not-allowed opacity-40 hover:text-[var(--ea-text-3)]"
          )}
        >
          {tab.label}
        </button>
      ))}
      {trailing ? (
        <div className="ml-auto flex items-center gap-1.5 pb-1.5 pl-3">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

export type ChipOption<T extends string> = TabOption<T> & {
  /** Хажууд нь харуулах тоо (0 бол нуугдана). */
  count?: number;
  /** Идэвхгүй байхад нь анхааруулгын өнгөөр тодруулна (ж: ноорог үлдсэн). */
  tone?: "warning";
};

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      {options.map((chip) => (
        <button
          key={chip.value}
          type="button"
          aria-pressed={value === chip.value}
          onClick={() => onChange(chip.value)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === chip.value
              ? "border-[var(--ea-primary)] bg-[var(--ea-primary-50)] text-[var(--ea-primary)]"
              : "border-[var(--ea-border)] text-[var(--ea-text-3)] hover:border-[var(--ea-border-strong)] hover:text-[var(--ea-text-1)]",
            chip.tone === "warning" &&
              value !== chip.value &&
              "border-[var(--ea-warning)] text-[var(--ea-warning-fg)]"
          )}
        >
          {chip.label}
          {(chip.count ?? 0) > 0 && (
            <span className="ml-1 font-mono">{chip.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
