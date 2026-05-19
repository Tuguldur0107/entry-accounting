"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getActiveModule } from "./modules";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ea.sidebar.collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

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
      <div className={cn("flex px-2 mb-2", collapsed ? "justify-center" : "justify-end")}>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Sidebar нээх" : "Sidebar хаах"}
          title={collapsed ? "Sidebar нээх" : "Sidebar хаах"}
          className="p-1.5 rounded-md transition-colors hover:bg-[var(--ea-surface)]"
          style={{
            color: "var(--ea-text-2)",
            border: "1px solid var(--ea-border)",
            background: "var(--ea-surface)",
          }}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
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
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
