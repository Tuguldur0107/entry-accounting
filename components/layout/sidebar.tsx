"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getActiveModule } from "./modules";
import { ModuleSwitcher } from "./module-switcher";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebarStore,
} from "@/lib/store/sidebar-store";
import { cn } from "@/lib/utils";
import { useMobile } from "@/lib/hooks/use-mobile";

function isActivePath(pathname: string, href: string) {
  if (pathname === href) return true;
  const segmentCount = href.split("/").filter(Boolean).length;
  return segmentCount > 1 && pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const mobile = useMobile();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
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
          className="fixed inset-0 z-20 bg-black/45"
        />
      )}
      <aside
        className={cn(
          "relative flex h-full shrink-0 flex-col overflow-y-auto py-3",
          !resizing && "transition-[width,transform] duration-200 ease-out",
          mobile && "fixed bottom-0 left-0 top-0 z-30 shadow-xl",
          mobile && !mobileOpen && "-translate-x-full"
        )}
        style={{
          width: mobile ? Math.min(280, width) : collapsed ? 56 : width,
          background: "var(--ea-bg-2)",
          borderRight: "1px solid var(--ea-border)",
        }}
      >
      <div className={cn("px-3 pb-3", collapsed && !mobile && "px-2")}>
        <ModuleSwitcher
          variant={collapsed && !mobile ? "collapsed" : "sidebar"}
          onSelect={() => {
            if (mobile) setMobileOpen(false);
          }}
        />
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {active.items.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (mobile) setMobileOpen(false);
              }}
              title={collapsed && !mobile ? item.label : undefined}
              className={cn(
                "group relative flex min-h-9 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && !mobile && "justify-center px-2",
                isActive
                  ? "bg-[var(--ea-surface)] font-medium text-[var(--ea-primary)] shadow-sm"
                  : "text-[var(--ea-text-2)] hover:bg-[var(--ea-surface)] hover:text-[var(--ea-text-1)]"
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-transparent transition-colors",
                  isActive && "bg-[var(--ea-primary)]"
                )}
              />
              <Icon
                size={16}
                className={cn(
                  "shrink-0",
                  isActive
                    ? "text-[var(--ea-primary)]"
                    : "text-[var(--ea-text-3)] group-hover:text-[var(--ea-text-1)]"
                )}
              />
              {collapsed && !mobile ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="min-h-4 flex-1" />
      {!mobile && (
        <div className="px-2 pt-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Sidebar дэлгэх" : "Sidebar хураах"}
            aria-expanded={!collapsed}
            title={collapsed ? "Sidebar дэлгэх" : "Sidebar хураах"}
            className={cn(
              "flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[var(--ea-text-3)] transition-colors hover:bg-[var(--ea-surface)] hover:text-[var(--ea-text-1)]",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} className="shrink-0" />
            ) : (
              <PanelLeftClose size={16} className="shrink-0" />
            )}
            {collapsed ? (
              <span className="sr-only">Sidebar дэлгэх</span>
            ) : (
              <span className="truncate">Sidebar хураах</span>
            )}
          </button>
        </div>
      )}
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
