"use client";

// Topbar-ийн жижиг dropdown цэсний НЭГДСЭН primitive — org-switcher,
// quick-create хоёул үүгээр цэсээ зурна (өмнө нь container/menuitem markup
// хоёр файлд үгчлэн хуулбарлагдсан байсан). Trigger товчоо caller өөрөө
// өгнө; гадна дарахад pointerdown-оор хаагдана. Портал шаардсан том
// тохиолдол (module-switcher) энд хамаарахгүй.

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Dropdown({
  open,
  onOpenChange,
  trigger,
  panelClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** aria-haspopup/aria-expanded-ээ өөрөө тавьсан trigger товч. */
  trigger: ReactNode;
  /** Өргөн г.м нэмэлт — default w-60. */
  panelClassName?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Гадна дарахад хаагдана.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      {trigger}
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 top-full z-50 mt-1.5 w-60 rounded-md border p-1.5",
            panelClassName
          )}
          style={{
            borderColor: "var(--ea-border)",
            background: "var(--ea-surface)",
            boxShadow: "var(--ea-shadow-3)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  onSelect,
  disabled,
  selected,
  className,
  children,
}: {
  onSelect: () => void;
  disabled?: boolean;
  /** Идэвхтэй сонголт — selected-bg + interactive өнгөөр тодорно. */
  selected?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
        selected
          ? "bg-[var(--ea-selected-bg)] text-[var(--ea-interactive)]"
          : "text-[var(--ea-text-1)] hover:bg-[var(--ea-hover-subtle)]",
        className
      )}
    >
      {children}
    </button>
  );
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: "var(--ea-text-3)" }}
    >
      {children}
    </div>
  );
}

export function DropdownSeparator() {
  return (
    <div className="my-1 border-t" style={{ borderColor: "var(--ea-border)" }} />
  );
}
