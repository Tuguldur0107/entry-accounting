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
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  groups?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });
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
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) });
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target)) {
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

  // Group filtered options by first char when groups map provided
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
    <div className="h-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? setOpen(false) : openDropdown()}
        className="w-full h-full px-3 text-sm font-mono text-left flex items-center justify-between gap-1 hover:bg-[#F4F4EE] transition-colors"
      >
        <span className={cn("truncate", value ? "text-[#1a1a1a]" : "text-[#c0c0c0]")}>
          {selected ? selected.code : "—"}
        </span>
        <svg width="10" height="6" viewBox="0 0 10 6" className="shrink-0 text-[#bbb]">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white border border-[#D4D4CB] rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-[#EDEDE6]">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Хайх..."
              className="w-full px-3 py-1.5 text-sm border border-[#D4D4CB] rounded-md outline-none focus:border-[#1E3A5F] bg-white"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            <button
              type="button"
              onMouseDown={() => pick("")}
              className={cn(
                "w-full text-left px-3 py-2 text-xs text-[#aaa] hover:bg-[#FAFAF7] transition-colors",
                !value && "bg-[#F4F4EE] text-[#666]"
              )}
            >
              — Хоосон
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[#aaa] text-center">Олдсонгүй</div>
            ) : groupedItems ? (
              groupedItems.map(([key, opts]) => (
                <div key={key}>
                  <div className="px-3 py-1 text-xs font-semibold text-[#9A9A91] bg-[#F4F4EE] border-y border-[#EDEDE6] sticky top-0">
                    {key}X — {groups![key] ?? ""}
                  </div>
                  {opts.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      onMouseDown={() => pick(o.code)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs hover:bg-[#FAFAF7] flex items-baseline gap-2 transition-colors",
                        o.code === value && "bg-[#EEF3FF]"
                      )}
                    >
                      <span className="font-mono font-semibold text-[#1E3A5F] shrink-0">{o.code}</span>
                      <span className="text-[#666] truncate">{o.name}</span>
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
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-[#FAFAF7] flex items-baseline gap-2 transition-colors",
                    o.code === value && "bg-[#EEF3FF]"
                  )}
                >
                  <span className="font-mono font-semibold text-[#1E3A5F] shrink-0">{o.code}</span>
                  <span className="text-[#666] truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseSegParts(code: string, activeSegIds: number[]): Record<number, string> {
  if (activeSegIds.length <= 1) return { [activeSegIds[0] ?? 3]: code };
  const parts = code.split(".");
  return Object.fromEntries(activeSegIds.map((id, i) => [id, parts[i] ?? ""]));
}

function buildSegCode(parts: Record<number, string>, activeSegIds: number[]): string {
  if (activeSegIds.length <= 1) return parts[activeSegIds[0] ?? 3] ?? "";
  return activeSegIds.map((id) => parts[id] ?? "").join(".");
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

export function JournalEntryForm({ accounts, activeSegIds, segmentValues, defaultSegments = {}, voucherId, initialVoucher }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!voucherId;

  function makeEmptyLine(): Line {
    const parts: Record<number, string> = {};
    for (const id of activeSegIds) parts[id] = defaultSegments[id] ?? "";
    const account = buildSegCode(parts, activeSegIds);
    return { account, debit: "", credit: "", description: "" };
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
  const balanced = !isEmpty && Math.abs(diff) < 0.005;

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

  const segColWidths = activeSegIds.map((id) => {
    const def = SEGMENT_DEFS.find((d) => d.id === id)!;
    return `${Math.max(def.length * 11 + 44, 80)}px`;
  });
  const gridCols = `44px ${segColWidths.join(" ")} 136px 136px 1fr 44px`;

  const updateLine = useCallback((i: number, field: keyof Line, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      if (field === "debit" && parseFloat(value) > 0) next[i].credit = "";
      if (field === "credit" && parseFloat(value) > 0) next[i].debit = "";
      return next;
    });
  }, []);

  function updateSegPart(lineIdx: number, segId: number, val: string) {
    const parts = parseSegParts(lines[lineIdx].account, activeSegIds);
    updateLine(lineIdx, "account", buildSegCode({ ...parts, [segId]: val }, activeSegIds));
  }

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

  const inputCls = "w-full border border-[#D4D4CB] rounded-md px-3 py-2 text-sm outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/10 bg-white transition-colors";
  const thCls = "px-3 py-2.5 text-xs font-semibold text-[#666] tracking-wide border-l border-[#E5E5DE] first:border-l-0";
  const cellBorder = "border-r border-[#EDEDE6] last:border-r-0";

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--ea-bg)", fontFamily: "var(--ea-font-sans)" }}>

      {/* ── Header ── */}
      <header style={{ background: "var(--ea-surface)", borderBottom: "1px solid var(--ea-border)" }} className="px-6 py-0 flex items-center shrink-0 h-12">
        <button
          onClick={closeWindow}
          className="flex items-center gap-2 text-sm text-[#888] hover:text-[#1E3A5F] transition-colors mr-4"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Буцах
        </button>
        <div style={{ width: 1, height: 20, background: "var(--ea-border)" }} className="mr-4" />
        <span className="text-sm font-semibold" style={{ color: "var(--ea-text-1)" }}>
          {isEdit ? "Журнал засах" : "Журнал бичих"}
        </span>
      </header>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto py-6 px-6">
        <div className="max-w-screen-xl mx-auto space-y-4">

          {/* Meta card */}
          <div style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 10 }} className="p-5">
            <div className="grid gap-5" style={{ gridTemplateColumns: "180px 1fr" }}>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
                  Огноо
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold" style={{ color: "var(--ea-text-2)" }}>
                  Гүйлгээний утга
                </label>
                <input
                  type="text"
                  placeholder="Гүйлгээний тайлбар оруулна уу"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Lines table */}
          <div style={{ background: "var(--ea-surface)", border: "1px solid var(--ea-border)", borderRadius: 10 }} className="overflow-hidden overflow-x-auto">

            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                minWidth: "max-content",
                background: "var(--ea-bg-2)",
                borderBottom: "1px solid var(--ea-border)",
              }}
            >
              <div className="px-3 py-2.5 text-xs font-semibold text-center" style={{ color: "var(--ea-text-4)" }}>#</div>
              {activeSegIds.map((segId) => {
                const def = SEGMENT_DEFS.find((d) => d.id === segId)!;
                return (
                  <div key={segId} className={thCls} title={def.nameMn}>
                    S{segId}
                  </div>
                );
              })}
              <div className={`${thCls} text-right`}>Дебет</div>
              <div className={`${thCls} text-right`}>Кредит</div>
              <div className={thCls}>Тайлбар</div>
              <div />
            </div>

            {/* Data rows */}
            {lines.map((line, i) => {
              const parts = parseSegParts(line.account, activeSegIds);
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    minWidth: "max-content",
                    minHeight: 46,
                    borderTop: "1px solid var(--ea-border-2, #F0F0EA)",
                  }}
                  className="hover:bg-[#FAFAF7] group"
                >
                  {/* Row # */}
                  <div className={`flex items-center justify-center text-xs ${cellBorder}`} style={{ color: "var(--ea-text-4)" }}>
                    {i + 1}
                  </div>

                  {/* Segment dropdowns */}
                  {activeSegIds.map((segId) => (
                    <div key={segId} className={cellBorder}>
                      <SegSelect
                        options={segOptions[segId] ?? []}
                        value={parts[segId] ?? ""}
                        onChange={(v) => updateSegPart(i, segId, v)}
                        groups={segId === 3 ? ACCOUNT_GROUPS : undefined}
                      />
                    </div>
                  ))}

                  {/* Debit */}
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    placeholder="0.00"
                    value={line.debit}
                    disabled={parseFloat(line.credit) > 0}
                    onChange={(e) => updateLine(i, "debit", e.target.value)}
                    onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                    className={`${cellBorder} px-3 text-right text-sm w-full outline-none transition-colors h-full`}
                    style={{
                      background: parseFloat(line.credit) > 0 ? "var(--ea-bg-2)" : "transparent",
                      color: parseFloat(line.credit) > 0 ? "var(--ea-text-4)" : "var(--ea-text-1)",
                    }}
                  />

                  {/* Credit */}
                  <input
                    type="number" inputMode="decimal" step="0.01" min="0"
                    placeholder="0.00"
                    value={line.credit}
                    disabled={parseFloat(line.debit) > 0}
                    onChange={(e) => updateLine(i, "credit", e.target.value)}
                    onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                    className={`${cellBorder} px-3 text-right text-sm w-full outline-none transition-colors h-full`}
                    style={{
                      background: parseFloat(line.debit) > 0 ? "var(--ea-bg-2)" : "transparent",
                      color: parseFloat(line.debit) > 0 ? "var(--ea-text-4)" : "var(--ea-text-1)",
                    }}
                  />

                  {/* Description */}
                  <input
                    type="text"
                    placeholder="Тайлбар..."
                    value={line.description}
                    onChange={(e) => updateLine(i, "description", e.target.value)}
                    className={`${cellBorder} px-3 text-sm w-full outline-none bg-transparent h-full`}
                    style={{ color: "var(--ea-text-1)" }}
                  />

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => {
                      if (lines.length <= 2) return;
                      setLines((p) => p.filter((_, idx) => idx !== i));
                    }}
                    disabled={lines.length <= 2}
                    className="flex items-center justify-center opacity-0 group-hover:opacity-100 disabled:opacity-0 hover:text-red-500 hover:bg-red-50 transition-all"
                    style={{ color: "var(--ea-text-4)" }}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {/* Totals row */}
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
              {activeSegIds.map((segId) => (
                <div key={segId} style={{ borderLeft: "1px solid var(--ea-border)" }} />
              ))}
              <div className="px-3 py-3 text-right text-sm font-semibold tabular-nums" style={{ borderLeft: "1px solid var(--ea-border)", color: "var(--ea-text-1)" }}>
                {fmt(totalDebit)}
              </div>
              <div className="px-3 py-3 text-right text-sm font-semibold tabular-nums" style={{ borderLeft: "1px solid var(--ea-border)", color: "var(--ea-text-1)" }}>
                {fmt(totalCredit)}
              </div>
              <div className="px-3 py-3 text-xs" style={{ borderLeft: "1px solid var(--ea-border)", color: "var(--ea-text-3)" }}>
                Нийт дүн
              </div>
              <div />
            </div>
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <footer style={{ background: "var(--ea-surface)", borderTop: "1px solid var(--ea-border)" }} className="px-6 py-3 flex items-center justify-between shrink-0">

        {/* Balance status */}
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
          {error && (
            <span className="text-sm" style={{ color: "var(--ea-danger)" }}>{error}</span>
          )}
        </div>

        {/* Actions */}
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
