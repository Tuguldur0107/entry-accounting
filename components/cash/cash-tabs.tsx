"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Гүйлгээ", href: "/cash/transactions" },
  { label: "Тайлан", href: "/cash/reports" },
  { label: "Дансууд", href: "/cash/accounts" },
];

export function CashTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b border-[#E5E5DE] mb-6 -mt-2">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors",
              isActive
                ? "text-[#1E3A5F] border-[#1E3A5F] font-medium"
                : "text-[#666] border-transparent hover:text-[#333] hover:border-[#ccc]"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
