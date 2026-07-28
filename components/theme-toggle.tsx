"use client";

import { useEffect, useRef, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Theme toggle — works WITH or WITHOUT React hydration.
 * Attaches an `addEventListener('click')` on mount so even if React's
 * synthetic onClick is delayed/broken, native DOM event still fires.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  // Single source of truth: subscribe to <html> class changes. The same
  // `sync` is used for the initial read + each observed mutation so the
  // effect body itself doesn't call `setState` synchronously — it only
  // wires up a subscription, which is the recommended useEffect shape
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    return () => observer.disconnect();
  }, []);

  // Native click listener — independent of React synthetic events.
  useEffect(() => {
    const btn = ref.current;
    if (!btn) return;
    const handler = () => {
      const root = document.documentElement;
      const next = !root.classList.contains("dark");
      root.classList.toggle("dark", next);
      root.style.colorScheme = next ? "dark" : "light";
      try {
        localStorage.setItem("theme", next ? "dark" : "light");
      } catch {
        /* ignore */
      }
    };
    btn.addEventListener("click", handler);
    return () => btn.removeEventListener("click", handler);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      suppressHydrationWarning
      className="ea-icon-action flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-[var(--ea-border)] text-[var(--ea-text-2)]"
      title={isDark ? "Цайвар горим" : "Харанхуй горим"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark
        ? <Sun size={18} className="transition-transform pointer-events-none" />
        : <Moon size={18} className="transition-transform pointer-events-none" />}
    </button>
  );
}
