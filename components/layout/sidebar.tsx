"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveModule } from "./modules";
import { useSidebarStore } from "@/lib/store/sidebar-store";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const collapsed = useSidebarStore((s) => s.collapsed);

  return (
    <aside
      className={cn(
        "shrink-0 py-4 transition-[width] duration-200 ease-out",
        collapsed ? "w-[56px]" : "w-[220px]"
      )}
      style={{
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
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
                collapsed && "justify-center px-2",
                isActive
                  ? "bg-[var(--ea-surface)] text-[var(--ea-primary)] font-medium border-l-2 border-[var(--ea-primary)]"
                  : "text-[var(--ea-text-2)] hover:bg-[var(--ea-surface)] hover:text-[var(--ea-text-1)] border-l-2 border-transparent"
              )}
            >
              <Icon size={16} className="shrink-0" />
              {collapsed ? (
                <span className="sr-only">{item.label}</span>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
