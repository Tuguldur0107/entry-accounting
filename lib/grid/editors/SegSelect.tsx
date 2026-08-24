"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { createPortal } from "react-dom";

export type SegOption = { code: string; name: string };

interface Props {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  groups?: Record<string, string>;
  width?: number;
  placeholder?: string;
}

export function SegSelect({ options, value, onChange, groups, width = 220, placeholder = "—" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.code === value);
  const filtered = query
    ? options.filter(
        (o) =>
          o.code.toLowerCase().includes(query.toLowerCase()) ||
          o.name.toLowerCase().includes(query.toLowerCase())
      )
    : options;

  function openDropdown() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 2, left: r.left });
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node | null;
      // Trigger болон portal доторх даралт (хайлтын талбар, жагсаалтын
      // scroll г.м.) "дотор" — үгүй бол хайлтад дарангуут хаагдаж,
      // сонгогч эвдэрсэн мэт ажилладаг байсан.
      if (triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-seg-portal]"))
        return;
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  const groupedItems = groups
    ? Object.entries(
        filtered.reduce((acc, opt) => {
          const key = opt.code[0] ?? "?";
          if (!acc[key]) acc[key] = [];
          acc[key].push(opt);
          return acc;
        }, {} as Record<string, SegOption[]>)
      ).sort(([a], [b]) => a.localeCompare(b))
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="w-full h-8 px-2.5 text-xs font-mono text-left flex items-center justify-between gap-1 rounded transition-colors"
        style={{
          border: "1px solid var(--ea-border-strong)",
          background: "var(--ea-bg)",
          color: value ? "var(--ea-text-1)" : "var(--ea-text-4)",
        }}
      >
        {selected ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0">{selected.code}</span>
            {selected.name && (
              <span
                className="truncate font-sans"
                style={{ color: "var(--ea-text-3)" }}
              >
                {selected.name}
              </span>
            )}
          </span>
        ) : (
          <span className="truncate">{placeholder}</span>
        )}
        <Icon name="chevronDown" size="xs" className="shrink-0 text-[var(--ea-text-4)]" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-seg-portal=""
            className="ag-custom-component-popup"
            // Portal доторх даралт гадуур давхаргуудын (панель, editor,
            // grid) "гадна дарлаа" гэсэн сонсогчдод хүрэхгүй — аль нэг
            // давхарга үүнийг гадна гэж үзээд dropdown-ийг унтраахаас
            // давхар хамгаална.
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width,
              zIndex: 10000,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 8,
              boxShadow: "var(--ea-shadow-2)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "6px 6px 5px", borderBottom: "1px solid var(--ea-border)" }}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter — эхний илэрцийг шууд сонгоно (бичээд сонгох урсгал).
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (filtered.length > 0) pick(filtered[0].code);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setOpen(false);
                    setQuery("");
                  }
                }}
                placeholder="Хайх..."
                style={{
                  width: "100%",
                  padding: "5px 8px",
                  fontSize: 12,
                  border: "1px solid var(--ea-border-strong)",
                  borderRadius: 5,
                  outline: "none",
                  background: "var(--ea-bg)",
                  color: "var(--ea-text-1)",
                }}
              />
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto" }}>
              <button
                type="button"
                onMouseDown={() => pick("")}
                className="w-full text-left px-2.5 py-1.5 text-xs transition-colors hover:bg-[var(--ea-bg-2)]"
                style={{ color: "var(--ea-text-4)" }}
              >
                — Хоосон
              </button>
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--ea-text-4)" }}>Олдсонгүй</div>
              ) : groupedItems ? (
                groupedItems.map(([key, opts]) => (
                  <div key={key}>
                    <div
                      className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider sticky top-0"
                      style={{
                        color: "var(--ea-text-3)",
                        background: "var(--ea-bg-2)",
                        borderTop: "1px solid var(--ea-border)",
                        borderBottom: "1px solid var(--ea-border)",
                      }}
                    >
                      {key}x — {groups![key] ?? ""}
                    </div>
                    {opts.map((o) => (
                      <button
                        key={o.code}
                        type="button"
                        onMouseDown={() => pick(o.code)}
                        className="w-full text-left px-2.5 py-1.5 text-xs flex items-baseline gap-2 transition-colors hover:bg-[var(--ea-bg-2)]"
                        style={{ background: o.code === value ? "var(--ea-primary-50)" : "transparent" }}
                      >
                        <span className="font-mono font-semibold shrink-0" style={{ color: "var(--ea-primary)" }}>{o.code}</span>
                        <span className="truncate" style={{ color: "var(--ea-text-2)" }}>{o.name}</span>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.code}
                    type="button"
                    onMouseDown={() => pick(o.code)}
                    className="w-full text-left px-2.5 py-1.5 text-xs flex items-baseline gap-2 transition-colors hover:bg-[var(--ea-bg-2)]"
                    style={{ background: o.code === value ? "var(--ea-primary-50)" : "transparent" }}
                  >
                    <span className="font-mono font-semibold shrink-0" style={{ color: "var(--ea-primary)" }}>{o.code}</span>
                    <span className="truncate" style={{ color: "var(--ea-text-2)" }}>{o.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
