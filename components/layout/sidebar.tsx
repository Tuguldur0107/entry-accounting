"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { usePathname } from "next/navigation";
import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react";
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

/** Sidebar-ийн навигацийн мөр — нүүр ба модулийн цэс хоёулаа үүнийг ашиглана. */
function SidebarLink({
  href,
  label,
  icon,
  isActive,
  collapsed,
  mobile,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: IconName;
  isActive: boolean;
  collapsed: boolean;
  mobile: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed && !mobile ? label : undefined}
      className={cn(
        "ea-interactive group relative flex min-h-9 items-center gap-2.5 rounded-md border border-transparent px-3 py-2 text-sm",
        collapsed && !mobile && "justify-center px-2",
        isActive ? "ea-is-selected font-medium shadow-sm" : "text-[var(--ea-text-2)]"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-transparent transition-colors",
          isActive && "bg-[var(--ea-interactive)]"
        )}
      />
      <Icon
        name={icon}
        className={cn(
          "shrink-0",
          isActive
            ? "text-[var(--ea-interactive)]"
            : "text-[var(--ea-text-3)] group-hover:text-[var(--ea-text-1)]"
        )}
      />
      {collapsed && !mobile ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </Link>
  );
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
          className="fixed inset-0 z-20 bg-[var(--ea-overlay)]"
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
          background: "color-mix(in srgb, var(--ea-surface-glass) 88%, var(--ea-bg-2))",
          borderRight: "1px solid var(--ea-border)",
          backdropFilter: "var(--ea-glass-filter)",
          WebkitBackdropFilter: "var(--ea-glass-filter)",
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
        {active.items.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            isActive={isActivePath(pathname, item.href)}
            collapsed={collapsed}
            mobile={mobile}
            onNavigate={() => {
              if (mobile) setMobileOpen(false);
            }}
          />
        ))}
      </nav>
      <div className="min-h-4 flex-1" />
      {!mobile && (
        <div className="px-2 pt-3">
          <button
            type="button"
            onClick={toggle}
            // aria-label={collapsed ? "Sidebar дэлгэх" : "Sidebar хураах"}
            aria-expanded={!collapsed}
            // title={collapsed ? "Sidebar дэлгэх" : "Sidebar хураах"}
            className={cn(
              "ea-interactive flex min-h-9 w-full items-center gap-2.5 rounded-md border border-transparent px-3 py-2 text-sm text-[var(--ea-text-3)]",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              <Icon name="expandSidebar" className="shrink-0" />
            ) : (
              <Icon name="collapseSidebar" className="shrink-0" />
            )}
            {collapsed ? (
              <span className="sr-only"></span>
            ) : (
              <span className="truncate"></span>
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
            resizing && "bg-[color-mix(in_srgb,var(--ea-interactive)_10%,transparent)]"
          )}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
              "bg-transparent group-hover:bg-[var(--ea-interactive)] group-focus-visible:bg-[var(--ea-interactive)]",
              resizing && "!bg-[var(--ea-interactive)]"
            )}
          />
        </div>
      )}
      </aside>
    </>
  );
}
