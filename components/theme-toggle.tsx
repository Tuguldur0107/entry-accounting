"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Standalone toggle — direct DOM manipulation.
 * Subscribes to <html> class via MutationObserver so the icon stays
 * in sync if .dark is toggled elsewhere.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setMounted(true);
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const handleClick = () => {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    if (next) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    root.style.colorScheme = next ? "dark" : "light";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  if (!mounted) return <div className="w-8 h-8" />;

  return (
    <button
      type="button"
      onClick={handleClick}
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
