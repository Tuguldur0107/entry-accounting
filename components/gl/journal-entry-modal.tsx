"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createVoucher } from "@/lib/actions/gl";
import { SEGMENT_DEFS } from "@/lib/constants/standard-accounts";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";

type Line = {
  account: string;
  debit: string;
  credit: string;
  description: string;
};

const emptyLine = (): Line => ({ account: "", debit: "", credit: "", description: "" });

const fmt = (n: number) =>
  n.toLocaleString("mn-MN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Segment combobox ─────────────────────────────────────────────────────────
type SegOption = { code: string; label: string };

function SegmentCombobox({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: SegOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const filtered = options.filter(
    (o) =>
      !value ||
      o.code.startsWith(value) ||
      o.label.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div ref={ref} className="relative h-full">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full h-full px-3 text-sm font-mono outline-none bg-transparent focus:bg-[#EEF4FF]"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 z-50 bg-white border border-[#ddd] rounded-md shadow-lg min-w-[220px] max-h-[220px] overflow-y-auto mt-0.5">
          {filtered.map((opt) => (
            <button
              key={opt.code}
              type="button"
              onMouseDown={() => { onChange(opt.code); setOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-2 text-xs hover:bg-[#f5f5f5] flex items-baseline gap-2",
                opt.code === value && "bg-[#EEF4FF]"
              )}
            >
              <span className="font-mono text-[#1E3A5F] font-medium">{opt.code}</span>
              <span className="text-[#888] truncate">{opt.label.replace(opt.code + " — ", "")}</span>
            </button>
          ))}
        </div>
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

// ─── Main modal ───────────────────────────────────────────────────────────────
interface Props {
  open: boolean;
  onClose: () => void;
  accounts: ChartOfAccount[];
  activeSegIds: number[];
  segmentValues: SegmentValue[];
}

export function JournalEntryModal({
  open, onClose, accounts, activeSegIds, segmentValues,
}: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);
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
          ? accounts.map((a) => ({ code: a.number, label: `${a.number} — ${a.name}` }))
          : segmentValues
              .filter((sv) => sv.segmentId === segId)
              .map((sv) => ({ code: sv.code, label: `${sv.code} — ${sv.name}` }));
    }
    return map;
  }, [activeSegIds, accounts, segmentValues]);

  // Grid: # | seg cols | Debit | Credit | Desc | ×
  const segColWidths = activeSegIds.map((id) => {
    const def = SEGMENT_DEFS.find((d) => d.id === id)!;
    return `${def.length * 11 + 40}px`;
  });
  const gridCols = `36px ${segColWidths.join(" ")} 120px 120px 1fr 36px`;

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

  function handleClose() {
    setDate(today);
    setDescription("");
    setLines([emptyLine(), emptyLine()]);
    setError("");
    onClose();
  }

  async function handleSave() {
    if (!date || !description.trim()) {
      setError("Огноо ба гүйлгээний утгыг бөглөнө үү");
      return;
    }
    if (!balanced) return;
    setSaving(true);
    setError("");
    try {
      await createVoucher({
        date,
        description: description.trim(),
        lines: lines.map((l) => ({
          account: l.account,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description,
        })),
      });
      handleClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Алдаа гарлаа");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden flex flex-col"
        style={{ width: "min(92vw, 1100px)", maxWidth: "none", maxHeight: "88vh" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5DE] bg-white shrink-0">
          <DialogTitle className="text-base font-semibold text-[#1a1a1a]">
            Журнал бичих
          </DialogTitle>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[#888]">{date}</span>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 bg-[#FAFAF7]">

          {/* Meta fields */}
          <div className="px-6 py-4 bg-white border-b border-[#E5E5DE]">
            <div className="grid grid-cols-[180px_1fr] gap-4 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666]">Огноо</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-[#D4D4CB] rounded-md px-3 py-2 text-sm outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/10 bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666]">Гүйлгээний утга</label>
                <input
                  type="text"
                  placeholder="Гүйлгээний тайлбар оруулна уу"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border border-[#D4D4CB] rounded-md px-3 py-2 text-sm outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/10 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Lines table */}
          <div className="px-6 py-4">
            <div className="border border-[#E5E5DE] rounded-lg overflow-hidden bg-white overflow-x-auto">

              {/* Column headers */}
              <div
                className="bg-[#F4F4EE] text-xs font-medium text-[#555] border-b border-[#E5E5DE]"
                style={{ display: "grid", gridTemplateColumns: gridCols, minWidth: "max-content" }}
              >
                <div className="px-2 py-3 text-center text-[#bbb]">#</div>
                {activeSegIds.map((segId) => {
                  const def = SEGMENT_DEFS.find((d) => d.id === segId)!;
                  return (
                    <div key={segId} className="px-3 py-2 border-l border-[#E5E5DE]">
                      <div className="font-semibold text-[#333]">S{segId} · {def.nameMn}</div>
                      <div className="text-[10px] text-[#aaa] font-normal mt-0.5">{def.length} оронтой</div>
                    </div>
                  );
                })}
                <div className="px-3 py-3 text-right border-l border-[#E5E5DE]">Дебет</div>
                <div className="px-3 py-3 text-right border-l border-[#E5E5DE]">Кредит</div>
                <div className="px-3 py-3 border-l border-[#E5E5DE]">Тайлбар</div>
                <div />
              </div>

              {/* Line rows */}
              {lines.map((line, i) => {
                const parts = parseSegParts(line.account, activeSegIds);
                return (
                  <div
                    key={i}
                    className="border-t border-[#EDEDE6] hover:bg-[#FAFAF7] group"
                    style={{
                      display: "grid",
                      gridTemplateColumns: gridCols,
                      minWidth: "max-content",
                      minHeight: 44,
                    }}
                  >
                    <div className="flex items-center justify-center text-xs text-[#ccc] border-r border-[#EDEDE6]">
                      {i + 1}
                    </div>

                    {activeSegIds.map((segId) => {
                      const def = SEGMENT_DEFS.find((d) => d.id === segId)!;
                      return (
                        <div key={segId} className="border-r border-[#EDEDE6]">
                          <SegmentCombobox
                            options={segOptions[segId] ?? []}
                            value={parts[segId] ?? ""}
                            onChange={(v) => updateSegPart(i, segId, v)}
                            placeholder={"·".repeat(def.length)}
                          />
                        </div>
                      );
                    })}

                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.debit}
                      disabled={parseFloat(line.credit) > 0}
                      onChange={(e) => updateLine(i, "debit", e.target.value)}
                      onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                      className="border-r border-[#EDEDE6] px-3 text-right text-sm w-full outline-none disabled:bg-[#F4F4EE] disabled:text-[#ccc] focus:bg-[#EEF4FF] h-full"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.credit}
                      disabled={parseFloat(line.debit) > 0}
                      onChange={(e) => updateLine(i, "credit", e.target.value)}
                      onKeyDown={(e) => ["e","E","+","-"].includes(e.key) && e.preventDefault()}
                      className="border-r border-[#EDEDE6] px-3 text-right text-sm w-full outline-none disabled:bg-[#F4F4EE] disabled:text-[#ccc] focus:bg-[#EEF4FF] h-full"
                    />
                    <input
                      type="text"
                      placeholder="Тайлбар..."
                      value={line.description}
                      onChange={(e) => updateLine(i, "description", e.target.value)}
                      className="border-r border-[#EDEDE6] px-3 text-sm w-full outline-none focus:bg-[#EEF4FF] h-full"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (lines.length <= 2) return;
                        setLines((p) => p.filter((_, idx) => idx !== i));
                      }}
                      disabled={lines.length <= 2}
                      className="flex items-center justify-center text-[#ccc] hover:text-red-500 hover:bg-red-50 disabled:opacity-0 transition-colors text-lg"
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              {/* Totals row */}
              <div
                className="border-t-2 border-[#D4D4CB] bg-[#F4F4EE] text-sm font-semibold"
                style={{ display: "grid", gridTemplateColumns: gridCols, minWidth: "max-content" }}
              >
                <div />
                {activeSegIds.map((segId) => (
                  <div key={segId} className="border-l border-[#E5E5DE]" />
                ))}
                <div className="px-3 py-2.5 text-right tabular-nums border-l border-[#E5E5DE]">
                  {fmt(totalDebit)}
                </div>
                <div className="px-3 py-2.5 text-right tabular-nums border-l border-[#E5E5DE]">
                  {fmt(totalCredit)}
                </div>
                <div className="px-3 py-2.5 text-xs text-[#888] font-normal border-l border-[#E5E5DE] flex items-center">
                  Нийт дүн
                </div>
                <div />
              </div>
            </div>

            {/* Add row */}
            <button
              type="button"
              onClick={() => setLines((p) => [...p, emptyLine()])}
              className="mt-3 text-sm text-[#1E3A5F] font-medium hover:underline"
            >
              + Мөр нэмэх
            </button>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#E5E5DE] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "text-sm px-3 py-1.5 rounded-md font-medium",
                isEmpty ? "text-[#888] bg-[#F4F4EE]"
                : balanced ? "text-green-700 bg-green-50 border border-green-200"
                : "text-red-600 bg-red-50 border border-red-200"
              )}
            >
              {isEmpty ? "Дүн оруулаагүй" : balanced ? "✓ Тэнцсэн" : `Зөрүү: ${fmt(diff)}`}
            </span>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleClose}>
              Болих
            </Button>
            <Button
              className="bg-[#1E3A5F] hover:bg-[#15294A] px-6"
              disabled={!balanced || saving}
              onClick={handleSave}
            >
              {saving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
