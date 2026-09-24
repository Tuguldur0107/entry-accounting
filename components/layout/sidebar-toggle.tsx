"use client";

import { useSidebarStore } from "@/lib/store/sidebar-store";
import { Icon } from "@/components/ui/icon";
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
      aria-label={open ? "Цэс хаах" : "Цэс нээх"}
      aria-expanded={open}
      title={open ? "Цэс хаах" : "Цэс нээх"}
      className="ea-icon-action rounded-md border border-transparent p-2"
      style={{ color: "var(--ea-text-2)" }}
    >
      {open ? <Icon name="collapseSidebar" size="lg" /> : <Icon name="expandSidebar" size="lg" />}
    </button>
  );
}
