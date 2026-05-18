"use client";

import { useMemo, useState } from "react";
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
  deleteSegmentValue,
  syncStandardAccounts,
  updateSegmentConfig,
  createSegmentValue,
  batchSaveSection2,
  batchSaveModuleConfigs,
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
import type { ChartOfAccount, SegmentValue } from "@/lib/db/schema";
import { EaGridDynamic } from "@/lib/grid/EaGridDynamic";
import type { ColDef, ICellRendererParams, RowClassParams } from "ag-grid-community";

interface SegmentConfigRow {
  segmentId: number;
  isEnabled: boolean;
}
interface ModuleConfigRow {
  moduleKey: string;
  isEnabled: boolean;
}
interface Props {
  accounts: ChartOfAccount[];
  segmentConfigs: SegmentConfigRow[];
  segmentValues: SegmentValue[];
  moduleConfigs: ModuleConfigRow[];
}

type DraftItem = { isEnabled: boolean; modules: string };

function parseMods(modules: string): ModuleKey[] {
  return modules
    .split(",")
    .map((m) => m.trim())
    .filter((m): m is ModuleKey => ALL_MODULES.includes(m as ModuleKey));
}

type AcctGridRow =
  | {
      kind: "header";
      id: string;
      groupKey: string;
      groupLabel: string;
      enabledCount: number;
      total: number;
    }
  | {
      kind: "row";
      id: string;
      rowType: "account" | "sv";
      code: string;
      name: string;
      isEnabled: boolean;
      modules: string;
      isDirty: boolean;
      isPendingDelete: boolean;
      effIsEnabled: boolean;
      effModules: string;
    };

export function AccountsTable({
  accounts,
  segmentConfigs,
  segmentValues,
  moduleConfigs,
}: Props) {
  const [localConfigs, setLocalConfigs] = useState<SegmentConfigRow[]>(segmentConfigs);

  const enabledSegIds = localConfigs.filter((c) => c.isEnabled).map((c) => c.segmentId);
  const [mainTab, setMainTab] = useState<"modules" | "config" | "values">("modules");

  const [localMods, setLocalMods] = useState<ModuleConfigRow[]>(moduleConfigs);
  const [modEditMode, setModEditMode] = useState(false);
  const [modDraft, setModDraft] = useState<ModuleConfigRow[]>([]);
  const [modSaving, setModSaving] = useState(false);

  function enterModEdit() {
    setModDraft(localMods.map((m) => ({ ...m })));
    setModEditMode(true);
  }
  function cancelModEdit() {
    setModDraft([]);
    setModEditMode(false);
  }
  async function saveModEdit() {
    setModSaving(true);
    const changed = modDraft.filter(
      (d) =>
        localMods.find((m) => m.moduleKey === d.moduleKey)?.isEnabled !== d.isEnabled
    );
    if (changed.length > 0) await batchSaveModuleConfigs(changed);
    setLocalMods(modDraft);
    setModDraft([]);
    setModEditMode(false);
    setModSaving(false);
  }
  function toggleModDraft(key: string) {
    setModDraft((prev) =>
      prev.map((m) => (m.moduleKey === key ? { ...m, isEnabled: !m.isEnabled } : m))
    );
  }

  const [activeTab, setActiveTab] = useState<number>(() =>
    enabledSegIds.includes(3) ? 3 : enabledSegIds[0] ?? 1
  );

  const [seg1EditMode, setSeg1EditMode] = useState(false);
  const [seg1Draft, setSeg1Draft] = useState<SegmentConfigRow[]>([]);
  const [seg1Saving, setSeg1Saving] = useState(false);

  function enterSeg1Edit() {
    setSeg1Draft(
      SEGMENT_DEFS.map((def) => ({
        segmentId: def.id,
        isEnabled: localConfigs.find((c) => c.segmentId === def.id)?.isEnabled ?? true,
      }))
    );
    setSeg1EditMode(true);
  }
  function cancelSeg1Edit() {
    setSeg1Draft([]);
    setSeg1EditMode(false);
  }
  async function saveSeg1Edit() {
    setSeg1Saving(true);
    await Promise.all(
      seg1Draft.map((d) =>
        updateSegmentConfig(d.segmentId, { isEnabled: d.isEnabled })
      )
    );
    setLocalConfigs(seg1Draft);
    setSeg1Draft([]);
    setSeg1EditMode(false);
    setSeg1Saving(false);
  }
  function toggleSeg1Draft(segId: number) {
    setSeg1Draft((prev) =>
      prev.map((c) =>
        c.segmentId === segId ? { ...c, isEnabled: !c.isEnabled } : c
      )
    );
  }

  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Map<string, DraftItem>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Map<string, "account" | "sv">>(
    new Map()
  );
  const [saving, setSaving] = useState(false);

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

  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; label: string; type: "account" | "sv" } | null
  >(null);

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

  function effectiveS3Row(a: ChartOfAccount) {
    const draft = drafts.get(a.id);
    const effIsEnabled = draft?.isEnabled ?? a.isEnabled;
    const effModules = draft?.modules ?? a.modules;
    return {
      effIsEnabled,
      effModules,
      isDirty: drafts.has(a.id),
      isPendingDelete: pendingDeletes.has(a.id),
    };
  }
  function effectiveSvRow(sv: SegmentValue) {
    const draft = drafts.get(sv.id);
    const effIsEnabled = draft?.isEnabled ?? sv.isEnabled;
    const effModules = draft?.modules ?? sv.modules;
    return {
      effIsEnabled,
      effModules,
      isDirty: drafts.has(sv.id),
      isPendingDelete: pendingDeletes.has(sv.id),
    };
  }

  const s3GridRows = useMemo<AcctGridRow[]>(() => {
    const grouped: Record<string, ChartOfAccount[]> = {};
    accounts.forEach((a) => {
      const k = getSegmentKey(a.number);
      if (!grouped[k]) grouped[k] = [];
      grouped[k].push(a);
    });
    Object.values(grouped).forEach((arr) =>
      arr.sort((a, b) => a.number.localeCompare(b.number))
    );

    const out: AcctGridRow[] = [];
    for (const groupKey of Object.keys(ACCOUNT_GROUPS)) {
      const rows = grouped[groupKey];
      if (!rows || rows.length === 0) continue;
      const enabledCount = rows.filter((r) => effectiveS3Row(r).effIsEnabled).length;
      out.push({
        kind: "header",
        id: `__header-${groupKey}`,
        groupKey,
        groupLabel: ACCOUNT_GROUPS[groupKey],
        enabledCount,
        total: rows.length,
      });
      for (const a of rows) {
        const eff = effectiveS3Row(a);
        out.push({
          kind: "row",
          id: a.id,
          rowType: "account",
          code: a.number,
          name: a.name,
          isEnabled: a.isEnabled,
          modules: a.modules,
          ...eff,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, drafts, pendingDeletes]);

  const svGridRows = useMemo<AcctGridRow[]>(() => {
    return segmentValues
      .filter((sv) => sv.segmentId === activeTab)
      .map((sv) => {
        const eff = effectiveSvRow(sv);
        return {
          kind: "row" as const,
          id: sv.id,
          rowType: "sv" as const,
          code: sv.code,
          name: sv.name,
          isEnabled: sv.isEnabled,
          modules: sv.modules,
          ...eff,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentValues, activeTab, drafts, pendingDeletes]);

  const columnDefs = useMemo<ColDef<AcctGridRow>[]>(() => {
    const cols: ColDef<AcctGridRow>[] = [
      {
        headerName: "Код",
        colId: "code",
        width: 140,
        cellClass: "font-mono text-xs",
        filter: "agTextColumnFilter",
        valueGetter: (p) =>
          p.data?.kind === "row" ? p.data.code : p.data?.groupKey,
        cellRenderer: (p: ICellRendererParams<AcctGridRow>) => {
          const d = p.data;
          if (!d) return null;
          if (d.kind === "header")
            return (
              <span className="font-mono text-[10px] font-semibold text-[var(--ea-primary)]">
                {d.groupKey}X
              </span>
            );
          return (
            <span
              className={cn(
                "font-mono text-xs",
                d.isPendingDelete && "line-through text-red-400"
              )}
            >
              {d.code}
            </span>
          );
        },
        // Header rows span code + name + N module cols + isEnabled + actions
        colSpan: (p) => (p.data?.kind === "header" ? activeModules.length + 4 : 1),
        sortable: false,
      },
      {
        headerName: "Нэр",
        colId: "name",
        flex: 1,
        minWidth: 240,
        filter: "agTextColumnFilter",
        valueGetter: (p) =>
          p.data?.kind === "row" ? p.data.name : p.data?.groupLabel,
        cellRenderer: (p: ICellRendererParams<AcctGridRow>) => {
          const d = p.data;
          if (!d) return null;
          if (d.kind === "header") {
            return (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--ea-text-3)]">
                  {d.groupLabel}
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  {d.enabledCount}/{d.total}
                </Badge>
              </div>
            );
          }
          return (
            <span
              className={cn(
                "text-xs",
                d.isPendingDelete && "line-through text-red-400"
              )}
            >
              {d.name}
            </span>
          );
        },
        sortable: false,
      },
    ];

    for (const mod of activeModules) {
      cols.push({
        headerName: MODULE_LABELS[mod],
        colId: `mod-${mod}`,
        width: 64,
        cellClass: "flex items-center justify-center",
        headerClass: "ag-right-aligned-header",
        sortable: false,
        filter: "agSetColumnFilter",
        valueGetter: (p) => {
          if (p.data?.kind !== "row") return "";
          return parseMods(p.data.effModules).includes(mod) ? "Тийм" : "Үгүй";
        },
        cellRenderer: (p: ICellRendererParams<AcctGridRow>) => {
          const d = p.data;
          if (!d || d.kind !== "row") return null;
          const mods = parseMods(d.effModules);
          return (
            <Switch
              checked={mods.includes(mod)}
              disabled={!editMode || d.isPendingDelete}
              onCheckedChange={() => {
                const next = mods.includes(mod)
                  ? mods.filter((m) => m !== mod)
                  : [...mods, mod];
                setDraft(
                  d.id,
                  { modules: next.join(",") },
                  { isEnabled: d.isEnabled, modules: d.modules }
                );
              }}
            />
          );
        },
      });
    }

    cols.push({
      headerName: "Төлөв",
      colId: "isEnabled",
      width: 90,
      sortable: false,
      filter: "agTextColumnFilter",
      cellClass: "flex items-center justify-center",
      valueGetter: (p) =>
        p.data?.kind === "row" ? (p.data.effIsEnabled ? "Тийм" : "Үгүй") : "",
      cellRenderer: (p: ICellRendererParams<AcctGridRow>) => {
        const d = p.data;
        if (!d || d.kind !== "row") return null;
        return (
          <Switch
            checked={d.effIsEnabled}
            disabled={!editMode || d.isPendingDelete}
            onCheckedChange={() =>
              setDraft(
                d.id,
                { isEnabled: !d.effIsEnabled },
                { isEnabled: d.isEnabled, modules: d.modules }
              )
            }
          />
        );
      },
    });

    cols.push({
      headerName: "",
      colId: "actions",
      width: 50,
      sortable: false,
      filter: false,
      cellClass: "flex items-center justify-center",
      cellRenderer: (p: ICellRendererParams<AcctGridRow>) => {
        const d = p.data;
        if (!d || d.kind !== "row" || !editMode) return null;
        if (d.isPendingDelete)
          return (
            <button
              onClick={() => undoDelete(d.id)}
              className="text-red-400 hover:text-[#1E3A5F] hover:bg-blue-50 px-1 py-0.5 rounded text-[10px] leading-none transition-colors"
              title="Буцаах"
            >
              ↩
            </button>
          );
        return (
          <button
            onClick={() => askDelete(d.id, d.code, d.rowType)}
            className="text-[#ccc] hover:text-red-500 hover:bg-red-50 px-1 py-0.5 rounded text-base leading-none transition-colors"
            title="Устгах"
          >
            ×
          </button>
        );
      },
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModules, editMode, drafts, pendingDeletes]);

  const rowClassRules = useMemo(
    () => ({
      "ea-acct-header-row": (p: RowClassParams<AcctGridRow>) =>
        p.data?.kind === "header",
      "ea-acct-pending-delete": (p: RowClassParams<AcctGridRow>) =>
        p.data?.kind === "row" && p.data.isPendingDelete,
      "ea-acct-dirty": (p: RowClassParams<AcctGridRow>) =>
        p.data?.kind === "row" && p.data.isDirty && !p.data.isPendingDelete,
      "ea-acct-disabled": (p: RowClassParams<AcctGridRow>) =>
        p.data?.kind === "row" && !p.data.effIsEnabled && !p.data.isPendingDelete,
    }),
    []
  );

  const activeTabDef = SEGMENT_DEFS.find((d) => d.id === activeTab);

  function switchTab(id: number) {
    if (!editMode) {
      setActiveTab(id);
    }
  }

  const [addOpen, setAddOpen] = useState(false);
  const [addNumber, setAddNumber] = useState("");
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  function handleCloseAdd() {
    setAddNumber("");
    setAddName("");
    setAddError("");
    setAddOpen(false);
  }
  async function handleAddAccount() {
    if (!addNumber.trim() || !addName.trim()) {
      setAddError("Бүх талбарыг бөглөнө үү");
      return;
    }
    setAddSaving(true);
    setAddError("");
    const res = await createAccount({
      number: addNumber.trim(),
      name: addName.trim(),
    });
    setAddSaving(false);
    if (res?.error) setAddError(res.error);
    else handleCloseAdd();
  }
  async function handleSync() {
    setSyncing(true);
    setSyncMsg("");
    const res = await syncStandardAccounts();
    setSyncing(false);
    setSyncMsg(
      res.added === 0
        ? "Бүх стандарт данс аль хэдийн байна"
        : `${res.added} шинэ данс нэмэгдлээ`
    );
    setTimeout(() => setSyncMsg(""), 3000);
  }

  const [svAddOpen, setSvAddOpen] = useState(false);
  const [svAddCode, setSvAddCode] = useState("");
  const [svAddName, setSvAddName] = useState("");
  const [svAddMods, setSvAddMods] = useState<ModuleKey[]>([]);
  const [svAddError, setSvAddError] = useState("");
  const [svSaving, setSvSaving] = useState(false);

  function openSvAdd() {
    const def = SEGMENT_DEFS.find((d) => d.id === activeTab);
    setSvAddMods(def?.defaultModules ?? []);
    setSvAddCode("");
    setSvAddName("");
    setSvAddError("");
    setSvAddOpen(true);
  }
  function closeSvAdd() {
    setSvAddOpen(false);
    setSvAddCode("");
    setSvAddName("");
    setSvAddError("");
  }
  async function handleAddSv() {
    if (!svAddCode.trim() || !svAddName.trim()) {
      setSvAddError("Бүх талбарыг бөглөнө үү");
      return;
    }
    setSvSaving(true);
    setSvAddError("");
    const res = await createSegmentValue({
      segmentId: activeTab,
      code: svAddCode.trim(),
      name: svAddName.trim(),
      modules: svAddMods,
    });
    setSvSaving(false);
    if (res?.error) setSvAddError(res.error);
    else closeSvAdd();
  }

  return (
    <>
      <div className="flex items-center gap-0 border-b border-[#E5E5DE] mb-6">
        {(["modules", "config", "values"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMainTab(tab)}
            className={cn(
              "px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              mainTab === tab
                ? "border-[#1E3A5F] text-[#1E3A5F]"
                : "border-transparent text-[#888] hover:text-[#333]"
            )}
          >
            {tab === "modules"
              ? "Модулийн тохиргоо"
              : tab === "config"
              ? "Сегментийн тохиргоо"
              : "Сегментийн утгуудын жагсаалт"}
          </button>
        ))}
      </div>

      <div className={cn(mainTab !== "modules" && "hidden")}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-[#888]">
            Системд ашиглах модулиудыг идэвхжүүлнэ үү.
          </p>
          <div className="flex items-center gap-2">
            {modEditMode ? (
              <>
                <Button variant="outline" size="sm" className="text-xs" onClick={cancelModEdit} disabled={modSaving}>
                  Болих
                </Button>
                <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={saveModEdit} disabled={modSaving}>
                  {modSaving ? "Хадгалж байна..." : "Хадгалах"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={enterModEdit}>
                Засварлах
              </Button>
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
              <div
                key={def.key}
                className={cn(
                  "bg-white border rounded-md px-4 py-3 transition-opacity",
                  !on && "opacity-50",
                  isDirty ? "border-[#1E3A5F]" : "border-[#E5E5DE]"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-bold text-[#1E3A5F] uppercase">
                    {def.key}
                  </span>
                  <Switch
                    checked={on}
                    disabled={!modEditMode}
                    onCheckedChange={() => toggleModDraft(def.key)}
                  />
                </div>
                <div className="text-sm font-medium text-[#333] leading-tight">{def.nameMn}</div>
                <div className="text-[11px] text-[#aaa] leading-tight mt-1">{def.name}</div>
                <div className="text-[11px] text-[#888] leading-tight mt-1.5">{def.description}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={cn("mb-6", mainTab !== "config" && "hidden")}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[#888]">
            Аль сегментийг ашиглахыг идэвхжүүлнэ.&nbsp;
            <span className="font-mono text-[#bbb]">S1.S2.S3.S4.S5.S6.S7.S8.S9.S10</span>
          </p>
          <div className="flex items-center gap-2">
            {seg1EditMode ? (
              <>
                <Button variant="outline" size="sm" className="text-xs" onClick={cancelSeg1Edit} disabled={seg1Saving}>
                  Болих
                </Button>
                <Button size="sm" className="bg-[#1E3A5F] hover:bg-[#15294A] text-xs" onClick={saveSeg1Edit} disabled={seg1Saving}>
                  {seg1Saving ? "Хадгалж байна..." : "Хадгалах"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="text-xs" onClick={enterSeg1Edit}>
                Засварлах
              </Button>
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
              <div
                key={def.id}
                className={cn(
                  "bg-white border rounded-md px-3 py-2.5 transition-opacity",
                  !on && "opacity-50",
                  isDirty ? "border-[#1E3A5F]" : "border-[#E5E5DE]"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-bold text-[#1E3A5F]">
                    S{def.id}
                    <span className="text-[#bbb] font-normal ml-1">{def.length}c</span>
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

      <div className={cn(mainTab !== "values" && "hidden")}>
        <p className="text-xs text-[#888] mb-3">Идэвхтэй сегментийг сонгоод кодуудыг тохируулна уу.</p>

        <div className="flex items-center gap-0 border-b border-[#E5E5DE] mb-4 overflow-x-auto">
          {SEGMENT_DEFS.filter(
            (d) => localConfigs.find((c) => c.segmentId === d.id)?.isEnabled ?? true
          ).map((def) => (
            <button
              key={def.id}
              type="button"
              onClick={() => switchTab(def.id)}
              className={cn(
                "px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                activeTab === def.id
                  ? "border-[#1E3A5F] text-[#1E3A5F]"
                  : "border-transparent text-[#888] hover:text-[#333]",
                editMode && activeTab !== def.id && "opacity-40 cursor-not-allowed"
              )}
            >
              S{def.id} {def.nameMn}
            </button>
          ))}
        </div>

        {activeTabDef && enabledSegIds.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-sm font-medium text-[#333]">{activeTabDef.nameMn}</span>
                <span className="text-xs text-[#888] ml-2">{activeTabDef.description}</span>
              </div>
              <div className="flex items-center gap-2">
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

            {activeTab === 3 ? (
              s3GridRows.length === 0 ? (
                <div className="py-10 text-center text-[#aaa] text-sm border border-[#E5E5DE] rounded-md">
                  Данс байхгүй — стандарт данс нэмэх товч дарна уу
                </div>
              ) : (
                <EaGridDynamic<AcctGridRow>
                  rowData={s3GridRows}
                  columnDefs={columnDefs}
                  getRowId={(p) => p.data.id}
                  rowClassRules={rowClassRules}
                  height={Math.min(720, 48 + s3GridRows.length * 36)}
                  wrapperClassName="ea-accounts-grid rounded-md border border-[var(--ea-border)] overflow-hidden"
                  suppressCellFocus
                />
              )
            ) : svGridRows.length === 0 ? (
              <div className="py-10 text-center text-[#aaa] text-sm border border-[#E5E5DE] rounded-md">
                Утга байхгүй — + Утга нэмэх товч дарна уу
              </div>
            ) : (
              <EaGridDynamic<AcctGridRow>
                rowData={svGridRows}
                columnDefs={columnDefs}
                getRowId={(p) => p.data.id}
                rowClassRules={rowClassRules}
                height={Math.min(720, 48 + svGridRows.length * 36)}
                wrapperClassName="ea-accounts-grid rounded-md border border-[var(--ea-border)] overflow-hidden"
                suppressCellFocus
              />
            )}
          </div>
        )}

        {enabledSegIds.length === 0 && (
          <div className="py-12 text-center text-[#aaa] text-sm border border-[#E5E5DE] rounded-md">
            Идэвхтэй сегмент байхгүй — дээр дэх тохиргооноос нэгийг идэвхжүүлнэ үү
          </div>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={(o) => !o && handleCloseAdd()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Данс нэмэх (S3)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Дансны дугаар (8 орон)</Label>
              <Input
                placeholder="Жишээ: 51100000"
                value={addNumber}
                onChange={(e) => setAddNumber(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddAccount()}
                autoFocus
              />
              {addNumber.length > 0 && ACCOUNT_GROUPS[addNumber[0]] && (
                <p className="text-xs text-[#1E3A5F]">
                  Бүлэг: {addNumber[0]}X — {ACCOUNT_GROUPS[addNumber[0]]}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Дансны нэр</Label>
              <Input
                placeholder="Жишээ: Үйл ажиллагааны орлого"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddAccount()}
              />
            </div>
            {addError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseAdd}>
              Болих
            </Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" disabled={addSaving} onClick={handleAddAccount}>
              {addSaving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={svAddOpen} onOpenChange={(o) => !o && closeSvAdd()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Утга нэмэх — S{activeTab} {activeTabDef?.nameMn}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Код ({activeTabDef?.length} орон)</Label>
              <Input
                placeholder={`Жишээ: ${"1".padEnd(activeTabDef?.length ?? 2, "0")}`}
                value={svAddCode}
                onChange={(e) => setSvAddCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSv()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Нэр</Label>
              <Input
                placeholder="Жишээ: Үндсэн компани"
                value={svAddName}
                onChange={(e) => setSvAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddSv()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Модуль</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_MODULES.map((mod) => (
                  <button
                    key={mod}
                    type="button"
                    onClick={() =>
                      setSvAddMods((prev) =>
                        prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
                      )
                    }
                    className={cn(
                      "px-3 py-1.5 rounded border text-xs font-medium transition-colors",
                      svAddMods.includes(mod)
                        ? "bg-[#1E3A5F] text-white border-[#1E3A5F]"
                        : "bg-white text-[#666] border-[#ddd] hover:border-[#aaa]"
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
            <Button variant="outline" onClick={closeSvAdd}>
              Болих
            </Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15294A]" disabled={svSaving} onClick={handleAddSv}>
              {svSaving ? "Хадгалж байна..." : "Хадгалах"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Устгах уу?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#333]">
            <span className="font-mono font-semibold">{deleteTarget?.label}</span>
            -г устгахаар тэмдэглэнэ. Хадгалах дарсны дараа устгагдана. Болих дарвал буцаж болно.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Болих
            </Button>
            <Button className="bg-red-500 hover:bg-red-600 text-white" onClick={confirmDelete}>
              Устгах
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
