"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useSidebarStore } from "@/lib/store/sidebar-store";
import { useMobile } from "@/lib/hooks/use-mobile";

export function SidebarToggle() {
  const mobile = useMobile();
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const mobileOpen = useSidebarStore((s) => s.mobileOpen);
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);
  const open = mobile ? mobileOpen : !collapsed;

  return (
    <button
      type="button"
      onClick={mobile ? toggleMobile : toggle}
      aria-label={open ? "Sidebar хаах" : "Sidebar нээх"}
      aria-expanded={open}
      title={open ? "Sidebar хаах" : "Sidebar нээх"}
      className="p-2 rounded-md transition-colors hover:bg-[var(--ea-bg-2)]"
      style={{ color: "var(--ea-text-2)" }}
    >
      {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
    </button>
  );
}
