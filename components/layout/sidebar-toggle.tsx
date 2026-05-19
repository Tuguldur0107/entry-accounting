"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarStore } from "@/lib/store/sidebar-store";

export function SidebarToggle() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Sidebar нээх" : "Sidebar хаах"}
      aria-expanded={!collapsed}
      title={collapsed ? "Sidebar нээх" : "Sidebar хаах"}
      className="p-2 rounded-md transition-colors hover:bg-[var(--ea-bg-2)]"
      style={{ color: "var(--ea-text-2)" }}
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  );
}
