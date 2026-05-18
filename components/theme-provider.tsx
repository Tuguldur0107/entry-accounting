"use client";

import * as React from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "theme";

/** Single helper that mutates DOM + persists choice. */
function applyTheme(t: Theme, persist: boolean) {
  const root = document.documentElement;
  if (t === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = t;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }
}

function readDomTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR default = "light"; client first effect reads real DOM (which `themeInitScript`
  // already set before hydration, so this is consistent).
  const [theme, setThemeState] = React.useState<Theme>("light");

  // Sync internal state with DOM on mount + observe future changes.
  // Any component (toggle, debug script, etc.) that mutates `<html>` class will
  // notify subscribers via the observer.
  React.useEffect(() => {
    setThemeState(readDomTheme());
    const observer = new MutationObserver(() => {
      setThemeState(readDomTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Listen to system preference changes only when user hasn't picked one.
  React.useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => {
      try {
        if (!localStorage.getItem(STORAGE_KEY)) {
          applyTheme(mq.matches ? "dark" : "light", false);
        }
      } catch {
        /* ignore */
      }
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const setTheme = React.useCallback((t: Theme) => applyTheme(t, true), []);
  const toggle = React.useCallback(() => {
    applyTheme(readDomTheme() === "dark" ? "light" : "dark", true);
  }, []);

  const value = React.useMemo(
    () => ({ theme, isDark: theme === "dark", setTheme, toggle }),
    [theme, setTheme, toggle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

// Note: The flash-prevention init script lives in `app/layout.tsx`
// (server file) so the template literal serializes correctly into HTML.
// "use client" files cannot be imported as raw strings into Server Components —
// they become client references instead, which broke the original setup.
