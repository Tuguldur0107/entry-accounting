"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { createVoucher, updateVoucher } from "@/lib/actions/gl";
import { SEGMENT_DEFS, ACCOUNT_GROUPS } from "@/lib/constants/standard-accounts";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";

function closeWindow() {
  if (window.opener) {
    window.opener.location.reload();
    window.close();
  } else {
    window.location.href = "/gl/journal";
  }
}

type Line = {
  account: string;
  debit: string;
  credit: string;
  description: string;
};

const fmt = (n: number) =>
  n.toLocaleString("mn-MN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type SegOption = { code: string; name: string };

// ─── Searchable segment dropdown (portal-based) ───────────────────────────────
function SegSelect({
  options,
  value,
  onChange,
  groups,
  width = 220,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  groups?: Record<string, string>;
  width?: number;
}) {
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
      if (!triggerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
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
        <span className="truncate">{selected ? selected.code : "—"}</span>
        <svg width="9" height="5" viewBox="0 0 9 5" style={{ flexShrink: 0, color: "var(--ea-text-4)" }}>
          <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div
            data-seg-portal=""
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width,
              zIndex: 10000,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "6px 6px 5px", borderBottom: "1px solid var(--ea-border)" }}>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
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

// ─── Account picker: shows combined code + edit popup ─────────────────────────
function AccountPicker({
  activeSegIds,
  segOptions,
  value,
  onChange,
  extraDefaults,
}: {
  activeSegIds: number[];
  segOptions: Record<number, SegOption[]>;
  value: string;
  onChange: (v: string) => void;
  extraDefaults: Record<number, string>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [draft, setDraft] = useState<Record<number, string>>({});
  const triggerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const parts = parseSegParts(value, activeSegIds);
  const display = activeSegIds.map((id) => parts[id] ?? "").filter(Boolean).join(".");

  function openPopup() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const popupW = 320;
    const left = Math.min(r.left, window.innerWidth - popupW - 8);
    setPos({ top: r.bottom + 4, left });
    // Initialize draft from current value
    setDraft(parseSegParts(value, activeSegIds));
    setOpen(true);
  }

  function confirm() {
    onChange(buildSegCode(draft, activeSegIds, extraDefaults));
    setOpen(false);
  }

  function cancel() {
    setOpen(false);
  }

  return (
    <div ref={triggerRef} className="flex items-center gap-2 h-full px-3 group/cell">
      {/* Combined code display */}
      <span
        className="font-mono text-xs flex-1 truncate"
        style={{ color: display ? "var(--ea-text-1)" : "var(--ea-text-4)" }}
      >
        {display || "—"}
      </span>

      {/* Edit icon */}
      <button
        type="button"
        onClick={openPopup}
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover/cell:opacity-100 transition-all"
        style={{ color: "var(--ea-text-4)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--ea-primary)";
          e.currentTarget.style.background = "var(--ea-primary-50)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--ea-text-4)";
          e.currentTarget.style.background = "transparent";
        }}
        title="Данс сонгох"
      >
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
          <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
        </svg>
      </button>

      {/* Segment picker popup */}
      {open &&
        createPortal(
          <div
            ref={popupRef}
            data-seg-portal=""
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: 320,
              zIndex: 9999,
              background: "var(--ea-surface)",
              border: "1px solid var(--ea-border-strong)",
              borderRadius: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              overflow: "visible",
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: "1px solid var(--ea-border)" }}
            >
              <span className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
                Данс сонгох
              </span>
              <button
                type="button"
                onClick={cancel}
                className="w-5 h-5 flex items-center justify-center rounded text-sm leading-none transition-colors"
                style={{ color: "var(--ea-text-4)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ea-text-1)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ea-text-4)")}
              >
                ×
              </button>
            </div>

            {/* Segment rows */}
            <div className="p-3 space-y-2">
              {activeSegIds.map((segId) => {
                const def = SEGMENT_DEFS.find((d) => d.id === segId)!;
                return (
                  <div key={segId} className="flex items-center gap-2">
                    <div className="w-[88px] shrink-0">
                      <span className="text-[11px] font-medium block" style={{ color: "var(--ea-text-3)" }}>
                        {def.nameMn}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--ea-text-4)" }}>S{segId}</span>
                    </div>
                    <div className="flex-1">
                      <SegSelect
                        options={segOptions[segId] ?? []}
                        value={draft[segId] ?? ""}
                        onChange={(v) => setDraft((p) => ({ ...p, [segId]: v }))}
                        groups={segId === 3 ? ACCOUNT_GROUPS : undefined}
                        width={260}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-end gap-2 px-3 py-2.5"
              style={{ borderTop: "1px solid var(--ea-border)" }}
            >
              <button
                type="button"
                onClick={cancel}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                style={{ border: "1px solid var(--ea-border-strong)", background: "transparent", color: "var(--ea-text-2)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-bg-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Болих
              </button>
              <button
                type="button"
                onClick={confirm}
                className="px-3 py-1.5 text-xs font-semibold text-white rounded-md transition-colors"
                style={{ background: "var(--ea-primary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-primary-700)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-primary)")}
              >
                Оруулах
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// Default values for inactive segments
const SEG_DEFAULTS: Record<number, string> = {
  1: "", 2: "", 3: "", 4: "", 5: "",
  6: "000",   // Intercompany — тохиохгүй
  7: "0000",  // Related party — тохиохгүй
  8: "",
  9: "GL",    // Module — General Ledger
  10: "0",    // Reserve
};

const ALL_SEG_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Parse active segment values from a stored 10-part or partial code
function parseSegParts(code: string, activeSegIds: number[]): Record<number, string> {
  const parts = code.split(".");
  if (parts.length === 10) {
    // Full 10-segment code: extract by absolute position
    return Object.fromEntries(activeSegIds.map((id) => [id, parts[id - 1] ?? ""]));
  }
  // Legacy partial code: map by index order
  return Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i] ?? ""]));
}

// Always build a full 10-segment code; inactive segments use SEG_DEFAULTS
function buildSegCode(
  activeParts: Record<number, string>,
  activeSegIds: number[],
  extraDefaults: Record<number, string> = {}
): string {
  return ALL_SEG_IDS.map((id) => {
    if (activeSegIds.includes(id)) return activeParts[id] ?? "";
    return extraDefaults[id] ?? SEG_DEFAULTS[id] ?? "";
  }).join(".");
}

// ─── Main form ────────────────────────────────────────────────────────────────
interface InitialVoucher {
  date: string;
  description: string;
  lines: Line[];
}

interface Props {
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  segmentValues: SegmentValue[];
  defaultSegments?: Record<number, string>;
  voucherId?: string;
  initialVoucher?: InitialVoucher;
}

export function JournalEntryForm({
  accounts,
  activeSegIds,
  segmentValues,
  defaultSegments = {},
  voucherId,
  initialVoucher,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!voucherId;

  function makeEmptyLine(): Line {
    const parts: Record<number, string> = {};
    for (const id of activeSegIds) parts[id] = defaultSegments[id] ?? "";
    return { account: buildSegCode(parts, activeSegIds, defaultSegments), debit: "", credit: "", description: "" };
  }

  const [date, setDate] = useState(initialVoucher?.date ?? today);
  const [description, setDescription] = useState(initialVoucher?.description ?? "");
  const [lines, setLines] = useState<Line[]>(
    initialVoucher?.lines && initialVoucher.lines.length >= 2
      ? initialVoucher.lines
      : [makeEmptyLine(), makeEmptyLine()]
  );
  const [saving, setSaving] = useState<"draft" | "posted" | null>(null);
  const [error, setError] = useState("");

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const diff = totalDebit - totalCredit;
  const isEmpty = totalDebit === 0 && totalCredit === 0;
  const balanced = !isEmpty && Math.abs(diff) <= 0.01;

  const segOptions = useMemo(() => {
    const map: Record<number, SegOption[]> = {};
    for (const segId of activeSegIds) {
      map[segId] =
        segId === 3
          ? accounts.map((a) => ({ code: a.number, name: a.name }))
          : segmentValues
              .filter((sv) => sv.segmentId === segId)
              .map((sv) => ({ code: sv.code, name: sv.name }));
    }
    return map;
  }, [activeSegIds, accounts, segmentValues]);

  // Account column: wide enough to show all active segment parts joined by "."
  const accountColWidth = Math.max(
    180,
    activeSegIds.reduce((s, id) => {
      const def = SEGMENT_DEFS.find((d) => d.id === id)!;
      return s + def.length * 9 + 10;
    }, 0)
  );

  const gridCols = `40px ${accountColWidth}px 140px 140px 1fr 40px`;

  const updateLine = useCallback((i: number, field: keyof Line, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === "debit" && parseFloat(value) > 0) next[i].credit = "";
      if (field === "credit" && parseFloat(value) > 0) next[i].debit = "";
      return next;
    });
  }, []);

  async function handleSave(status: "draft" | "posted") {
    if (!date || !description.trim()) {
      setError("Огноо ба гүйлгээний утгыг бөглөнө үү");
      return;
    }
    if (status === "posted" && !balanced) return;
    setSaving(status);
    setError("");
    try {
      const payload = {
        date,
        description: description.trim(),
        status,
        lines: lines.map((l) => ({
          account: l.account,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description,
        })),
      };
      if (isEdit) {
        await updateVoucher(voucherId, payload);
      } else {
        await createVoucher(payload);
      }
      closeWindow();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
      setSaving(null);
    }
  }

  const cellBorder = { borderLeft: "1px solid var(--ea-border)" };
  const thCls = "px-3 py-2.5 text-xs font-semibold tracking-wide";

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--ea-bg)", fontFamily: "var(--ea-font-sans)" }}>

      {/* ── Header ── */}
      <header
        className="px-6 flex items-center shrink-0 h-12 gap-3"
        style={{ background: "var(--ea-surface)", borderBottom: "1px solid var(--ea-border)" }}
      >
        <button
          onClick={closeWindow}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: "var(--ea-text-3)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ea-text-1)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ea-text-3)")}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Буцах
        </button>
        <div style={{ width: 1, height: 20, background: "var(--ea-border)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto py-6 px-6">
        <div className="max-w-screen-xl mx-auto space-y-4">

          {/* Meta card */}
          <div
            className="p-5"
            style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 10 }}
          >
            <div className="grid gap-5" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block" style={{ color: "var(--ea-text-3)" }}>Огноо</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none transition-colors"
                  style={{ border: "1px solid var(--ea-border-strong)", background: "var(--ea-surface)", color: "var(--ea-text-1)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ea-primary)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ea-border-strong)")}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold block" style={{ color: "var(--ea-text-3)" }}>Гүйлгээний утга</label>
                <input
                  type="text"
                  placeholder="Гүйлгээний тайлбар оруулна уу"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md outline-none transition-colors"
                  style={{ border: "1px solid var(--ea-border-strong)", background: "var(--ea-surface)", color: "var(--ea-text-1)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ea-primary)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--ea-border-strong)")}
                />
              </div>
            </div>
          </div>

          {/* Lines table */}
          <div style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>

              {/* Header */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  minWidth: "max-content",
                  background: "var(--ea-bg-2)",
                  borderBottom: "1px solid var(--ea-border)",
                }}
              >
                <div className={cn(thCls, "text-center")} style={{ color: "var(--ea-text-4)" }}>#</div>
                <div className={thCls} style={{ ...cellBorder, color: "var(--ea-text-3)" }}>Данс</div>
                <div className={cn(thCls, "text-right")} style={{ ...cellBorder, color: "var(--ea-text-3)" }}>Дебет</div>
                <div className={cn(thCls, "text-right")} style={{ ...cellBorder, color: "var(--ea-text-3)" }}>Кредит</div>
                <div className={thCls} style={{ ...cellBorder, color: "var(--ea-text-3)" }}>Тайлбар</div>
                <div />
              </div>

              {/* Rows */}
              {lines.map((line, i) => {
                const hasDebit = parseFloat(line.debit) > 0;
                const hasCredit = parseFloat(line.credit) > 0;
                return (
                  <div
                    key={i}
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      minWidth: "max-content",
                      minHeight: 46,
                      borderTop: "1px solid var(--ea-border)",
                    }}
                    className="hover:bg-[var(--ea-bg-2)] group transition-colors"
                  >
                    {/* Row # */}
                    <div
                      className="flex items-center justify-center text-xs"
                      style={{ color: "var(--ea-text-4)", borderRight: "1px solid var(--ea-border)" }}
                    >
                      {i + 1}
                    </div>

                    {/* Account */}
                    <div style={{ borderRight: "1px solid var(--ea-border)" }}>
                      <AccountPicker
                        activeSegIds={activeSegIds}
                        segOptions={segOptions}
                        value={line.account}
                        onChange={(v) => updateLine(i, "account", v)}
                        extraDefaults={defaultSegments}
                      />
                    </div>

                    {/* Debit */}
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      placeholder="0.00"
                      value={line.debit}
                      disabled={hasCredit}
                      onChange={(e) => updateLine(i, "debit", e.target.value)}
                      onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                      className="px-3 text-right text-sm w-full outline-none h-full transition-colors"
                      style={{
                        borderRight: "1px solid var(--ea-border)",
                        background: hasCredit ? "var(--ea-bg-2)" : "transparent",
                        color: hasCredit ? "var(--ea-text-4)" : "var(--ea-text-1)",
                      }}
                    />

                    {/* Credit */}
                    <input
                      type="number" inputMode="decimal" step="0.01" min="0"
                      placeholder="0.00"
                      value={line.credit}
                      disabled={hasDebit}
                      onChange={(e) => updateLine(i, "credit", e.target.value)}
                      onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                      className="px-3 text-right text-sm w-full outline-none h-full transition-colors"
                      style={{
                        borderRight: "1px solid var(--ea-border)",
                        background: hasDebit ? "var(--ea-bg-2)" : "transparent",
                        color: hasDebit ? "var(--ea-text-4)" : "var(--ea-text-1)",
                      }}
                    />

                    {/* Description */}
                    <input
                      type="text"
                      placeholder="Тайлбар..."
                      value={line.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      className="px-3 text-sm w-full outline-none bg-transparent h-full"
                      style={{ borderRight: "1px solid var(--ea-border)", color: "var(--ea-text-1)" }}
                    />

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => {
                        if (lines.length <= 2) {
                          setError("Дор хаяж 2 мөр шаардлагатай. Мөр нэмээд буцаад устгана уу.");
                          return;
                        }
                        setError("");
                        setLines((p) => p.filter((_, idx) => idx !== i));
                      }}
                      title="Мөр устгах"
                      className="flex items-center justify-center transition-all text-base leading-none cursor-pointer"
                      style={{ color: "var(--ea-text-4)" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "var(--ea-danger)";
                        e.currentTarget.style.background = "color-mix(in srgb, var(--ea-danger) 8%, transparent)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "var(--ea-text-4)";
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {/* Totals */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  minWidth: "max-content",
                  borderTop: "2px solid var(--ea-border-strong)",
                  background: "var(--ea-bg-2)",
                }}
              >
                <div />
                <div style={cellBorder} />
                <div className="px-3 py-3 text-right text-sm font-semibold tabular-nums" style={{ ...cellBorder, color: "var(--ea-text-1)" }}>
                  {fmt(totalDebit)}
                </div>
                <div className="px-3 py-3 text-right text-sm font-semibold tabular-nums" style={{ ...cellBorder, color: "var(--ea-text-1)" }}>
                  {fmt(totalCredit)}
                </div>
                <div className="px-3 py-3 text-xs" style={{ ...cellBorder, color: "var(--ea-text-3)" }}>Нийт дүн</div>
                <div />
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer
        className="px-6 py-3 flex items-center justify-between shrink-0"
        style={{ background: "var(--ea-surface)", borderTop: "1px solid var(--ea-border)" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-sm px-3 py-1.5 rounded-md font-medium"
            style={
              isEmpty
                ? { color: "var(--ea-text-3)", background: "var(--ea-bg-2)" }
                : balanced
                ? { color: "var(--ea-success)", background: "color-mix(in srgb, var(--ea-success) 10%, var(--ea-surface))", border: "1px solid color-mix(in srgb, var(--ea-success) 30%, transparent)" }
                : { color: "var(--ea-danger)", background: "color-mix(in srgb, var(--ea-danger) 10%, var(--ea-surface))", border: "1px solid color-mix(in srgb, var(--ea-danger) 30%, transparent)" }
            }
          >
            {isEmpty ? "Дүн оруулаагүй" : balanced ? "✓ Тэнцсэн" : `Зөрүү: ${fmt(diff)}`}
          </span>
          {error && <span className="text-sm" style={{ color: "var(--ea-danger)" }}>{error}</span>}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLines((p) => [...p, makeEmptyLine()])}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{ border: "1px solid var(--ea-border-strong)", background: "var(--ea-surface)", color: "var(--ea-text-2)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-bg-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            + Мөр нэмэх
          </button>
          <div style={{ width: 1, height: 20, background: "var(--ea-border)" }} />
          <button
            onClick={closeWindow}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors"
            style={{ border: "1px solid var(--ea-border-strong)", background: "var(--ea-surface)", color: "var(--ea-text-2)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ea-bg-2)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            Болих
          </button>
          <button
            onClick={() => handleSave("draft")}
            disabled={saving !== null}
            className="px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ border: "1px solid var(--ea-border-strong)", background: "var(--ea-surface)", color: "var(--ea-text-2)" }}
            onMouseEnter={(e) => { if (saving === null) e.currentTarget.style.background = "var(--ea-bg-2)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-surface)")}
          >
            {saving === "draft" ? "Хадгалж байна..." : "Ноорог"}
          </button>
          <button
            onClick={() => handleSave("posted")}
            disabled={!balanced || saving !== null}
            className="px-5 py-2 text-sm font-semibold text-white rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--ea-primary)" }}
            onMouseEnter={(e) => { if (balanced && saving === null) e.currentTarget.style.background = "var(--ea-primary-700)"; }}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--ea-primary)")}
          >
            {saving === "posted" ? "Хадгалж байна..." : "Хадгалах"}
          </button>
        </div>
      </footer>
    </div>
  );
}
