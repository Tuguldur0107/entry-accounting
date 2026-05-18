"use client";

import { create, type StoreApi, type UseBoundStore } from "zustand";
import { produce } from "immer";
import type { BatchPatch, CellPatch, HistoryEntry, RowMeta } from "@/lib/grid/types";

export interface GridStoreState<TData extends { id: string } = { id: string }> {
  surfaceId: string;
  rows: Record<string, TData>;
  rowOrder: string[];
  meta: Record<string, RowMeta>;
  history: { past: HistoryEntry[]; future: HistoryEntry[] };
  capacity: number;

  getRow: (id: string) => TData | undefined;
  toArray: () => TData[];
  isDirty: () => boolean;

  setRows: (rows: TData[]) => void;
  addRow: (row: TData, opts?: { isNew?: boolean }) => void;
  removeRow: (id: string) => void;
  applyPatches: (label: string, patches: CellPatch[]) => void;
  setError: (id: string, field: string, error: string | null) => void;
  markValidated: (id: string) => void;

  undo: () => void;
  redo: () => void;
  clearHistory: () => void;

  buildBatch: () => BatchPatch<TData>;
  resetDirtyState: () => void;
}

const emptyMeta = (): RowMeta => ({
  isDirty: false,
  isInvalid: false,
  errors: {},
});

export function createGridStore<TData extends { id: string }>(
  surfaceId: string,
  initial: TData[] = [],
  capacity = 100
): UseBoundStore<StoreApi<GridStoreState<TData>>> {
  return create<GridStoreState<TData>>((set, get) => ({
    surfaceId,
    rows: Object.fromEntries(initial.map((r) => [r.id, r])),
    rowOrder: initial.map((r) => r.id),
    meta: Object.fromEntries(initial.map((r) => [r.id, emptyMeta()])),
    history: { past: [], future: [] },
    capacity,

    getRow: (id) => get().rows[id],
    toArray: () => {
      const s = get();
      return s.rowOrder.map((id) => s.rows[id]).filter(Boolean) as TData[];
    },
    isDirty: () => {
      const m = get().meta;
      return Object.values(m).some((r) => r.isDirty || r.isDeleted || r.isNew);
    },

    setRows: (rows) =>
      set(() => ({
        rows: Object.fromEntries(rows.map((r) => [r.id, r])),
        rowOrder: rows.map((r) => r.id),
        meta: Object.fromEntries(rows.map((r) => [r.id, emptyMeta()])),
        history: { past: [], future: [] },
      })),

    addRow: (row, opts) =>
      set(
        produce<GridStoreState<TData>>((s) => {
          (s.rows as Record<string, TData>)[row.id] = row;
          s.rowOrder.push(row.id);
          s.meta[row.id] = { ...emptyMeta(), isNew: opts?.isNew ?? false };
        })
      ),

    removeRow: (id) =>
      set(
        produce<GridStoreState<TData>>((s) => {
          if (!s.meta[id]) return;
          if (s.meta[id].isNew) {
            delete s.rows[id];
            s.rowOrder = s.rowOrder.filter((x) => x !== id);
            delete s.meta[id];
          } else {
            s.meta[id].isDeleted = true;
            s.meta[id].isDirty = true;
          }
        })
      ),

    applyPatches: (label, patches) =>
      set(
        produce<GridStoreState<TData>>((s) => {
          if (patches.length === 0) return;
          for (const p of patches) {
            const row = s.rows[p.rowId];
            if (!row) continue;
            (row as Record<string, unknown>)[p.field] = p.next;
            s.meta[p.rowId] = s.meta[p.rowId] ?? emptyMeta();
            s.meta[p.rowId].isDirty = true;
          }
          s.history.past.push({ label, patches });
          if (s.history.past.length > s.capacity) s.history.past.shift();
          s.history.future = [];
        })
      ),

    setError: (id, field, error) =>
      set(
        produce<GridStoreState<TData>>((s) => {
          s.meta[id] = s.meta[id] ?? emptyMeta();
          if (error) {
            s.meta[id].errors[field] = error;
            s.meta[id].isInvalid = true;
          } else {
            delete s.meta[id].errors[field];
            s.meta[id].isInvalid = Object.keys(s.meta[id].errors).length > 0;
          }
        })
      ),

    markValidated: (id) =>
      set(
        produce<GridStoreState<TData>>((s) => {
          if (s.meta[id]) {
            s.meta[id].errors = {};
            s.meta[id].isInvalid = false;
          }
        })
      ),

    undo: () =>
      set(
        produce<GridStoreState<TData>>((s) => {
          const entry = s.history.past.pop();
          if (!entry) return;
          for (const p of entry.patches) {
            const row = s.rows[p.rowId];
            if (!row) continue;
            (row as Record<string, unknown>)[p.field] = p.prev;
          }
          s.history.future.push(entry);
        })
      ),

    redo: () =>
      set(
        produce<GridStoreState<TData>>((s) => {
          const entry = s.history.future.pop();
          if (!entry) return;
          for (const p of entry.patches) {
            const row = s.rows[p.rowId];
            if (!row) continue;
            (row as Record<string, unknown>)[p.field] = p.next;
          }
          s.history.past.push(entry);
        })
      ),

    clearHistory: () => set(() => ({ history: { past: [], future: [] } })),

    buildBatch: () => {
      const s = get();
      const create: BatchPatch<TData>["create"] = [];
      const update: BatchPatch<TData>["update"] = [];
      const del: string[] = [];
      for (const id of s.rowOrder) {
        const m = s.meta[id];
        if (!m) continue;
        const row = s.rows[id];
        if (!row) continue;
        if (m.isDeleted && !m.isNew) {
          del.push(id);
        } else if (m.isNew && !m.isDeleted) {
          create.push({ ...row, __tempId: id });
        } else if (m.isDirty) {
          update.push({ ...row, id } as Partial<TData> & { id: string });
        }
      }
      return { create, update, delete: del };
    },

    resetDirtyState: () =>
      set(
        produce<GridStoreState<TData>>((s) => {
          for (const id of Object.keys(s.meta)) {
            s.meta[id] = emptyMeta();
          }
          s.history = { past: [], future: [] };
        })
      ),
  }));
}
