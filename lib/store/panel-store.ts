"use client";

// Ажлын панелийн НЭГДСЭН бүртгэл (Zustand). Chat програмын загвар:
// хэд хэдэн ажлыг зэрэг нээж, хураан, хооронд нь сэлгэнэ.
//
// Гол дүрмүүд:
//   - Нэг зүйлийг (жишээ нь нэг журнал) хоёр удаа нээхгүй — байгааг нь
//     фокуслоно (key-ээр dedupe) ба refreshToken-ийг өсгөж дахин ачаалуулна.
//   - Хураахад панель UNMOUNT ХИЙГДЭХГҮЙ — зөвхөн нуугдана. Тиймээс бөглөж
//     байсан форм, бичиж байсан журнал хэвээр үлдэнэ.
//   - Харагдаж буй панель дээд тал нь MAX_PANELS — нээх, сэргээх, dedupe
//     БҮХ зам дээр мөрдөнө; хэтэрвэл хамгийн эртнийг ХУРААНА (хаахгүй).
//   - Байрлал `slot`-оор тогтмол: фокус солиход панель ХӨДЛӨХГҮЙ, зөвхөн
//     zIndex өөрчлөгдөнө (эс бөгөөс идэвхгүй панелийн товч дээр дарахад
//     mousedown дээр байрлал сольчихоод click нь өөр газар буудаг).

import { create } from "zustand";

export type PanelKind =
  | "voucher" // GL журнал — засах эсвэл харах
  | "voucher-new" // Шинэ журнал бичих
  | "drill"; // Самбарын метрикийн задаргаа

export interface PanelInstance {
  /** Дотоод дахин давтагдашгүй id. */
  id: string;
  /** Ижил зүйлийг дахин нээхээс сэргийлэх түлхүүр (kind + бизнес id). */
  key: string;
  kind: PanelKind;
  title: string;
  /** Панелийн төрлөөс хамаарсан props (PanelHost дотор тайлагдана). */
  payload: Record<string, unknown>;
  /**
   * Дахин ачаалах дохио — dedupe-ээр дахин нээх, хураагдснаа сэргэх бүрд
   * өснө. Панелийн агуулга үүнийг fetch effect-ийнхээ dep болгоно.
   */
  refreshToken: number;
  minimized: boolean;
  /** Дэлгэц дүүрэн горим. */
  maximized: boolean;
  /** Нээгдсэн/фокуслогдсон дараалал — zIndex-ийн зэрэглэлд. */
  order: number;
  /** Байрлалын тогтмол суудал (0..MAX-1) — шатласан офсет үүнээс. */
  slot: number;
  /** Хадгалаагүй өөрчлөлттэй эсэх — хаахад анхааруулна. */
  dirty: boolean;
}

export const MAX_PANELS = 5;

type PanelState = {
  panels: PanelInstance[];
  /** Фокустай панелийн id (хамгийн дээр харагдана). */
  activeId: string | null;
  openPanel: (input: {
    key: string;
    kind: PanelKind;
    title: string;
    payload?: Record<string, unknown>;
  }) => string;
  closePanel: (id: string) => void;
  closeAll: () => void;
  minimize: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  focus: (id: string) => void;
  setTitle: (id: string, title: string) => void;
  setDirty: (id: string, dirty: boolean) => void;
};

let seq = 0;
let newVoucherSeq = 0;
const nextId = () => `panel-${++seq}`;

const visibleOf = (panels: PanelInstance[]) =>
  panels.filter((panel) => !panel.minimized);

/** Харагдах тоог MAX-д барина: keepId-ээс бусдын хамгийн эртнийг хураана. */
function enforceVisibleCap(
  panels: PanelInstance[],
  keepId: string | null
): PanelInstance[] {
  let result = panels;
  for (;;) {
    const visible = visibleOf(result).filter((panel) => panel.id !== keepId);
    const total = visibleOf(result).length;
    if (total < MAX_PANELS || visible.length === 0) return result;
    const oldest = visible.reduce((a, b) => (a.order < b.order ? a : b));
    result = result.map((panel) =>
      panel.id === oldest.id
        ? { ...panel, minimized: true, maximized: false }
        : panel
    );
  }
}

/** Харагдаж буй панелиудын эзэлээгүй хамгийн бага суудал. */
function freeSlot(panels: PanelInstance[]): number {
  const taken = new Set(visibleOf(panels).map((panel) => panel.slot));
  let slot = 0;
  while (taken.has(slot)) slot += 1;
  return slot;
}

/** Фокус шилжих дараагийн панель — хамгийн сүүлд идэвхтэй байсан харагдах нь. */
function topVisibleId(panels: PanelInstance[]): string | null {
  return (
    visibleOf(panels).reduce<PanelInstance | null>(
      (top, panel) => (!top || panel.order > top.order ? panel : top),
      null
    )?.id ?? null
  );
}

export const usePanelStore = create<PanelState>()((set, get) => ({
  panels: [],
  activeId: null,

  openPanel: ({ key, kind, title, payload = {} }) => {
    const existing = get().panels.find((panel) => panel.key === key);
    if (existing) {
      // Дахин нээхгүй — сэргээж фокуслоод, агуулгыг нь дахин ачаалуулна.
      set((state) => {
        let panels = state.panels;
        if (existing.minimized)
          panels = enforceVisibleCap(panels, existing.id);
        const slot = existing.minimized ? freeSlot(panels) : existing.slot;
        return {
          panels: panels.map((panel) =>
            panel.id === existing.id
              ? {
                  ...panel,
                  title,
                  minimized: false,
                  order: ++seq,
                  slot,
                  refreshToken: panel.refreshToken + 1,
                }
              : panel
          ),
          activeId: existing.id,
        };
      });
      return existing.id;
    }

    const id = nextId();
    set((state) => {
      const panels = enforceVisibleCap(state.panels, null);
      return {
        panels: [
          ...panels,
          {
            id,
            key,
            kind,
            title,
            payload,
            refreshToken: 0,
            minimized: false,
            maximized: false,
            order: ++seq,
            slot: freeSlot(panels),
            dirty: false,
          },
        ],
        activeId: id,
      };
    });
    return id;
  },

  closePanel: (id) =>
    set((state) => {
      const panels = state.panels.filter((panel) => panel.id !== id);
      return {
        panels,
        activeId:
          state.activeId === id ? topVisibleId(panels) : state.activeId,
      };
    }),

  closeAll: () => set({ panels: [], activeId: null }),

  minimize: (id) =>
    set((state) => {
      const panels = state.panels.map((panel) =>
        panel.id === id
          ? { ...panel, minimized: true, maximized: false }
          : panel
      );
      return {
        panels,
        activeId:
          state.activeId === id ? topVisibleId(panels) : state.activeId,
      };
    }),

  restore: (id) =>
    set((state) => {
      let panels = enforceVisibleCap(state.panels, id);
      panels = panels.map((panel) =>
        panel.id === id
          ? {
              ...panel,
              minimized: false,
              order: ++seq,
              slot: freeSlot(panels),
              // Хураастай байх зуур өгөгдөл хуучирсан байж болно.
              refreshToken: panel.refreshToken + 1,
            }
          : panel
      );
      return { panels, activeId: id };
    }),

  toggleMaximize: (id) =>
    set((state) => ({
      panels: state.panels.map((panel) =>
        panel.id === id ? { ...panel, maximized: !panel.maximized } : panel
      ),
      activeId: id,
    })),

  focus: (id) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || state.activeId === id) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, order: ++seq } : panel
        ),
        activeId: id,
      };
    }),

  setTitle: (id, title) =>
    set((state) => {
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || target.title === title) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, title } : panel
        ),
      };
    }),

  setDirty: (id, dirty) =>
    set((state) => {
      // Өөрчлөгдөөгүй бол state-ээ хэвээр буцаана — эс бөгөөс формын
      // onDirtyChange → setDirty → дахин render → onDirtyChange гэсэн
      // төгсгөлгүй давталт үүснэ.
      const target = state.panels.find((panel) => panel.id === id);
      if (!target || target.dirty === dirty) return state;
      return {
        panels: state.panels.map((panel) =>
          panel.id === id ? { ...panel, dirty } : panel
        ),
      };
    }),
}));

/** Панель нээх богино туслахууд — callsite бүрд key/title давтахгүйн тулд. */
export function openVoucherPanel(voucherId: string, title?: string) {
  return usePanelStore.getState().openPanel({
    key: `voucher:${voucherId}`,
    kind: "voucher",
    title: title || "Журнал",
    payload: { voucherId },
  });
}

export function openNewVoucherPanel() {
  // Дарах бүрд ШИНЭ хоосон форм — тогтмол key байсан бол өмнөх хагас
  // бөглөсөн ноорог чимээгүй сэргэж, хэрэглэгчийг төөрөлдүүлнэ.
  return usePanelStore.getState().openPanel({
    key: `voucher:new:${++newVoucherSeq}`,
    kind: "voucher-new",
    title: "Шинэ журнал",
    payload: {},
  });
}
