"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Settings, Check } from "lucide-react";
import { MODULES, getActiveModule } from "./modules";

const MODULE_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  gl: BookOpen,
  settings: Settings,
};

function ModuleIcon({ id, size = 22 }: { id: string; size?: number }) {
  const Icon = MODULE_ICONS[id] ?? BookOpen;
  return <Icon size={size} strokeWidth={1.6} />;
}

export function ModuleSwitcher() {
  const pathname = usePathname();
  const active = getActiveModule(pathname);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <style>{`
        @keyframes ms-pop-grow {
          from { opacity: 0; transform: translateY(-4px) scale(0.92) }
          to { opacity: 1; transform: translateY(0) scale(1) }
        }
      `}</style>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center transition-shadow"
        style={{
          width: 36,
          height: 36,
          padding: 0,
          borderRadius: 8,
          background: "var(--ea-primary)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          boxShadow: open
            ? "0 0 0 3px color-mix(in srgb, var(--ea-primary) 22%, transparent)"
            : "none",
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Модуль: ${active.label}`}
        title={active.label}
      >
        <ModuleIcon id={active.id} size={20} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Модуль сонгох"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--ea-surface)",
            border: "1px solid var(--ea-border)",
            borderRadius: 10,
            boxShadow: "0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.04)",
            padding: 8,
            zIndex: 30,
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
                  onClick={() => setOpen(false)}
                  role="menuitem"
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "10px 10px",
                    borderRadius: 8,
                    background: isActive ? "rgba(30, 58, 95, 0.06)" : "transparent",
                    color: "var(--ea-text-1)",
                    textDecoration: "none",
                    alignItems: "center",
                    transition: "background-color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "var(--ea-bg-2)";
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
                      background: isActive ? "#1E3A5F" : "var(--ea-bg-2)",
                      color: isActive ? "#fff" : "#1E3A5F",
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
                          color: isActive ? "#1E3A5F" : "var(--ea-text-1)",
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {m.label}
                      </span>
                      {isActive && (
                        <Check size={13} strokeWidth={2.5} style={{ color: "#1E3A5F" }} />
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
        </div>
      )}
    </div>
  );
}
