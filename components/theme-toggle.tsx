"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <button
      type="button"
      onClick={toggle}
      className="w-8 h-8 flex items-center justify-center rounded-md transition-all duration-200 hover:bg-[var(--ea-bg-2)] text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)] border border-transparent hover:border-[var(--ea-border)]"
      title={isDark ? "Цайвар горим" : "Харанхуй горим"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark
        ? <Sun size={16} className="transition-transform" />
        : <Moon size={16} className="transition-transform" />}
    </button>
  );
}
