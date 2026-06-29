"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getActiveModule } from "./modules";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarStore,
} from "@/lib/store/sidebar-store";
import { cn } from "@/lib/utils";
import { useMobile } from "@/lib/hooks/use-mobile";

export function Sidebar() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const mobile = useMobile();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const width = useSidebarStore((s) => s.width);
  const setWidth = useSidebarStore((s) => s.setWidth);
  const mobileOpen = useSidebarStore((s) => s.mobileOpen);
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const [resizing, setResizing] = useState(false);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed || event.button !== 0) return;

      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = width;
      setResizing(true);
      handle.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        setWidth(startWidth + moveEvent.clientX - startX);
      };
      const stop = () => {
        setResizing(false);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    },
    [collapsed, setWidth, width]
  );

  return (
    <>
      {mobile && mobileOpen && (
        <button
          type="button"
          aria-label="Sidebar хаах"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-x-0 bottom-0 top-14 z-20 bg-black/45"
        />
      )}
      <aside
      className={cn(
        "relative shrink-0 py-4",
        !resizing && "transition-[width,transform] duration-200 ease-out",
        mobile && "fixed bottom-0 left-0 top-14 z-30 shadow-xl",
        mobile && !mobileOpen && "-translate-x-full"
      )}
      style={{
        width: mobile ? Math.min(280, width) : collapsed ? 56 : width,
        background: "var(--ea-bg-2)",
        borderRight: "1px solid var(--ea-border)",
      }}
    >
      <nav className="flex flex-col gap-0.5 px-2">
        {active.items.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (mobile) setMobileOpen(false);
              }}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
                collapsed && !mobile && "justify-center px-2",
                isActive
                  ? "bg-[var(--ea-surface)] text-[var(--ea-primary)] font-medium border-l-2 border-[var(--ea-primary)]"
                  : "text-[var(--ea-text-2)] hover:bg-[var(--ea-surface)] hover:text-[var(--ea-text-1)] border-l-2 border-transparent"
              )}
            >
              <Icon size={16} className="shrink-0" />
              {collapsed && !mobile ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>
      {!mobile && !collapsed && (
        <div
          role="separator"
          aria-label="Хажуугийн цэсний өргөн"
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Чирж өргөнийг тохируулна. Давхар товшиж анхны хэмжээнд оруулна."
          onPointerDown={startResize}
          onDoubleClick={() => setWidth(SIDEBAR_DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setWidth(width - (event.shiftKey ? 32 : 8));
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setWidth(width + (event.shiftKey ? 32 : 8));
            } else if (event.key === "Home") {
              event.preventDefault();
              setWidth(SIDEBAR_MIN_WIDTH);
            } else if (event.key === "End") {
              event.preventDefault();
              setWidth(SIDEBAR_MAX_WIDTH);
            }
          }}
          className={cn(
            "group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none",
            resizing && "bg-[color-mix(in_srgb,var(--ea-primary)_10%,transparent)]"
          )}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
              "bg-transparent group-hover:bg-[var(--ea-primary)] group-focus-visible:bg-[var(--ea-primary)]",
              resizing && "!bg-[var(--ea-primary)]"
            )}
          />
        </div>
      )}
      </aside>
    </>
  );
}
