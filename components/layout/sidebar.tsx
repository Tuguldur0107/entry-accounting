"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getActiveModule } from "./modules";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);

  return (
    <aside
      className="shrink-0 w-[220px] py-4"
      style={{
        background: "var(--ea-bg-2)",
        borderRight: "1px solid var(--ea-border)",
      }}
    >
      <nav className="flex flex-col gap-0.5 px-2">
        {active.items.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3 py-2 text-sm rounded-md transition-colors",
                isActive
                  ? "bg-[var(--ea-surface)] text-[var(--ea-primary)] font-medium border-l-2 border-[var(--ea-primary)]"
                  : "text-[var(--ea-text-2)] hover:bg-[var(--ea-surface)] hover:text-[var(--ea-text-1)] border-l-2 border-transparent"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
