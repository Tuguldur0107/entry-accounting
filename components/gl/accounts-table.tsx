"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  createAccount,
  deleteAccount,
  syncStandardAccounts,
  updateSegmentConfig,
  createSegmentValue,
  deleteSegmentValue,
  batchSaveSection2,
} from "@/lib/actions/gl";
import {
  SEGMENT_DEFS,
  ACCOUNT_GROUPS,
  MODULE_LABELS,
  MODULE_DEFS,
  ALL_MODULES,
  getSegmentKey,
  type ModuleKey,
} from "@/lib/constants/standard-accounts";
import { batchSaveModuleConfigs } from "@/lib/actions/gl";
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";

interface SegmentConfigRow { segmentId: number; isEnabled: boolean }
interface ModuleConfigRow  { moduleKey: string; isEnabled: boolean }
interface Props {
  accounts: ChartOfAccount[];
  segmentConfigs: SegmentConfigRow[];
  segmentValues: SegmentValue[];
  moduleConfigs: ModuleConfigRow[];
}

type DraftItem = { isEnabled: boolean; modules: string };

function parseMods(modules: string): ModuleKey[] {
  return modules.split(",").map((m) => m.trim()).filter((m): m is ModuleKey => ALL_MODULES.includes(m as ModuleKey));
}

// ─── Excel-style column filter dropdown ───────────────────────────────────────
type ShownSet = Set<string> | null; // null = no filter (show all)

function ColumnFilter({
  label,
  colKey,
  allValues,
  shown,
  onChange,
  center,
  width,
}: {
  label: string;
  colKey: string;
  allValues: string[];
  shown: ShownSet;
  onChange: (key: string, val: ShownSet) => void;
  center?: boolean;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const isActive = shown !== null && shown.size < allValues.length;

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const opts = allValues.filter((v) => v.toLowerCase().includes(query.toLowerCase()));
  const effective = shown ?? new Set(allValues);

  function toggle(val: string) {
    const next = new Set(effective);
    if (next.has(val)) next.delete(val); else next.add(val);
    onChange(colKey, next.size === allValues.length ? null : next);
  }

  return (
    <div
      ref={ref}
      style={width ? { width } : undefined}
      className={cn("relative flex items-center gap-0.5 select-none", center && "justify-center", !width && "flex-1")}
    >
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={() => { setOpen((p) => !p); setQuery(""); }}
        className={cn(
          "shrink-0 w-3.5 h-3.5 flex items-center justify-center rounded text-[8px] transition-colors",
          isActive ? "text-[#1E3A5F] bg-[#EEF2FA]" : "text-[#ccc] hover:text-[#888]"
        )}
      >
        ▼
      </button>
      {open && (
        <div
          className={cn(
            "absolute top-full z-50 bg-white border border-[#ddd] rounded-md shadow-lg w-[200px] mt-1 normal-case font-normal tracking-normal",
            center ? "left-1/2 -translate-x-1/2" : "left-0"
          )}
        >
          <div className="p-2 border-b border-[#E8E8E0]">
            <input
              autoFocus
              type="text"
              placeholder="Хайх..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full text-xs border border-[#ddd] rounded px-2 py-1 outline-none focus:border-[#1E3A5F]"
            />
          </div>
          <div className="px-2 py-1.5 border-b border-[#E8E8E0] flex gap-3">
            <button type="button" onClick={() => onChange(colKey, null)} className="text-[10px] text-[#1E3A5F] hover:underline">Бүгдийг харуулах</button>
            <button type="button" onClick={() => onChange(colKey, new Set())} className="text-[10px] text-[#888] hover:underline">Бүгдийг нуух</button>
          </div>
          <div className="max-h-[220px] overflow-y-auto py-1">
            {opts.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#aaa]">Илэрц олдсонгүй</div>
            ) : opts.map((val) => (
              <label key={val} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#F4F4EE] cursor-pointer">
                <input type="checkbox" checked={effective.has(val)} onChange={() => toggle(val)} className="accent-[#1E3A5F] w-3.5 h-3.5" />
                <span className="text-xs text-[#333]">{val}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table header with per-column filters ─────────────────────────────────────
function TableHeader({
  activeMods,
  allValuesMap,
  colFilters,
  onFilter,
}: {
  activeMods: ModuleKey[];
  allValuesMap: Record<string, string[]>;
  colFilters: Record<string, ShownSet>;
  onFilter: (key: string, val: ShownSet) => void;
}) {
  return (
    <div className="flex items-center px-3 py-2 text-[10px] font-semibold text-[#aaa] uppercase tracking-wide bg-[#F4F4EE] border border-[#E5E5DE] rounded-t-md">
      <ColumnFilter label="Код" colKey="code" width="120px" allValues={allValuesMap["code"] ?? []} shown={colFilters["code"] ?? null} onChange={onFilter} />
      <ColumnFilter label="Нэр" colKey="name" allValues={allValuesMap["name"] ?? []} shown={colFilters["name"] ?? null} onChange={onFilter} />
      {activeMods.map((mod) => (
        <ColumnFilter key={mod} label={MODULE_LABELS[mod]} colKey={mod} width="52px" center allValues={["Тийм", "Үгүй"]} shown={colFilters[mod] ?? null} onChange={onFilter} />
      ))}
      <ColumnFilter label="Төлөв" colKey="isEnabled" width="72px" center allValues={["Тийм", "Үгүй"]} shown={colFilters["isEnabled"] ?? null} onChange={onFilter} />
      <div className="w-[28px]" />
    </div>
  );
}

export function AccountsTable({ accounts, segmentConfigs, segmentValues, moduleConfigs }: Props) {
  const [localConfigs, setLocalConfigs] = useState<SegmentConfigRow[]>(segmentConfigs);

  const enabledSegIds = localConfigs.filter((c) => c.isEnabled).map((c) => c.segmentId);
  const [mainTab, setMainTab] = useState<"modules" | "config" | "values">("modules");

  // ── Module config edit mode ───────────────────────────────────────────────
  const [localMods, setLocalMods] = useState<ModuleConfigRow[]>(moduleConfigs);
  const [modEditMode, setModEditMode] = useState(false);
  const [modDraft, setModDraft] = useState<ModuleConfigRow[]>([]);
  const [modSaving, setModSaving] = useState(false);

  function enterModEdit() { setModDraft(localMods.map((m) => ({ ...m }))); setModEditMode(true); }
  function cancelModEdit() { setModDraft([]); setModEditMode(false); }

  async function saveModEdit() {
    setModSaving(true);
    const changed = modDraft.filter((d) => localMods.find((m) => m.moduleKey === d.moduleKey)?.isEnabled !== d.isEnabled);
    if (changed.length > 0) await batchSaveModuleConfigs(changed);
    setLocalMods(modDraft);
    setModDraft([]); setModEditMode(false); setModSaving(false);
  }

  function toggleModDraft(key: string) {
    setModDraft((prev) => prev.map((m) => m.moduleKey === key ? { ...m, isEnabled: !m.isEnabled } : m));
  }
  const [activeTab, setActiveTab] = useState<number>(() =>
    enabledSegIds.includes(3) ? 3 : enabledSegIds[0] ?? 1
  );

  // ── Section 1 edit mode ───────────────────────────────────────────────────
  const [seg1EditMode, setSeg1EditMode] = useState(false);
  const [seg1Draft, setSeg1Draft] = useState<SegmentConfigRow[]>([]);
  const [seg1Saving, setSeg1Saving] = useState(false);

  function enterSeg1Edit() {
    setSeg1Draft(SEGMENT_DEFS.map((def) => ({
      segmentId: def.id,
      isEnabled: localConfigs.find((c) => c.segmentId === def.id)?.isEnabled ?? true,
    })));
    setSeg1EditMode(true);
  }

  function cancelSeg1Edit() {
    setSeg1Draft([]);
    setSeg1EditMode(false);
  }

  async function saveSeg1Edit() {
    setSeg1Saving(true);
    await Promise.all(seg1Draft.map((d) => updateSegmentConfig(d.segmentId, { isEnabled: d.isEnabled })));
    setLocalConfigs(seg1Draft);
    setSeg1Draft([]);
    setSeg1EditMode(false);
    setSeg1Saving(false);
  }

  function toggleSeg1Draft(segId: number) {
    setSeg1Draft((prev) =>
      prev.map((c) => (c.segmentId === segId ? { ...c, isEnabled: !c.isEnabled } : c))
    );
  }

  // ── Edit mode (section 2) ─────────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, DraftItem>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, "account" | "sv">>(new Map());
  const [saving, setSaving] = useState(false);

  function getVal(id: string, actual: DraftItem): DraftItem {
    return editMode ? (drafts.get(id) ?? actual) : actual;
  }

  function setDraft(id: string, update: Partial<DraftItem>, actual: DraftItem) {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(id, { ...(prev.get(id) ?? actual), ...update });
      return next;
    });
  }

  function enterEdit() {
    setDrafts(new Map());
    setPendingDeletes(new Map());
    setEditMode(true);
  }

  function cancelEdit() {
    setDrafts(new Map());
    setPendingDeletes(new Map());
    setEditMode(false);
  }

  async function saveEdit() {
    setSaving(true);
    const deletes = [...pendingDeletes.entries()];
    await Promise.all(
      deletes.map(([id, type]) =>
        type === "account" ? deleteAccount(id) : deleteSegmentValue(id)
      )
    );
    const accountChanges = accounts
      .filter((a) => drafts.has(a.id) && !pendingDeletes.has(a.id))
      .map((a) => ({ id: a.id, ...drafts.get(a.id)! }));
    const svChanges = segmentValues
      .filter((sv) => drafts.has(sv.id) && !pendingDeletes.has(sv.id))
      .map((sv) => ({ id: sv.id, ...drafts.get(sv.id)! }));
    if (accountChanges.length > 0 || svChanges.length > 0) {
      await batchSaveSection2(accountChanges, svChanges);
    }
    setDrafts(new Map());
    setPendingDeletes(new Map());
    setEditMode(false);
    setSaving(false);
  }

  const dirtyCount = drafts.size + pendingDeletes.size;

  const activeModules = ALL_MODULES.filter(
    (mod) => localMods.find((m) => m.moduleKey === mod)?.isEnabled ?? true
  );

  // ── Column filters ────────────────────────────────────────────────────────
  const [colFilters, setColFilters] = useState<Record<string, ShownSet>>({});

  function handleFilter(key: string, val: ShownSet) {
    setColFilters((prev) => ({ ...prev, [key]: val }));
  }

  function applyFilters<T>(rows: T[], getVal: (row: T, key: string) => string): T[] {
    return rows.filter((row) =>
      Object.entries(colFilters).every(([key, shown]) => {
        if (!shown) return true;
        return shown.has(getVal(row, key));
      })
    );
  }

  // S3 filter logic
  const filteredAccounts = useMemo(() => {
    return applyFilters(accounts, (a, key) => {
      if (key === "code") return a.number;
      if (key === "name") return a.name;
      if (key === "isEnabled") return a.isEnabled ? "Тийм" : "Үгүй";
      const mods = parseMods(drafts.get(a.id)?.modules ?? a.modules);
      return mods.includes(key as ModuleKey) ? "Тийм" : "Үгүй";
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, colFilters, drafts]);

  // Non-S3 filter logic
  const currentSegValues = segmentValues.filter((v) => v.segmentId === activeTab);

  const filteredSegValues = useMemo(() => {
    return applyFilters(currentSegValues ?? [], (sv, key) => {
      if (key === "code") return sv.code;
      if (key === "name") return sv.name;
      if (key === "isEnabled") return sv.isEnabled ? "Тийм" : "Үгүй";
      const mods = parseMods(drafts.get(sv.id)?.modules ?? sv.modules);
      return mods.includes(key as ModuleKey) ? "Тийм" : "Үгүй";
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentValues, activeTab, colFilters, drafts]);

  // Dynamic available values per column (excluding that column's own filter)
  // so that subsequent filters only show values visible after prior filters
  const s3AllValues = useMemo<Record<string, string[]>>(() => {
    function rowVal(a: ChartOfAccount, key: string): string {
      if (key === "code") return a.number;
      if (key === "name") return a.name;
      if (key === "isEnabled") return a.isEnabled ? "Тийм" : "Үгүй";
      return parseMods(drafts.get(a.id)?.modules ?? a.modules).includes(key as ModuleKey) ? "Тийм" : "Үгүй";
    }
    const result: Record<string, string[]> = {};
    for (const colKey of ["code", "name", ...activeModules, "isEnabled"]) {
      const rows = accounts.filter((a) =>
        Object.entries(colFilters).every(([k, shown]) => !shown || k === colKey || shown.has(rowVal(a, k)))
      );
      result[colKey] = [...new Set(rows.map((a) => rowVal(a, colKey)))].sort();
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, colFilters, activeModules, drafts]);

  const svAllValues = useMemo<Record<string, string[]>>(() => {
    function rowVal(sv: SegmentValue, key: string): string {
      if (key === "code") return sv.code;
      if (key === "name") return sv.name;
      if (key === "isEnabled") return sv.isEnabled ? "Тийм" : "Үгүй";
      return parseMods(drafts.get(sv.id)?.modules ?? sv.modules).includes(key as ModuleKey) ? "Тийм" : "Үгүй";
    }
    const result: Record<string, string[]> = {};
    for (const colKey of ["code", "name", ...activeModules, "isEnabled"]) {
      const rows = currentSegValues.filter((sv) =>
        Object.entries(colFilters).every(([k, shown]) => !shown || k === colKey || shown.has(rowVal(sv, k)))
      );
      result[colKey] = [...new Set(rows.map((sv) => rowVal(sv, colKey)))].sort();
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentValues, activeTab, colFilters, activeModules, drafts]);

  const activeTabDef = SEGMENT_DEFS.find((d) => d.id === activeTab);

  // Reset filters when switching tabs
  function switchTab(id: number) {
    if (!editMode) { setActiveTab(id); setColFilters({}); }
  }

  // ── Delete confirmation dialog ────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string; type: "account" | "sv" } | null>(null);

  function askDelete(id: string, label: string, type: "account" | "sv") {
    setDeleteTarget({ id, label, type });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    setPendingDeletes((prev) => new Map(prev).set(deleteTarget.id, deleteTarget.type));
    setDeleteTarget(null);
  }

  function undoDelete(id: string) {
    setPendingDeletes((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  // ── S3 account management ─────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addNumber, setAddNumber] = useState("");
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const groupedAccounts = useMemo(() => {
    const g: Record<string, ChartOfAccount[]> = {};
    filteredAccounts.forEach((a) => {
      const k = getSegmentKey(a.number);
      if (!g[k]) g[k] = [];
      g[k].push(a);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => a.number.localeCompare(b.number)));
    return g;
  }, [filteredAccounts]);

  function handleCloseAdd() { setAddNumber(""); setAddName(""); setAddError(""); setAddOpen(false); }

  async function handleAddAccount() {
    if (!addNumber.trim() || !addName.trim()) { setAddError("Бүх талбарыг бөглөнө үү"); return; }
    setAddSaving(true); setAddError("");
    const res = await createAccount({ number: addNumber.trim(), name: addName.trim() });
    setAddSaving(false);
    if (res?.error) setAddError(res.error); else handleCloseAdd();
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg("");
    const res = await syncStandardAccounts();
    setSyncing(false);
    setSyncMsg(res.added === 0 ? "Бүх стандарт данс аль хэдийн байна" : `${res.added} шинэ данс нэмэгдлээ`);
    setTimeout(() => setSyncMsg(""), 3000);
  }


  // ── Non-S3 segment value management ──────────────────────────────────────
  const [svAddOpen, setSvAddOpen] = useState(false);
  const [svAddCode, setSvAddCode] = useState("");
  const [svAddName, setSvAddName] = useState("");
  const [svAddMods, setSvAddMods] = useState<ModuleKey[]>([]);
  const [svAddError, setSvAddError] = useState("");
  const [svSaving, setSvSaving] = useState(false);

  function openSvAdd() {
    const def = SEGMENT_DEFS.find((d) => d.id === activeTab);
    setSvAddMods(def?.defaultModules ?? []);
    setSvAddCode(""); setSvAddName(""); setSvAddError(""); setSvAddOpen(true);
  }

  function closeSvAdd() { setSvAddOpen(false); setSvAddCode(""); setSvAddName(""); setSvAddError(""); }

  async function handleAddSv() {
    if (!svAddCode.trim() || !svAddName.trim()) { setSvAddError("Бүх талбарыг бөглөнө үү"); return; }
    setSvSaving(true); setSvAddError("");
    const res = await createSegmentValue({ segmentId: activeTab, code: svAddCode.trim(), name: svAddName.trim(), modules: svAddMods });
    setSvSaving(false);
    if (res?.error) setSvAddError(res.error); else closeSvAdd();
  }


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ═══ Main tabs ══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-0 border-b border-[#E5E5DE] mb-6">
        {(["modules", "config", "values"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMainTab(tab)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              mainTab === tab ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-[#888] hover:text-[#333]"
            )}
          >
            {tab === "modules" ? "Модулийн тохиргоо" : tab === "config" ? "Сегментийн тохиргоо" : "Сегментийн утгуудын жагсаалт"}
          </button>
        ))}
      </div>

      {/* ═══ MODULE CONFIG TAB ══════════════════════════════════════════════ */}
      <div className={cn(mainTab !== "modules" && "hidden")}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-[#888]">Системд ашиглах модулиудыг идэвхжүүлнэ үү.</p>
          <div className="flex items-center gap-2">
            {modEditMode ? (
              <>
                <Button variant="outline" size="sm" className="text-xs" onClick={cancelModEdit} disabled={modSaving}>Болих</Button>
                <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={saveModEdit} disabled={modSaving}>
                  {modSaving ? "Хадгалж байна..." : "Хадгалах"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={enterModEdit}>Засварлах</Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {MODULE_DEFS.map((def) => {
            const source = modEditMode ? modDraft : localMods;
            const on = source.find((m) => m.moduleKey === def.key)?.isEnabled ?? true;
            const origOn = localMods.find((m) => m.moduleKey === def.key)?.isEnabled ?? true;
            const isDirty = modEditMode && on !== origOn;
            return (
              <div key={def.key} className={cn("bg-white border rounded-md px-4 py-3 transition-opacity", !on && "opacity-50", isDirty ? "border-[#1E3A5F]" : "border-[#E5E5DE]")}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-[#1E3A5F] uppercase">{def.key}</span>
                  <Switch checked={on} disabled={!modEditMode} onCheckedChange={() => toggleModDraft(def.key)} />
                </div>
                <div className="text-sm font-medium text-[#333] leading-tight">{def.nameMn}</div>
                <div className="text-[11px] text-[#aaa] leading-tight mt-1">{def.name}</div>
                <div className="text-[11px] text-[#888] leading-tight mt-1.5">{def.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ SECTION 1 ══════════════════════════════════════════════════════ */}
      <div className={cn("mb-6", mainTab !== "config" && "hidden")}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[#888]">
            Аль сегментийг ашиглахыг идэвхжүүлнэ.&nbsp;
            <span className="font-mono text-[#bbb]">S1.S2.S3.S4.S5.S6.S7.S8.S9.S10</span>
          </p>
          <div className="flex items-center gap-2">
            {seg1EditMode ? (
              <>
                <Button variant="outline" size="sm" className="text-xs" onClick={cancelSeg1Edit} disabled={seg1Saving}>Болих</Button>
                <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={saveSeg1Edit} disabled={seg1Saving}>
                  {seg1Saving ? "Хадгалж байна..." : "Хадгалах"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={enterSeg1Edit}>Засварлах</Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {SEGMENT_DEFS.map((def) => {
            const source = seg1EditMode ? seg1Draft : localConfigs;
            const on = source.find((c) => c.segmentId === def.id)?.isEnabled ?? true;
            const origOn = localConfigs.find((c) => c.segmentId === def.id)?.isEnabled ?? true;
            const isDirty = seg1EditMode && on !== origOn;
            return (
              <div key={def.id} className={cn("bg-white border rounded-md px-3 py-2.5 transition-opacity", !on && "opacity-50", isDirty ? "border-[#1E3A5F]" : "border-[#E5E5DE]")}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-[#1E3A5F]">
                    S{def.id}<span className="text-[#bbb] font-normal ml-1">{def.length}c</span>
                  </span>
                  <Switch
                    checked={on}
                    disabled={!seg1EditMode}
                    onCheckedChange={() => toggleSeg1Draft(def.id)}
                  />
                </div>
                <div className="text-xs font-medium text-[#333] leading-tight">{def.nameMn}</div>
                <div className="text-[10px] text-[#aaa] leading-tight mt-0.5">{def.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ SECTION 2 ══════════════════════════════════════════════════════ */}
      <div className={cn(mainTab !== "values" && "hidden")}>
        <p className="text-xs text-[#888] mb-3">Идэвхтэй сегментийг сонгоод кодуудыг тохируулна уу.</p>

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-[#E5E5DE] mb-4 overflow-x-auto">
          {SEGMENT_DEFS.filter((d) => localConfigs.find((c) => c.segmentId === d.id)?.isEnabled ?? true).map((def) => (
            <button
              key={def.id}
              type="button"
              onClick={() => switchTab(def.id)}
              className={cn(
                "px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                activeTab === def.id ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-[#888] hover:text-[#333]",
                editMode && activeTab !== def.id && "opacity-40 cursor-not-allowed"
              )}
            >
              S{def.id} {def.nameMn}
            </button>
          ))}
        </div>

        {activeTabDef && enabledSegIds.length > 0 && (
          <div>
            {/* Sub-header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-[#333]">{activeTabDef.nameMn}</span>
                <span className="text-xs text-[#888] ml-2">{activeTabDef.description}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Edit mode controls */}
                {editMode ? (
                  <>
                    {dirtyCount > 0 && (
                      <span className="text-xs text-[#888]">{dirtyCount} өөрчлөлт</span>
                    )}
                    <Button variant="outline" size="sm" className="text-xs" onClick={cancelEdit} disabled={saving}>
                      Болих
                    </Button>
                    <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={saveEdit} disabled={saving}>
                      {saving ? "Хадгалж байна..." : "Хадгалах"}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" className="text-xs" onClick={enterEdit}>
                    Засварлах
                  </Button>
                )}
                {/* Add / Sync */}
                {!editMode && activeTab === 3 && (
                  <>
                    {syncMsg && <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded">{syncMsg}</span>}
                    <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="text-xs">
                      {syncing ? "Синкчилж байна..." : "Стандарт данс нэмэх"}
                    </Button>
                    <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={() => setAddOpen(true)}>
                      + Данс нэмэх
                    </Button>
                  </>
                )}
                {!editMode && activeTab !== 3 && (
                  <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={openSvAdd}>
                    + Утга нэмэх
                  </Button>
                )}
              </div>
            </div>

            {/* ── S3: chart of accounts ── */}
            {activeTab === 3 && (
              <>
                <TableHeader activeMods={activeModules} allValuesMap={s3AllValues} colFilters={colFilters} onFilter={handleFilter} />
                <div className="border border-t-0 border-[#E5E5DE] rounded-b-md overflow-hidden">
                  {Object.keys(ACCOUNT_GROUPS).map((groupKey) => {
                    const rows = groupedAccounts[groupKey];
                    if (!rows || rows.length === 0) return null;
                    return (
                      <div key={groupKey}>
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F4F4EE] border-t border-[#E8E8E0]">
                          <span className="font-mono text-[10px] font-semibold text-[#1E3A5F]">{groupKey}X</span>
                          <span className="text-[11px] text-[#666]">{ACCOUNT_GROUPS[groupKey]}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {rows.filter((r) => (editMode ? (drafts.get(r.id)?.isEnabled ?? r.isEnabled) : r.isEnabled)).length}/{rows.length}
                          </Badge>
                        </div>
                        {rows.map((a) => {
                          const val = getVal(a.id, { isEnabled: a.isEnabled, modules: a.modules });
                          const mods = parseMods(val.modules);
                          const isDirty = drafts.has(a.id);
                          const isPendingDelete = pendingDeletes.has(a.id);
                          return (
                            <div key={a.id} className={cn("flex items-center px-3 py-2 border-t border-[#F0F0EA]", isPendingDelete ? "bg-red-50/60" : (!val.isEnabled && "opacity-50"), isDirty && !isPendingDelete && "bg-blue-50/40")}>
                              <span className={cn("font-mono text-xs text-[#555] w-[120px]", isPendingDelete && "line-through text-red-400")}>{a.number}</span>
                              <span className={cn("flex-1 text-xs text-[#333]", isPendingDelete && "line-through text-red-400")}>{a.name}</span>
                              {activeModules.map((mod) => (
                                <div key={mod} className="w-[52px] flex justify-center">
                                  <Switch
                                    checked={mods.includes(mod)}
                                    disabled={!editMode || isPendingDelete}
                                    onCheckedChange={() => {
                                      const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
                                      setDraft(a.id, { modules: next.join(",") }, { isEnabled: a.isEnabled, modules: a.modules });
                                    }}
                                  />
                                </div>
                              ))}
                              <div className="w-[72px] flex justify-center">
                                <Switch
                                  checked={val.isEnabled}
                                  disabled={!editMode || isPendingDelete}
                                  onCheckedChange={() =>
                                    setDraft(a.id, { isEnabled: !val.isEnabled }, { isEnabled: a.isEnabled, modules: a.modules })
                                  }
                                />
                              </div>
                              <div className="w-[28px] flex justify-center">
                                {editMode && (
                                  isPendingDelete
                                    ? <button onClick={() => undoDelete(a.id)} className="text-red-400 hover:text-[#1E3A5F] hover:bg-blue-50 px-1 py-0.5 rounded text-[10px] leading-none transition-colors" title="Буцаах">↩</button>
                                    : <button onClick={() => askDelete(a.id, a.number, "account")} className="text-[#ccc] hover:text-red-500 hover:bg-red-50 px-1 py-0.5 rounded text-base leading-none transition-colors" title="Устгах">×</button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  {Object.keys(groupedAccounts).length === 0 && (
                    <div className="py-10 text-center text-[#aaa] text-sm">
                      {Object.values(colFilters).some(Boolean) ? "Шүүлтүүрт тохирох данс олдсонгүй" : "Данс байхгүй — стандарт данс нэмэх товч дарна уу"}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ── Other segments ── */}
            {activeTab !== 3 && (
              <>
                <TableHeader activeMods={activeModules} allValuesMap={svAllValues} colFilters={colFilters} onFilter={handleFilter} />
                <div className="border border-t-0 border-[#E5E5DE] rounded-b-md overflow-hidden">
                  {currentSegValues.length === 0 ? (
                    <div className="py-10 text-center text-[#aaa] text-sm">Утга байхгүй — + Утга нэмэх товч дарна уу</div>
                  ) : filteredSegValues.length === 0 ? (
                    <div className="py-10 text-center text-[#aaa] text-sm">Шүүлтүүрт тохирох утга олдсонгүй</div>
                  ) : (
                    filteredSegValues.map((sv) => {
                      const val = getVal(sv.id, { isEnabled: sv.isEnabled, modules: sv.modules });
                      const mods = parseMods(val.modules);
                      const isDirty = drafts.has(sv.id);
                      const isPendingDelete = pendingDeletes.has(sv.id);
                      return (
                        <div key={sv.id} className={cn("flex items-center px-3 py-2 border-t border-[#F0F0EA]", isPendingDelete ? "bg-red-50/60" : (!val.isEnabled && "opacity-50"), isDirty && !isPendingDelete && "bg-blue-50/40")}>
                          <span className={cn("font-mono text-xs text-[#555] w-[120px]", isPendingDelete && "line-through text-red-400")}>{sv.code}</span>
                          <span className={cn("flex-1 text-xs text-[#333]", isPendingDelete && "line-through text-red-400")}>{sv.name}</span>
                          {activeModules.map((mod) => (
                            <div key={mod} className="w-[52px] flex justify-center">
                              <Switch
                                checked={mods.includes(mod)}
                                disabled={!editMode || isPendingDelete}
                                onCheckedChange={() => {
                                  const next = mods.includes(mod) ? mods.filter((m) => m !== mod) : [...mods, mod];
                                  setDraft(sv.id, { modules: next.join(",") }, { isEnabled: sv.isEnabled, modules: sv.modules });
                                }}
                              />
                            </div>
                          ))}
                          <div className="w-[72px] flex justify-center">
                            <Switch
                              checked={val.isEnabled}
                              disabled={!editMode || isPendingDelete}
                              onCheckedChange={() =>
                                setDraft(sv.id, { isEnabled: !val.isEnabled }, { isEnabled: sv.isEnabled, modules: sv.modules })
                              }
                            />
                          </div>
                          <div className="w-[28px] flex justify-center">
                            {editMode && (
                              isPendingDelete
                                ? <button onClick={() => undoDelete(sv.id)} className="text-red-400 hover:text-[#1E3A5F] hover:bg-blue-50 px-1 py-0.5 rounded text-[10px] leading-none transition-colors" title="Буцаах">↩</button>
                                : <button onClick={() => askDelete(sv.id, sv.code, "sv")} className="text-[#ccc] hover:text-red-500 hover:bg-red-50 px-1 py-0.5 rounded text-base leading-none transition-colors" title="Устгах">×</button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {enabledSegIds.length === 0 && (
          <div className="py-12 text-center text-[#aaa] text-sm border border-[#E5E5DE] rounded-md">
            Идэвхтэй сегмент байхгүй — дээр дэх тохиргооноос нэгийг идэвхжүүлнэ үү
          </div>
        )}
      </div>

      {/* ── Add S3 account modal ──────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && handleCloseAdd()}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Данс нэмэх (S3)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Дансны дугаар (8 орон)</Label>
              <Input placeholder="Жишээ: 51100000" value={addNumber} onChange={(e) => setAddNumber(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddAccount()} autoFocus />
              {addNumber.length > 0 && ACCOUNT_GROUPS[addNumber[0]] && (
                <p className="text-xs text-[#1E3A5F]">Бүлэг: {addNumber[0]}X — {ACCOUNT_GROUPS[addNumber[0]]}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Дансны нэр</Label>
              <Input placeholder="Жишээ: Үйл ажиллагааны орлого" value={addName} onChange={(e) => setAddName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddAccount()} />
            </div>
            {addError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseAdd}>Болих</Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" disabled={addSaving} onClick={handleAddAccount}>
              {addSaving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add segment value modal (non-S3) ─────────────────────────────── */}
      <Dialog open={svAddOpen} onOpenChange={(o) => !o && closeSvAdd()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Утга нэмэх — S{activeTab} {activeTabDef?.nameMn}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Код ({activeTabDef?.length} орон)</Label>
              <Input placeholder={`Жишээ: ${"1".padEnd(activeTabDef?.length ?? 2, "0")}`} value={svAddCode} onChange={(e) => setSvAddCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddSv()} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Нэр</Label>
              <Input placeholder="Жишээ: Үндсэн компани" value={svAddName} onChange={(e) => setSvAddName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddSv()} />
            </div>
            <div className="space-y-1.5">
              <Label>Модуль</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_MODULES.map((mod) => (
                  <button key={mod} type="button"
                    onClick={() => setSvAddMods((prev) => prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod])}
                    className={cn("px-3 py-1.5 rounded border text-xs font-medium transition-colors",
                      svAddMods.includes(mod) ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-[#666] border-[#ddd] hover:border-[#aaa]"
                    )}
                  >
                    {MODULE_LABELS[mod]}
                  </button>
                ))}
              </div>
            </div>
            {svAddError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{svAddError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeSvAdd}>Болих</Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" disabled={svSaving} onClick={handleAddSv}>
              {svSaving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation dialog ────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Устгах уу?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#333]">
            <span className="font-mono font-semibold">{deleteTarget?.label}</span>-г устгахаар тэмдэглэнэ.
            Хадгалах дарсны дараа устгагдана. Болих дарвал буцаж болно.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Болих</Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmDelete}>
              Устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
