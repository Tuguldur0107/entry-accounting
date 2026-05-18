"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <button
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="w-8 h-8 flex items-center justify-center rounded-md transition-all duration-200 hover:bg-[var(--ea-bg-2)] text-[var(--ea-text-3)] hover:text-[var(--ea-text-1)] border border-transparent hover:border-[var(--ea-border)]"
      title={resolvedTheme === "dark" ? "Цайвар горим" : "Харанхуй горим"}
    >
      {resolvedTheme === "dark"
        ? <Sun size={16} className="transition-transform" />
        : <Moon size={16} className="transition-transform" />}
    </button>
  );
}
