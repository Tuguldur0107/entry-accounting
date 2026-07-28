"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Settings, Check, WalletCards, ReceiptText, Boxes, Calculator, Building, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Z } from "@/lib/ui/z-layers";
import { MODULES, getActiveModule } from "./modules";

const MODULE_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  gl: BookOpen,
  cash: WalletCards,
  receivables: WalletCards,
  payables: ReceiptText,
  inventory: Boxes,
  costing: Calculator,
  fa: Building,
  ai: Sparkles,
  settings: Settings,
};

function ModuleIcon({ id, size = 22 }: { id: string; size?: number }) {
  const Icon = MODULE_ICONS[id] ?? BookOpen;
  return <Icon size={size} strokeWidth={1.6} />;
}

type ModuleSwitcherVariant = "header" | "sidebar" | "collapsed";

interface ModuleSwitcherProps {
  variant?: ModuleSwitcherVariant;
  onSelect?: () => void;
}

export function ModuleSwitcher({
  variant = "header",
  onSelect,
}: ModuleSwitcherProps) {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const [open, setOpen] = useState(false);
  // Popup coordinates in viewport space — the menu is portalled to
  // document.body so the sidebar's overflow-y / width can't clip it.
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebar = variant === "sidebar";
  const collapsed = variant === "collapsed";

  function openMenu() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 360;
      const margin = 16;
      // Collapsed rail: fly out to the right of the trigger; otherwise drop
      // below it. Clamp into the viewport in both cases.
      const rawLeft = collapsed ? rect.right + 8 : rect.left;
      const left = Math.min(rawLeft, window.innerWidth - width - margin);
      const top = collapsed ? rect.top : rect.bottom + 6;
      setMenuPos({ top, left: Math.max(margin, left) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Any scroll/resize invalidates the cached rect — just close.
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", sidebar && "w-full", collapsed && "flex justify-center")}
    >
      <style>{`
        @keyframes ms-pop-grow {
          from { opacity: 0; transform: translateY(-4px) scale(0.92) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          "ea-icon-action border-0",
          variant === "header" &&
            "ea-primary-button flex size-9 items-center justify-center rounded-md text-[var(--primary-foreground)]",
          sidebar &&
            "group flex w-full min-w-0 items-center justify-between rounded-md border border-[var(--ea-border)] bg-[var(--ea-surface)] px-3 py-2 text-left",
          collapsed &&
            "flex size-9 items-center justify-center rounded-md bg-[var(--ea-surface)] text-[var(--ea-interactive)]"
        )}
        style={{
          boxShadow: open
            ? "var(--ea-focus)"
            : "none",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Модуль: ${active.label}`}
        title={active.label}
      >
        {sidebar ? (
          <>
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-[var(--ea-text-3)]">
                Модуль
              </div>
              <div className="truncate text-sm font-semibold text-[var(--ea-text-1)]">
                {active.label}
              </div>
            </div>
            <ModuleIcon id={active.id} size={18} />
          </>
        ) : (
          <ModuleIcon id={active.id} size={20} />
        )}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Модуль сонгох"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--ea-surface-glass)",
            border: "1px solid var(--ea-border)",
            borderRadius: 10,
            boxShadow: "var(--ea-shadow-3)",
            backdropFilter: "var(--ea-glass-filter)",
            WebkitBackdropFilter: "var(--ea-glass-filter)",
            padding: 8,
            zIndex: Z.moduleMenu,
            transformOrigin: "top left",
            animation: "ms-pop-grow 140ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div
            style={{
              padding: "6px 8px 8px",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--ea-text-3)",
            }}
          >
            Модуль
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {MODULES.map((m) => {
              const isActive = m.id === active.id;
              return (
                <Link
                  key={m.id}
                  href={m.defaultHref}
                  onClick={() => {
                    setOpen(false);
                    onSelect?.();
                  }}
                  role="menuitem"
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "10px 10px",
                    borderRadius: 8,
                    background: isActive
                      ? "var(--ea-selected-bg)"
                      : "transparent",
                    color: "var(--ea-text-1)",
                    textDecoration: "none",
                    alignItems: "center",
                    transition: "background-color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--ea-hover-subtle)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      background: isActive
                        ? "linear-gradient(145deg, var(--ea-primary), var(--ea-accent-strong))"
                        : "var(--ea-bg-2)",
                      color: isActive
                        ? "var(--primary-foreground)"
                        : "var(--ea-interactive)",
                    }}
                  >
                    <ModuleIcon id={m.id} size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 500,
                          color: isActive ? "var(--ea-interactive)" : "var(--ea-text-1)",
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {m.label}
                      </span>
                      {isActive && (
                        <Check size={13} strokeWidth={2.5} style={{ color: "var(--ea-interactive)" }} />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--ea-text-3)",
                        lineHeight: 1.4,
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {m.items.map((i) => i.label).join(" · ")}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
